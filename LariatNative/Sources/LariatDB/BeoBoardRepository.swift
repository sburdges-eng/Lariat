import Foundation
import GRDB
import LariatModel

/// The `/api/beo` action surface — parity with `app/api/beo/route.js`
/// (GET + POST actions `event`, `update_event`, `line`, `update_line`,
/// `delete_line`, `prep`, `prep_done`, `delete_event`).
///
/// Audit posture (asserted in tests): every regulated write posts its
/// `audit_events` row in the SAME transaction via `AuditedWriteRunner` +
/// `AuditEventWriter`, matching the web route's entities/actions/payload
/// keys. Documented divergences: `actor_source` from `RegulatedWriteContext`
/// (`native_mac`; web sends `api`), no `withIdempotency` layer (a repeated
/// call writes again), and reads are open natively (the web GET is
/// PIN-gated; the view model gates WRITES via the manager-PIN session).
///
/// Rule failures throw typed `BeoWriteError`s BEFORE any write.
public struct BeoBoardRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    static let maxTitle = 200
    static let maxTask = 500
    static let maxNotes = 2000

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    /// Web `clip(s, max)`: trim; empty → nil; slice to max.
    static func clip(_ s: String?, max: Int) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(max))
    }

    /// JSON payload for the audit row — numeric fidelity with the web's
    /// `postAuditEvent(payload)` (JSON numbers, not stringified).
    static func payloadJSON(_ dict: [String: Any?]) -> String {
        let cleaned = dict.mapValues { $0 ?? NSNull() }
        guard let data = try? JSONSerialization.data(withJSONObject: cleaned),
              let json = String(data: data, encoding: .utf8)
        else { return "{\"_audit_serialization_error\":true}" }
        return json
    }

    // ── GET /api/beo ─────────────────────────────────────────────────────

    /// `{location_id, events, prep_tasks, line_items}`. Line items scope via
    /// the parent-event correlated subquery (one stable statement, one bound
    /// parameter — the web's T5 scaling shape).
    public func load(locationId: String = LocationScope.resolve()) async throws -> BeoSnapshot {
        try await readDB.pool.read { db in
            let events = try BeoEventRow.fetchAll(
                db,
                sql: "SELECT * FROM beo_events WHERE location_id = ? ORDER BY event_date DESC, id DESC",
                arguments: [locationId]
            )
            let tasks = try BeoPrepTaskRow.fetchAll(
                db,
                sql: "SELECT * FROM beo_prep_tasks WHERE location_id = ? ORDER BY event_id, sort_order, id",
                arguments: [locationId]
            )
            let lines = try BeoLineItemRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM beo_line_items
                   WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
                   ORDER BY event_id, sort_order, id
                  """,
                arguments: [locationId]
            )
            return BeoSnapshot(locationId: locationId, events: events, prepTasks: tasks, lineItems: lines)
        }
    }

    // ── POST action='event' ──────────────────────────────────────────────

    @discardableResult
    public func createEvent(
        _ input: BeoEventInput,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> Int64 {
        guard let title = Self.clip(input.title, max: Self.maxTitle) else {
            throw BeoWriteError.badRequest("title required")
        }
        if let minSpend = input.minSpend, !minSpend.isFinite || minSpend < 0 {
            throw BeoWriteError.badRequest("min_spend must be a non-negative number")
        }
        let taxRate = input.taxRate.flatMap { $0.isFinite ? $0 : nil } ?? 0.0675
        let serviceFeePct = input.serviceFeePct.flatMap { $0.isFinite ? $0 : nil } ?? 20

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_events
                    (title, event_date, event_time, contact_name, guest_count,
                     notes, status, tax_rate, service_fee_pct, min_spend, location_id)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)
                  """,
                arguments: [
                    title,
                    Self.clip(input.eventDate, max: 32) ?? ShiftDate.todayISO(),
                    Self.clip(input.eventTime, max: 32),
                    Self.clip(input.contactName, max: 120),
                    input.guestCount,
                    Self.clip(input.notes, max: Self.maxNotes),
                    Self.clip(input.status, max: 32) ?? "planned",
                    taxRate,
                    serviceFeePct,
                    input.minSpend,
                    locationId,
                ]
            )
            let newId = db.lastInsertedRowID
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_events", entityId: newId, action: .insert,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "title": title, "tax_rate": taxRate, "service_fee_pct": serviceFeePct,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
            return newId
        }
    }

    // ── POST action='update_event' ───────────────────────────────────────

    /// Partial patch: every non-key column is `col = COALESCE(?, col)`;
    /// only min_spend is clearable (provided-flag CASE). No 404 semantics —
    /// unknown ids no-op (web parity).
    public func updateEvent(
        id: Int64,
        patch: BeoEventPatch,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        var minSpendProvided = 0
        var minSpendValue: Double? = nil
        if case .set(let raw) = patch.minSpend {
            minSpendProvided = 1
            if let v = raw {
                guard v.isFinite, v >= 0 else {
                    throw BeoWriteError.badRequest("min_spend must be a non-negative number")
                }
                minSpendValue = v
            }
        }
        let title = Self.clip(patch.title, max: Self.maxTitle)
        let taxRate = patch.taxRate.flatMap { $0.isFinite ? $0 : nil }
        let serviceFeePct = patch.serviceFeePct.flatMap { $0.isFinite ? $0 : nil }

        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  UPDATE beo_events SET
                    title           = COALESCE(?, title),
                    event_date      = COALESCE(?, event_date),
                    event_time      = COALESCE(?, event_time),
                    contact_name    = COALESCE(?, contact_name),
                    guest_count     = COALESCE(?, guest_count),
                    notes           = COALESCE(?, notes),
                    status          = COALESCE(?, status),
                    tax_rate        = COALESCE(?, tax_rate),
                    service_fee_pct = COALESCE(?, service_fee_pct),
                    min_spend       = CASE WHEN ? = 1 THEN ? ELSE min_spend END
                  WHERE id = ? AND location_id = ?
                  """,
                arguments: [
                    title,
                    Self.clip(patch.eventDate, max: 32),
                    Self.clip(patch.eventTime, max: 32),
                    Self.clip(patch.contactName, max: 120),
                    patch.guestCount,
                    Self.clip(patch.notes, max: Self.maxNotes),
                    Self.clip(patch.status, max: 32),
                    taxRate,
                    serviceFeePct,
                    minSpendProvided,
                    minSpendValue,
                    id,
                    locationId,
                ]
            )
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_events", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "title": title, "tax_rate": taxRate, "service_fee_pct": serviceFeePct,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── POST action='line' ───────────────────────────────────────────────

    @discardableResult
    public func addLine(
        _ input: BeoLineInput,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> Int64 {
        guard let eventId = input.eventId,
              let itemName = Self.clip(input.itemName, max: Self.maxTitle)
        else {
            throw BeoWriteError.badRequest("event_id and item_name required")
        }
        let cost = input.unitCost.flatMap { $0.isFinite ? $0 : nil } ?? 0
        let qty = input.quantity.flatMap { $0.isFinite ? $0 : nil } ?? 1

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_line_items
                    (event_id, sort_order, item_name, category, unit_cost, quantity,
                     prep_notes, secondary_prep_notes, order_items_notes, order_time, group_note)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)
                  """,
                arguments: [
                    eventId,
                    input.sortOrder ?? 0,
                    itemName,
                    Self.clip(input.category, max: 64),
                    cost,
                    qty,
                    Self.clip(input.prepNotes, max: Self.maxNotes),
                    Self.clip(input.secondaryPrepNotes, max: Self.maxNotes),
                    Self.clip(input.orderItemsNotes, max: Self.maxNotes),
                    Self.clip(input.orderTime, max: 32),
                    Self.clip(input.groupNote, max: Self.maxNotes),
                ]
            )
            let lineId = db.lastInsertedRowID
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_line_items", entityId: lineId, action: .insert,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "item_name": itemName, "unit_cost": cost, "quantity": qty, "event_id": eventId,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
            return lineId
        }
    }

    // ── POST action='update_line' ────────────────────────────────────────

    /// beo_line_items has no location_id of its own — it inherits via
    /// event_id → beo_events.location_id; the UPDATE is scoped through that
    /// subquery so location A cannot mutate location B's lines (Bundle-H T4).
    public func updateLine(
        id: Int64,
        patch: BeoLinePatch,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        // course_id (T5): absent = no change, null = clear, integer = set.
        // parseCourseIdPatch throws unprocessable (web 422) BEFORE any write.
        let courseIdTriState: Int64?? = {
            switch patch.courseId {
            case .absent: return nil
            case .set(let v): return .some(v)
            }
        }()
        let coursePatch = try BeoCourseRules.parseCourseIdPatch(courseIdTriState)
        let courseTouch = coursePatch != .absent ? 1 : 0
        let courseVal: Int64? = { if case .set(let n) = coursePatch { return n }; return nil }()

        func textPatch(_ p: FieldPatch<String>, max: Int) -> (touch: Int, value: String?) {
            switch p {
            case .absent: return (0, nil)
            case .set(let v): return (1, Self.clip(v, max: max))
            }
        }
        let prep = textPatch(patch.prepNotes, max: Self.maxNotes)
        let sec = textPatch(patch.secondaryPrepNotes, max: Self.maxNotes)
        let ord = textPatch(patch.orderItemsNotes, max: Self.maxNotes)
        let time = textPatch(patch.orderTime, max: 32)
        let grp = textPatch(patch.groupNote, max: Self.maxNotes)

        let itemName = Self.clip(patch.itemName, max: Self.maxTitle)
        let cost = patch.unitCost.flatMap { $0.isFinite ? $0 : nil }
        let qty = patch.quantity.flatMap { $0.isFinite ? $0 : nil }

        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  UPDATE beo_line_items SET
                    item_name             = COALESCE(?, item_name),
                    unit_cost             = COALESCE(?, unit_cost),
                    quantity              = COALESCE(?, quantity),
                    category              = COALESCE(?, category),
                    prep_notes            = CASE WHEN ? THEN ? ELSE prep_notes END,
                    secondary_prep_notes  = CASE WHEN ? THEN ? ELSE secondary_prep_notes END,
                    order_items_notes     = CASE WHEN ? THEN ? ELSE order_items_notes END,
                    order_time            = CASE WHEN ? THEN ? ELSE order_time END,
                    group_note            = CASE WHEN ? THEN ? ELSE group_note END,
                    course_id             = CASE WHEN ? THEN ? ELSE course_id END
                  WHERE id = ?
                    AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
                  """,
                arguments: [
                    itemName, cost, qty, Self.clip(patch.category, max: 64),
                    prep.touch, prep.value,
                    sec.touch, sec.value,
                    ord.touch, ord.value,
                    time.touch, time.value,
                    grp.touch, grp.value,
                    courseTouch, courseVal,
                    id,
                    locationId,
                ]
            )
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_line_items", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "item_name": itemName, "unit_cost": cost, "quantity": qty,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── POST action='delete_line' ────────────────────────────────────────

    public func deleteLine(
        id: Int64,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  DELETE FROM beo_line_items
                   WHERE id = ?
                     AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
                  """,
                arguments: [id, locationId]
            )
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_line_items", entityId: id, action: .delete,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── POST action='prep' ───────────────────────────────────────────────

    @discardableResult
    public func addPrepTask(
        eventId: Int64?,
        task: String?,
        dueDate: String? = nil,
        sortOrder: Int? = nil,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> Int64 {
        guard let eventId, let task = Self.clip(task, max: Self.maxTask) else {
            throw BeoWriteError.badRequest("event_id and task required")
        }
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id)
                  VALUES (?,?,?,?,?,?)
                  """,
                arguments: [eventId, task, Self.clip(dueDate, max: 32), 0, sortOrder ?? 0, locationId]
            )
            let newId = db.lastInsertedRowID
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_prep_tasks", entityId: newId, action: .insert,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON(["event_id": eventId, "task": task]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
            return newId
        }
    }

    // ── POST action='prep_done' ──────────────────────────────────────────

    public func setPrepDone(
        id: Int64,
        done: Bool,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            // Web parity (app/api/beo/route.js): scope the UPDATE by location_id
            // so a caller cannot toggle another location's prep task by id.
            try db.execute(
                sql: "UPDATE beo_prep_tasks SET done = ? WHERE id = ? AND location_id = ?",
                arguments: [done ? 1 : 0, id, locationId]
            )
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_prep_tasks", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON(["done": done ? 1 : 0]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── POST action='delete_event' ───────────────────────────────────────

    /// beo_line_items.event_id and beo_prep_tasks.event_id both declare
    /// ON DELETE CASCADE, and foreign_keys is ON for every connection
    /// (LariatWriteDatabase config), so the single DELETE sweeps both child
    /// tables atomically (web parity).
    public func deleteEvent(
        id: Int64,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            // Web parity (app/api/beo/route.js): scope the DELETE by location_id
            // so a caller cannot delete another location's event by id. The FK
            // ON DELETE CASCADE still sweeps this event's child rows atomically.
            try db.execute(sql: "DELETE FROM beo_events WHERE id = ? AND location_id = ?",
                           arguments: [id, locationId])
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_events", entityId: id, action: .delete,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }
}
