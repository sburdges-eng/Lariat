import Foundation
import GRDB
import LariatModel

/// Prep-task board repository — behavior parity with app/api/prep-tasks/route.js
/// (POST create) and app/api/prep-tasks/[id]/route.js (PATCH lifecycle, DELETE),
/// plus the app/prep/page.jsx board read. Regulated writes emit an audit row in
/// the same transaction as the source mutation (AuditedWriteRunner).
public struct PrepRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    private static let selectColumns = """
        id, shift_date, station_id, task, qty, recipe_slug, notes,
        priority, assigned_cook_id, status, started_at, done_at, done_by,
        source, source_ref, sort_order, location_id, created_at, updated_at
        """

    private static let validStatuses: Set<String> = ["todo", "in_progress", "done", "skipped"]

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // MARK: - load (app/prep/page.jsx read + PrepBoard.jsx grouping)

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve(),
        stations: [KitchenStation]
    ) async throws -> PrepBoardSnapshot {
        try await readDB.pool.read { db in
            let tasks = try PrepTaskRow.fetchAll(
                db,
                sql: """
                  SELECT \(Self.selectColumns) FROM prep_tasks
                  WHERE shift_date = ? AND location_id = ?
                  ORDER BY priority DESC, sort_order ASC, id ASC
                  """,
                arguments: [date, locationId]
            )
            return PrepBoardSnapshot(
                locationId: locationId,
                date: date,
                openGroups: PrepCompute.groupOpen(tasks, stations: stations),
                closed: PrepCompute.closedBin(tasks),
                counts: PrepCompute.counts(tasks)
            )
        }
    }

    /// Historical prep quantities keyed by lower(item), for the median compute.
    /// Feeds `PrepCompute.medianForItems`. Read-only over beo_prep_history.
    public func prepMedians(
        for items: [String],
        locationId: String = LocationScope.resolve()
    ) async throws -> [String: PrepMedian] {
        let keys = Set(
            items.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                 .filter { !$0.isEmpty }
        )
        guard !keys.isEmpty else { return [:] }
        let rowsByKey: [String: [String?]] = try await readDB.pool.read { db in
            var out: [String: [String?]] = [:]
            for key in keys {
                let amounts = try String?.fetchAll(
                    db,
                    sql: "SELECT amount_qty FROM beo_prep_history WHERE location_id = ? AND LOWER(item) = ?",
                    arguments: [locationId, key]
                )
                if !amounts.isEmpty { out[key] = amounts }
            }
            return out
        }
        return PrepCompute.medianForItems(rowsByKey: rowsByKey, items: items)
    }

    // MARK: - create (POST /api/prep-tasks)

    @discardableResult
    public func create(input: PrepTaskCreateInput, context: RegulatedWriteContext) throws -> PrepTaskRow {
        guard let task = clip(input.task, max: 300) else {
            throw PrepTaskWriteError.taskRequired
        }
        let locationId = context.locationId
        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let stationId = clip(input.stationId, max: 80)
        let qty = clip(input.qty, max: 80)
        let recipeSlug = clip(input.recipeSlug, max: 160)
        let notes = clip(input.notes, max: 1000)
        let priority = PrepPriority.clamp(input.priority).rawValue
        let assignedCookId = clip(input.assignedCookId, max: 64)
        let source = clip(input.source, max: 80) ?? "manual"
        let sourceRef = clip(input.sourceRef, max: 160)
        let sortOrder = input.sortOrder
        // Web: actorCookId = clip(body.cook_id) || assignedCookId.
        let actorCookId = clip(input.cookId, max: 64) ?? assignedCookId ?? context.actorCookId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO prep_tasks
                    (shift_date, station_id, task, qty, recipe_slug, notes,
                     priority, assigned_cook_id, status, source, source_ref,
                     sort_order, location_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate, stationId, task, qty, recipeSlug, notes,
                    priority, assignedCookId, source, sourceRef, sortOrder, locationId,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try fetchTask(db, id: newId) else {
                throw PrepTaskWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "prep_tasks",
                    entityId: newId,
                    action: .insert,
                    actorCookId: actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    // MARK: - patch (PATCH /api/prep-tasks/:id)

    @discardableResult
    public func patch(
        id: Int64,
        input: PrepTaskPatchInput,
        context: RegulatedWriteContext
    ) throws -> PrepTaskRow {
        // cook attribution: cook_id ?? assigned_cook_id ?? context actor.
        let cookId = clip(input.cookId, max: 64)
            ?? assignedCookIdFromPatch(input)
            ?? context.actorCookId

        var setClauses: [String] = []
        var values: [DatabaseValueConvertible?] = []

        if input.claim && input.release {
            throw PrepTaskWriteError.claimAndRelease
        }
        if input.claim {
            guard let cookId, !cookId.isEmpty else { throw PrepTaskWriteError.cookRequired }
            setClauses.append("assigned_cook_id = ?")
            values.append(cookId)
        }
        if input.release {
            setClauses.append("assigned_cook_id = NULL")
        }

        if case .set(let raw)? = input.status {
            guard let status = clip(raw, max: 32), Self.validStatuses.contains(status) else {
                throw PrepTaskWriteError.badStatus
            }
            setClauses.append("status = ?")
            values.append(status)
            if status == "in_progress" {
                setClauses.append("started_at = COALESCE(started_at, datetime('now'))")
                setClauses.append("done_at = NULL")
                setClauses.append("done_by = NULL")
            } else if status == "done" || status == "skipped" {
                setClauses.append("started_at = COALESCE(started_at, datetime('now'))")
                setClauses.append("done_at = datetime('now')")
                setClauses.append("done_by = ?")
                values.append(cookId)
            } else {  // todo
                setClauses.append("started_at = NULL")
                setClauses.append("done_at = NULL")
                setClauses.append("done_by = NULL")
            }
        }

        if case .set(let raw)? = input.task {
            guard let task = clip(raw, max: 300) else { throw PrepTaskWriteError.taskRequired }
            setClauses.append("task = ?")
            values.append(task)
        }
        if case .set(let raw)? = input.stationId {
            setClauses.append("station_id = ?")
            values.append(clip(raw, max: 80))
        }
        if case .set(let raw)? = input.qty {
            setClauses.append("qty = ?")
            values.append(clip(raw, max: 80))
        }
        if case .set(let raw)? = input.recipeSlug {
            setClauses.append("recipe_slug = ?")
            values.append(clip(raw, max: 160))
        }
        if case .set(let raw)? = input.notes {
            setClauses.append("notes = ?")
            values.append(clip(raw, max: 1000))
        }
        if case .set(let raw)? = input.priority {
            setClauses.append("priority = ?")
            values.append(PrepPriority.clamp(raw).rawValue)
        }
        // assigned_cook_id patch only when not already claiming (web guard).
        if case .set(let raw)? = input.assignedCookId, !input.claim {
            setClauses.append("assigned_cook_id = ?")
            values.append(clip(raw, max: 64))
        }
        if case .set(let raw)? = input.sortOrder {
            setClauses.append("sort_order = ?")
            values.append(raw)
        }

        if setClauses.isEmpty {
            throw PrepTaskWriteError.nothingToSave
        }

        let locationId = context.locationId
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let before = try fetchTask(db, id: id, locationId: locationId) else {
                throw PrepTaskWriteError.notFound
            }

            var args = values
            args.append(id)
            args.append(locationId)
            try db.execute(
                sql: """
                  UPDATE prep_tasks
                     SET \(setClauses.joined(separator: ", ")),
                         updated_at = datetime('now')
                   WHERE id = ? AND location_id = ?
                  """,
                arguments: StatementArguments(args)
            )

            guard let after = try fetchTask(db, id: id, locationId: locationId) else {
                throw PrepTaskWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "prep_tasks",
                    entityId: id,
                    action: .update,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(BeforeAfter(before: before, after: after)),
                    shiftDate: after.shiftDate,
                    locationId: locationId
                )
            )
            return after
        }
    }

    // MARK: - delete (DELETE /api/prep-tasks/:id)

    public func delete(id: Int64, context: RegulatedWriteContext) throws {
        let locationId = context.locationId
        let cookId = context.actorCookId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let before = try fetchTask(db, id: id, locationId: locationId) else {
                throw PrepTaskWriteError.notFound
            }
            try db.execute(
                sql: "DELETE FROM prep_tasks WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "prep_tasks",
                    entityId: id,
                    action: .delete,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(before),
                    shiftDate: before.shiftDate,
                    locationId: before.locationId
                )
            )
        }
    }

    // MARK: - helpers

    private func fetchTask(_ db: Database, id: Int64, locationId: String? = nil) throws -> PrepTaskRow? {
        if let locationId {
            return try PrepTaskRow.fetchOne(
                db,
                sql: "SELECT \(Self.selectColumns) FROM prep_tasks WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
        }
        return try PrepTaskRow.fetchOne(
            db,
            sql: "SELECT \(Self.selectColumns) FROM prep_tasks WHERE id = ?",
            arguments: [id]
        )
    }

    private func assignedCookIdFromPatch(_ input: PrepTaskPatchInput) -> String? {
        if case .set(let raw)? = input.assignedCookId { return clip(raw, max: 64) }
        return nil
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

/// before/after audit payload for prep-task updates (parity with the web
/// PATCH route's `payload: { before, after }`).
private struct BeforeAfter: Encodable {
    let before: PrepTaskRow
    let after: PrepTaskRow
}
