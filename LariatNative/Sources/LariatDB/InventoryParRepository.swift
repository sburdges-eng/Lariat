import Foundation
import GRDB
import LariatModel

/// Repository for the inventory PAR board — behavior parity with
/// `app/api/inventory/par/route.js` + `app/inventory/par/page.jsx` (A4.1).
/// Reads via the read-only pool (GET is open, no PIN); the upsert/delete writes
/// go through `AuditedWriteRunner` so the `inventory_par` mutation + its
/// `audit_events` row commit in ONE transaction.
///
/// `sku` is empty-string-not-NULL (the UNIQUE(location_id, ingredient, sku) key
/// and the COALESCE(sku,'') join key both depend on it). Writes are tagged
/// `actor_source = native_cook` (web uses `'api'`); this area has NO PIN gate.
public struct InventoryParRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — par list (optionally filtered by category) ────────────────

    public func load(
        category: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [InventoryParRow] {
        try await readDB.pool.read { db in
            var sql = """
              SELECT id, vendor, ingredient, sku, par_qty, par_unit, pack_size, pack_unit,
                     category, note, updated_at
                FROM inventory_par
               WHERE location_id = ?
              """
            var args: [DatabaseValueConvertible] = [locationId]
            if let category = clip(category, max: 64) {
                sql += " AND category = ?"
                args.append(category)
            }
            sql += " ORDER BY category, ingredient"
            return try InventoryParRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    // ── par-page LEFT JOIN — each par row + its latest counted on-hand ──

    public func loadWithLatestOnHand(
        onlyLow: Bool = false,
        locationId: String = LocationScope.resolve()
    ) async throws -> [InventoryParWithOnHand] {
        try await readDB.pool.read { db in
            // Latest count line per (ingredient, COALESCE(sku,'')) at this location,
            // LEFT-joined to par so never-counted items still show. Mirrors the web
            // par page (and the low-par predicate CommandRepository already uses).
            let rows = try Row.fetchAll(db, sql: """
              SELECT p.id, p.vendor, p.ingredient, p.sku, p.par_qty, p.par_unit,
                     p.pack_size, p.pack_unit, p.category, p.note, p.updated_at,
                     latest.on_hand_qty AS on_hand_qty, latest.unit AS on_hand_unit,
                     latest.counted_at AS counted_at, latest.counted_by AS counted_by
                FROM inventory_par p
                LEFT JOIN (
                  SELECT l1.ingredient, l1.sku, l1.on_hand_qty, l1.unit, l1.counted_at, l1.counted_by
                    FROM inventory_count_lines l1
                   WHERE l1.location_id = ?
                     AND l1.counted_at = (
                       SELECT MAX(l2.counted_at) FROM inventory_count_lines l2
                        WHERE l2.location_id = l1.location_id
                          AND l2.ingredient = l1.ingredient
                          AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
                     )
                ) latest
                  ON latest.ingredient = p.ingredient
                 AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
               WHERE p.location_id = ?
               ORDER BY p.category, p.ingredient
              """, arguments: [locationId, locationId])

            let mapped = rows.map { r -> InventoryParWithOnHand in
                let par = InventoryParRow(
                    id: r["id"], vendor: r["vendor"], ingredient: r["ingredient"], sku: r["sku"],
                    parQty: r["par_qty"], parUnit: r["par_unit"], packSize: r["pack_size"],
                    packUnit: r["pack_unit"], category: r["category"], note: r["note"],
                    updatedAt: r["updated_at"]
                )
                return InventoryParWithOnHand(
                    par: par, onHandQty: r["on_hand_qty"], onHandUnit: r["on_hand_unit"],
                    countedAt: r["counted_at"], countedBy: r["counted_by"]
                )
            }
            return onlyLow ? mapped.filter(\.isLow) : mapped
        }
    }

    // ── POST — upsert by (location, ingredient, sku) ────────────────────

    @discardableResult
    public func upsert(input: InventoryParUpsertInput, context: RegulatedWriteContext) throws -> InventoryParUpsertResult {
        guard let ingredient = clip(input.ingredient, max: 200) else {
            throw InventoryParWriteError.ingredientRequired
        }
        let sku = clip(input.sku, max: 80) ?? ""      // empty-string, not NULL
        let vendor = clip(input.vendor, max: 120)
        let parUnit = clip(input.parUnit, max: 32)
        let packSize = clip(input.packSize, max: 64)
        let packUnit = clip(input.packUnit, max: 32)
        let category = clip(input.category, max: 64)
        let note = clip(input.note, max: 500)
        let parQty = input.parQty
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let existingId = try Int64.fetchOne(
                db,
                sql: "SELECT id FROM inventory_par WHERE location_id = ? AND ingredient = ? AND sku = ?",
                arguments: [locationId, ingredient, sku]
            )
            let id: Int64
            let isInsert: Bool
            if let existingId {
                id = existingId
                isInsert = false
                try db.execute(sql: """
                  UPDATE inventory_par
                     SET vendor = ?, par_qty = ?, par_unit = ?, pack_size = ?, pack_unit = ?,
                         category = ?, note = ?, updated_at = datetime('now')
                   WHERE id = ?
                  """, arguments: [vendor, parQty, parUnit, packSize, packUnit, category, note, id])
            } else {
                try db.execute(sql: """
                  INSERT INTO inventory_par
                    (vendor, ingredient, sku, par_qty, par_unit, pack_size, pack_unit, category, note, location_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """, arguments: [vendor, ingredient, sku, parQty, parUnit, packSize, packUnit, category, note, locationId])
                id = db.lastInsertedRowID
                isInsert = true
            }
            var payload: [String: String] = ["ingredient": ingredient, "sku": sku]
            if let vendor { payload["vendor"] = vendor }
            if let parQty { payload["par_qty"] = String(parQty) }
            if let parUnit { payload["par_unit"] = parUnit }
            if let category { payload["category"] = category }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_par",
                entityId: id,
                action: isInsert ? .insert : .update,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payload: payload,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))
            return InventoryParUpsertResult(id: id, isInsert: isInsert)
        }
    }

    // ── DELETE — by id, location-scoped (404 cross-location) ────────────

    public func delete(id: Int64, context: RegulatedWriteContext) throws {
        guard id > 0 else { throw InventoryParWriteError.badId }
        let locationId = context.locationId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            let row = try Row.fetchOne(
                db,
                sql: "SELECT ingredient, sku FROM inventory_par WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
            guard let row else { throw InventoryParWriteError.notFound }
            try db.execute(sql: "DELETE FROM inventory_par WHERE id = ?", arguments: [id])
            let ingredient: String = row["ingredient"]
            let sku: String = row["sku"]
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_par",
                entityId: id,
                action: .delete,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payload: ["ingredient": ingredient, "sku": sku],
                shiftDate: context.shiftDate,
                locationId: locationId
            ))
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
