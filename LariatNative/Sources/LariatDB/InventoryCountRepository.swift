import Foundation
import GRDB
import LariatModel

/// Repository for the inventory COUNTS board — behavior parity with
/// `app/api/inventory/counts/route.js`, `.../counts/[id]/route.js`, and
/// `.../counts/[id]/lines/route.js` (A4.1). Reads via the read-only pool (GET is
/// open, no PIN); open / close / reopen and line upsert go through
/// `AuditedWriteRunner` so each mutation + its `audit_events` row commit in ONE
/// transaction.
///
/// Line `ingredient` is canonicalized with `IngredientKey.normalize` before the
/// upsert (the `UNIQUE(count_id, ingredient, sku)` conflict key), and `sku` is
/// empty-string-not-NULL. Writes are tagged `actor_source = native_cook` (web
/// uses `'api'`); this area has NO PIN gate.
public struct InventoryCountRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET /api/inventory/counts — recent counts + per-count line tally ──

    public func listCounts(
        openOnly: Bool = false,
        locationId: String = LocationScope.resolve()
    ) async throws -> [InventoryCountSummary] {
        try await readDB.pool.read { db in
            // line_count only tallies same-location lines (matches the web
            // subquery `WHERE l.count_id = c.id AND l.location_id = c.location_id`).
            let openFilter = openOnly ? "AND c.closed_at IS NULL" : ""
            let sql = """
              SELECT c.id, c.count_date, c.label, c.opened_at, c.closed_at, c.cook_id,
                     (SELECT COUNT(*) FROM inventory_count_lines l
                       WHERE l.count_id = c.id AND l.location_id = c.location_id) AS line_count
                FROM inventory_counts c
               WHERE c.location_id = ? \(openFilter)
               ORDER BY c.opened_at DESC
               LIMIT 50
              """
            return try InventoryCountSummary.fetchAll(db, sql: sql, arguments: [locationId])
        }
    }

    // ── GET /api/inventory/counts/[id] — head + lines (ingredient ASC) ──

    public func getCount(
        id: Int64,
        locationId: String = LocationScope.resolve()
    ) async throws -> InventoryCountDetail? {
        guard id > 0 else { return nil }
        return try await readDB.pool.read { db -> InventoryCountDetail? in
            guard let head = try InventoryCountRow.fetchOne(db, sql: """
              SELECT id, count_date, label, opened_at, closed_at, cook_id
                FROM inventory_counts WHERE id = ? AND location_id = ?
              """, arguments: [id, locationId]) else { return nil }
            let lines = try InventoryCountLine.fetchAll(db, sql: """
              SELECT id, vendor, ingredient, sku, on_hand_qty, unit, par_qty, par_unit,
                     note, counted_by, counted_at
                FROM inventory_count_lines
               WHERE count_id = ? AND location_id = ?
               ORDER BY ingredient ASC
              """, arguments: [id, locationId])
            return InventoryCountDetail(head: head, lines: lines)
        }
    }

    // ── POST /api/inventory/counts — open a count ──

    @discardableResult
    public func openCount(input: InventoryCountOpenInput, context: RegulatedWriteContext) throws -> Int64 {
        let label = clip(input.label, max: 100)
        let cookId = clip(input.cookId, max: 64)
        let countDate = clip(input.countDate, max: 32) ?? ShiftDate.todayISO()
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(sql: """
              INSERT INTO inventory_counts (count_date, label, cook_id, location_id)
              VALUES (?, ?, ?, ?)
              """, arguments: [countDate, label, cookId, locationId])
            let id = db.lastInsertedRowID
            var payload: [String: String] = ["count_date": countDate]
            if let label { payload["label"] = label }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_counts",
                entityId: id,
                action: .insert,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payload: payload,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))
            return id
        }
    }

    // ── POST /api/inventory/counts/[id]/lines — upsert a line ──

    @discardableResult
    public func upsertLine(countId: Int64, input: InventoryCountLineInput, context: RegulatedWriteContext) throws -> Int64 {
        guard countId > 0 else { throw InventoryCountWriteError.badId }
        guard let rawIngredient = clip(input.ingredient, max: 300) else {
            throw InventoryCountWriteError.ingredientRequired
        }
        // Canonicalize before the upsert so cross-cook capitalization dedups onto
        // one row (the UNIQUE conflict key). Empty after normalization → reject.
        let ingredient = IngredientKey.normalize(rawIngredient)
        guard !ingredient.isEmpty else { throw InventoryCountWriteError.ingredientRequired }
        let sku = clip(input.sku, max: 64) ?? ""          // empty-string, not NULL
        let vendor = clip(input.vendor, max: 64)
        let unit = clip(input.unit, max: 32)
        let parUnit = clip(input.parUnit, max: 32)
        let note = clip(input.note, max: 500)
        let onHand = finite(input.onHandQty)
        let parQty = finite(input.parQty)
        let cookId = context.actorCookId
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // 404/409 checks run BEFORE the INSERT and throw — a rollback then
            // leaves no line and no audit row (matches the web route's guards).
            guard let head = try Row.fetchOne(
                db,
                sql: "SELECT id, closed_at FROM inventory_counts WHERE id = ? AND location_id = ?",
                arguments: [countId, locationId]
            ) else { throw InventoryCountWriteError.countNotFound }
            let closedAt: String? = head["closed_at"]
            if closedAt != nil { throw InventoryCountWriteError.countClosed }

            // RETURNING gives the real row id even on the ON CONFLICT branch —
            // lastInsertedRowID advances even when a conflict suppresses the insert.
            guard let lineId = try Int64.fetchOne(db, sql: """
              INSERT INTO inventory_count_lines
                (count_id, vendor, ingredient, sku, on_hand_qty, unit, par_qty, par_unit,
                 note, counted_by, location_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(count_id, ingredient, sku) DO UPDATE SET
                vendor = excluded.vendor,
                on_hand_qty = excluded.on_hand_qty,
                unit = excluded.unit,
                par_qty = excluded.par_qty,
                par_unit = excluded.par_unit,
                note = excluded.note,
                counted_by = excluded.counted_by,
                counted_at = datetime('now')
              RETURNING id
              """, arguments: [countId, vendor, ingredient, sku, onHand, unit, parQty, parUnit,
                               note, cookId, locationId]) else {
                throw InventoryCountWriteError.persistenceFailed
            }
            // Audit verb is 'update' for BOTH the insert and conflict-update paths
            // (the audit_events CHECK has no 'upsert'), matching the web route.
            var payload: [String: String] = [
                "count_id": String(countId), "ingredient": ingredient, "sku": sku,
            ]
            if let onHand { payload["on_hand_qty"] = String(onHand) }
            if let unit { payload["unit"] = unit }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_count_lines",
                entityId: lineId,
                action: .update,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payload: payload,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))
            return lineId
        }
    }

    // ── PATCH /api/inventory/counts/[id] { close: true } ──

    public func closeCount(id: Int64, context: RegulatedWriteContext) throws {
        guard id > 0 else { throw InventoryCountWriteError.badId }
        let locationId = context.locationId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT id, closed_at FROM inventory_counts WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) else { throw InventoryCountWriteError.notFound }
            let closedAt: String? = row["closed_at"]
            if closedAt != nil { throw InventoryCountWriteError.countClosed }   // 409, already closed
            try db.execute(sql: "UPDATE inventory_counts SET closed_at = datetime('now') WHERE id = ?", arguments: [id])
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_counts", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payload: ["transition": "close"], shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── PATCH /api/inventory/counts/[id] { reopen: true } ──

    public func reopenCount(id: Int64, context: RegulatedWriteContext) throws {
        guard id > 0 else { throw InventoryCountWriteError.badId }
        let locationId = context.locationId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            // Web reopen does not require the count to be closed first — it
            // unconditionally clears closed_at and audits.
            guard try Row.fetchOne(
                db,
                sql: "SELECT id FROM inventory_counts WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) != nil else { throw InventoryCountWriteError.notFound }
            try db.execute(sql: "UPDATE inventory_counts SET closed_at = NULL WHERE id = ?", arguments: [id])
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_counts", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payload: ["transition": "reopen"], shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── helpers ──

    /// Mirror of the web `asNum`: null/non-finite → nil (empty-string coercion
    /// doesn't apply — the native input is already typed `Double?`).
    private func finite(_ v: Double?) -> Double? {
        guard let v, v.isFinite else { return nil }
        return v
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
