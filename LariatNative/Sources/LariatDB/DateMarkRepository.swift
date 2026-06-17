import Foundation
import GRDB
import LariatModel

public struct DateMarkRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    public func load(
        today: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> DateMarkBoardSnapshot {
        try await readDB.pool.read { db in
            let active = try DateMarkRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM date_marks
                  WHERE location_id = ? AND discarded_at IS NULL
                  ORDER BY discard_on ASC, id ASC
                  """,
                arguments: [locationId]
            )
            let scan = DateMarkCompute.scanExpiringBatches(active, today: today)
            return DateMarkBoardSnapshot(locationId: locationId, today: today, active: active, scan: scan)
        }
    }

    @discardableResult
    public func create(input: DateMarkCreateInput, context: RegulatedWriteContext) throws -> DateMarkRow {
        switch DateMarkCompute.validateCreate(item: input.item, preparedOn: input.preparedOn) {
        case .failure(let err): throw err
        case .success: break
        }

        let item = clip(input.item, max: 200)
        let preparedOn = clip(input.preparedOn, max: 10)
        guard let item, let preparedOn else {
            throw DateMarkWriteError.validationFailed("item and prepared_on are required")
        }
        let discardOn = try DateMarkCompute.computeDiscardOn(preparedOn: preparedOn)
        let batchRef = clip(input.batchRef, max: 120)
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO date_marks
                    (location_id, item, batch_ref, prepared_on, discard_on, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?)
                  """,
                arguments: [locationId, item, batchRef, preparedOn, discardOn, cookId]
            )
            let newId = db.lastInsertedRowID
            guard let row = try DateMarkRow.fetchOne(
                db,
                sql: "SELECT * FROM date_marks WHERE id = ?",
                arguments: [newId]
            ) else {
                throw DateMarkWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "date_marks",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: preparedOn,
                    locationId: locationId
                )
            )
            return row
        }
    }

    @discardableResult
    public func discard(
        id: Int64,
        reason: DateMarkDiscardReason,
        context: RegulatedWriteContext
    ) throws -> DateMarkRow {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try DateMarkRow.fetchOne(
                db,
                sql: "SELECT * FROM date_marks WHERE id = ?",
                arguments: [id]
            ) else {
                throw DateMarkWriteError.notFound
            }
            if existing.locationId != context.locationId {
                throw DateMarkWriteError.notFound
            }
            if existing.discardedAt != nil {
                throw DateMarkWriteError.alreadyDiscarded
            }

            let now = ISO8601DateFormatter().string(from: Date())
            try db.execute(
                sql: """
                  UPDATE date_marks
                  SET discarded_at = ?, discarded_by_cook_id = ?, discard_reason = ?
                  WHERE id = ?
                  """,
                arguments: [now, context.actorCookId, reason.rawValue, id]
            )

            guard let updated = try DateMarkRow.fetchOne(
                db,
                sql: "SELECT * FROM date_marks WHERE id = ?",
                arguments: [id]
            ) else {
                throw DateMarkWriteError.notFound
            }

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "date_marks",
                    entityId: id,
                    action: .update,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    note: "discarded: \(reason.rawValue)",
                    shiftDate: existing.preparedOn,
                    locationId: existing.locationId
                )
            )
            return updated
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
