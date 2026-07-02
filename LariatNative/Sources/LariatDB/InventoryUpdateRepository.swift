import Foundation
import GRDB
import LariatModel

/// Repository for the inventory LOG + WASTE boards — behavior parity with
/// `app/api/inventory/route.ts` (GET log + POST update with T8 shrinkage) and the
/// waste view reads in `app/inventory/waste/page.jsx` (A4.1). Reads via the
/// read-only pool (open, no PIN); the log write goes through `AuditedWriteRunner`
/// so the `inventory_updates` row + its `audit_events` row commit in ONE
/// transaction. Writes tag `actor_source = native_cook` (web `'api'`); NO PIN gate.
///
/// The T8 cooking-shrinkage math lives in `InventoryShrinkage` (pure); this repo
/// does the `bom_lines.loss_factor` lookup and calls it, exactly like the route.
public struct InventoryUpdateRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET /api/inventory — a day's movements (newest first) ──

    public func listUpdates(
        date: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [InventoryUpdateRow] {
        let day = clip(date, max: 32) ?? ShiftDate.todayISO()
        return try await readDB.pool.read { db in
            try InventoryUpdateRow.fetchAll(db, sql: """
              SELECT id, shift_date, station_id, item, delta, direction, note, cook_id, created_at
                FROM inventory_updates
               WHERE shift_date = ? AND location_id = ?
               ORDER BY id DESC
              """, arguments: [day, locationId])
        }
    }

    // ── waste view reads (direction='waste', shift_date >= since) ──

    /// Recent waste rows over the window (`since` from `InventoryWaste.sinceDate`).
    public func wasteRecent(since: String, locationId: String = LocationScope.resolve()) async throws -> [InventoryUpdateRow] {
        try await readDB.pool.read { db in
            try InventoryUpdateRow.fetchAll(db, sql: """
              SELECT id, shift_date, station_id, item, delta, direction, note, cook_id, created_at
                FROM inventory_updates
               WHERE direction = 'waste' AND location_id = ? AND shift_date >= ?
               ORDER BY id DESC
               LIMIT 200
              """, arguments: [locationId, since])
        }
    }

    /// Waste rollup by item over the window (most-wasted first).
    public func wasteByItem(since: String, locationId: String = LocationScope.resolve()) async throws -> [WasteByItemRow] {
        try await readDB.pool.read { db in
            try WasteByItemRow.fetchAll(db, sql: """
              SELECT item, COUNT(*) AS hits, MAX(created_at) AS last_at
                FROM inventory_updates
               WHERE direction = 'waste' AND location_id = ? AND shift_date >= ?
               GROUP BY item
               ORDER BY hits DESC, last_at DESC
               LIMIT 20
              """, arguments: [locationId, since])
        }
    }

    // ── POST /api/inventory — log a movement (T8 shrinkage on toast) ──

    @discardableResult
    public func logUpdate(input: InventoryLogInput, context: RegulatedWriteContext) throws -> InventoryLogResult {
        guard let item = clip(input.item, max: 300) else { throw InventoryUpdateWriteError.itemRequired }
        let locationId = context.locationId
        let source = (clip(input.source, max: 32) ?? "manual").lowercased()
        let userNote = clip(input.note, max: 500)
        let direction = clip(input.direction, max: 16) ?? "out"
        // JSON transport parity: NaN/Infinity serialize to null in JS, so the
        // route never sees them — mirror that so typed callers behave the same.
        // (The invalid_cooked_qty path is reachable only by a direct pure-fn call.)
        let qty = input.qty.flatMap { $0.isFinite ? $0 : nil }
        let unit = clip(input.unit, max: 32)
        let recipeId = clip(input.recipeId, max: 200)
        let ingredient = clip(input.ingredient, max: 300)

        var delta = clip(input.delta, max: 64)
        var persistedNote = userNote
        var shrinkageApplied = false
        var shrinkageReason: String?
        var rawQty: Double?

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // T8 gate: source='toast' with enough context and a positive qty.
            if source == "toast", let qty, qty > 0, let recipeId, let ingredient {
                let math = try resolveCookingShrinkage(
                    db: db, recipeId: recipeId, ingredient: ingredient,
                    locationId: locationId, cookedQty: qty, unit: unit
                )
                delta = InventoryShrinkage.formatDepletionDelta(rawQty: math.rawQty, unit: unit)
                rawQty = math.rawQty
                shrinkageApplied = math.applied
                shrinkageReason = math.reason.rawValue
                let mathNote = InventoryShrinkage.formatShrinkageNote(math)
                persistedNote = userNote.map { "\(mathNote) | \($0)" } ?? mathNote
            } else if let qty, qty > 0, delta == nil {
                // Non-toast qty with no pre-formatted delta: render the same signed
                // shape as the toast path, minus the shrinkage adjustment.
                delta = InventoryShrinkage.formatDepletionDelta(rawQty: qty, unit: unit)
            }

            try db.execute(sql: """
              INSERT INTO inventory_updates
                (shift_date, station_id, item, delta, direction, note, cook_id, location_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              """, arguments: [
                clip(input.shiftDate, max: 32) ?? ShiftDate.todayISO(),
                clip(input.stationId, max: 64), item, delta, direction, persistedNote,
                context.actorCookId, locationId,
            ])
            let newId = db.lastInsertedRowID
            var payload: [String: String] = [
                "item": item, "direction": direction, "source": source,
                "shrinkage_applied": String(shrinkageApplied),
            ]
            if let delta { payload["delta"] = delta }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_updates",
                entityId: newId,
                action: .insert,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payload: payload,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))
            return InventoryLogResult(
                id: newId, source: source, delta: delta,
                shrinkageApplied: shrinkageApplied, shrinkageReason: shrinkageReason, rawQty: rawQty
            )
        }
    }

    // ── T8 DB lookup + math ──

    /// Look up ANY `bom_lines` row for (recipe, ingredient, location) — case-
    /// insensitive + whitespace-tolerant on ingredient — then apply the pure
    /// shrinkage math. No row → no_bom_line; a row with NULL loss_factor →
    /// no_loss_factor (matches `resolveCookingShrinkage` in the web module).
    private func resolveCookingShrinkage(
        db: Database, recipeId: String, ingredient: String,
        locationId: String, cookedQty: Double, unit: String?
    ) throws -> InventoryShrinkage.ShrinkageMath {
        let row = try Row.fetchOne(db, sql: """
          SELECT loss_factor FROM bom_lines
            WHERE recipe_id = ?
              AND LOWER(TRIM(ingredient)) = LOWER(TRIM(?))
              AND location_id = ?
            LIMIT 1
          """, arguments: [recipeId, ingredient, locationId])
        guard let row else {
            return InventoryShrinkage.ShrinkageMath(
                cookedQty: cookedQty, unit: unit, rawQty: cookedQty,
                applied: false, lossFactor: nil, reason: .noBomLine
            )
        }
        let lossFactor: Double? = row["loss_factor"]
        return InventoryShrinkage.applyShrinkage(cookedQty: cookedQty, lossFactor: lossFactor, unit: unit)
    }

    // ── helper ──

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
