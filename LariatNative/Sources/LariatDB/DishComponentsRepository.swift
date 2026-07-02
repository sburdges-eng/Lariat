import Foundation
import GRDB
import LariatModel

/// Reads/writes `dish_components` — behavior parity with
/// `app/api/dish-components/route.ts` (GET/POST/DELETE) and
/// `lib/dishComponentsRepo.ts#upsertDishComponent` (shared upsert SQL +
/// identical-row detection). Powers the `costing.components` editor.
///
/// Reads go through `LariatDatabase`; writes go through
/// `LariatWriteDatabase` in ONE transaction (`writeDB.write` == one GRDB
/// write transaction, mirroring the route's `db.transaction(...)`).
///
/// AUDIT POSTURE — web parity: the web route posts NO `audit_events` for
/// dish-components writes (it is a costing-bridge wiring surface, not a
/// regulated food-safety/financial log), so native posts none either. If
/// the web route ever gains `postAuditEvent`, add `AuditEventWriter.post`
/// inside the same `writeDB.write` block here.
///
/// NOT ported: `withIdempotency` (the web's idempotency_keys dedupe layer).
/// Native has no idempotency layer — deliberate divergence, documented per
/// the ingredient-masters precedent and asserted in the repository tests.
public struct DishComponentsRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let locationId: String

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase? = nil,
                locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    // ── GET /api/dish-components (route.ts L18-48) ──────────────────────────

    /// Optional `dish` filter matches `LOWER(TRIM(dish_name)) = normalizeDishName(dish)`
    /// — the route's quirk, verbatim (display-form queries find canonical rows).
    public func list(dish: String? = nil) async throws -> [DishComponentEditorRow] {
        let loc = locationId
        return try await readDB.pool.read { db in
            if let dish {
                let norm = DishCostBridge.normalizeDishName(dish)
                return try DishComponentEditorRow.fetchAll(db,
                    sql: """
                        SELECT * FROM dish_components
                         WHERE location_id = ? AND LOWER(TRIM(dish_name)) = ?
                         ORDER BY component_type, recipe_slug, vendor_ingredient
                        """,
                    arguments: [loc, norm])
            }
            return try DishComponentEditorRow.fetchAll(db,
                sql: """
                    SELECT * FROM dish_components
                     WHERE location_id = ?
                     ORDER BY dish_name, component_type, recipe_slug, vendor_ingredient
                    """,
                arguments: [loc])
        }
    }

    // ── POST /api/dish-components (route.ts L53-94 + repo upsert) ───────────

    public struct UpsertResult: Sendable, Equatable {
        public let outcome: DishComponentUpsertOutcome
        public let row: DishComponentEditorRow
    }

    /// Validate → normalize → clip → upsert. Rule failures throw typed
    /// `DishComponentWriteError`s BEFORE the transaction opens. The
    /// SELECT → INSERT/UPDATE runs atomically inside one write transaction
    /// (repo comment "ACID-C ... TOCTOU races").
    @discardableResult
    public func upsert(_ draft: DishComponentDraft) throws -> UpsertResult {
        guard let writeDB else { throw DishComponentWriteError.missingWriteDatabase }
        let row = try DishComponentValidation.prepare(draft)   // throws before any write

        return try writeDB.write { db in
            let existing = try Self.fetchExisting(db, row)

            if let existing,
               existing.qtyPerServing == row.qtyPerServing,
               existing.unit == row.unit,
               (existing.notes ?? nil) == (row.notes ?? nil) {
                return UpsertResult(outcome: .skipped, row: existing)
            }

            if row.componentType == "recipe" {
                try db.execute(
                    sql: """
                        INSERT INTO dish_components
                          (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
                           qty_per_serving, unit, notes)
                        VALUES (?, ?, 'recipe', ?, NULL, ?, ?, ?)
                        ON CONFLICT(location_id, dish_name, recipe_slug)
                          WHERE component_type = 'recipe'
                          DO UPDATE SET
                            qty_per_serving = excluded.qty_per_serving,
                            unit            = excluded.unit,
                            notes           = excluded.notes,
                            updated_at      = datetime('now')
                        """,
                    arguments: [row.locationId, row.dishName, row.recipeSlug,
                                row.qtyPerServing, row.unit, row.notes])
            } else {
                try db.execute(
                    sql: """
                        INSERT INTO dish_components
                          (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
                           qty_per_serving, unit, notes)
                        VALUES (?, ?, 'vendor_item', NULL, ?, ?, ?, ?)
                        ON CONFLICT(location_id, dish_name, vendor_ingredient)
                          WHERE component_type = 'vendor_item'
                          DO UPDATE SET
                            qty_per_serving = excluded.qty_per_serving,
                            unit            = excluded.unit,
                            notes           = excluded.notes,
                            updated_at      = datetime('now')
                        """,
                    arguments: [row.locationId, row.dishName, row.vendorIngredient,
                                row.qtyPerServing, row.unit, row.notes])
            }

            guard let refetched = try Self.fetchExisting(db, row) else {
                // Unreachable after a successful upsert; surface loudly if it ever isn't.
                throw DishComponentWriteError.missingWriteDatabase
            }
            return UpsertResult(outcome: existing != nil ? .updated : .inserted, row: refetched)
        }
    }

    private static func fetchExisting(_ db: Database, _ row: DishComponentWriteRow) throws -> DishComponentEditorRow? {
        if row.componentType == "recipe" {
            return try DishComponentEditorRow.fetchOne(db,
                sql: """
                    SELECT * FROM dish_components
                     WHERE location_id = ? AND dish_name = ?
                       AND component_type = 'recipe' AND recipe_slug = ?
                    """,
                arguments: [row.locationId, row.dishName, row.recipeSlug])
        }
        return try DishComponentEditorRow.fetchOne(db,
            sql: """
                SELECT * FROM dish_components
                 WHERE location_id = ? AND dish_name = ?
                   AND component_type = 'vendor_item' AND vendor_ingredient = ?
                """,
            arguments: [row.locationId, row.dishName, row.vendorIngredient])
    }

    // ── DELETE /api/dish-components (route.ts L98-116) ──────────────────────

    /// Delete by primary key. Web parity: id must be a positive integer
    /// (else 400 'id is required'); a missing id deletes nothing and still
    /// succeeds; there is NO location scoping on the DELETE.
    public func delete(id: Int64) throws {
        guard let writeDB else { throw DishComponentWriteError.missingWriteDatabase }
        guard id > 0 else { throw DishComponentWriteError.invalidId }
        try writeDB.write { db in
            try db.execute(sql: "DELETE FROM dish_components WHERE id = ?", arguments: [id])
        }
    }

    // ── Distributor candidates (components/page.tsx L60-96) ────────────────

    /// Editor datalist rows: vendor_prices (latest imported_at per
    /// ingredient) preferred, order_guide_items appended where the
    /// ingredient is absent (case-insensitive dedupe). NOTE: the page does
    /// NOT filter is_placeholder here — this is a picker, not a costing
    /// path — mirrored.
    public struct DistributorCandidate: Sendable, Equatable {
        public let ingredient: String
        public let unitPrice: Double?
        public let packUnit: String?
        public let source: String            // "vendor_prices" | "order_guide"
        public let vendor: String?
    }

    public func distributorCandidates() async throws -> [DistributorCandidate] {
        let loc = locationId
        return try await readDB.pool.read { db in
            let vendorRows = try Row.fetchAll(db,
                sql: """
                    SELECT vp.ingredient, vp.unit_price, vp.pack_unit, vp.vendor
                      FROM vendor_prices vp
                      JOIN (
                        SELECT ingredient, MAX(imported_at) AS m
                          FROM vendor_prices
                         WHERE location_id = ?
                         GROUP BY ingredient
                      ) latest ON latest.ingredient = vp.ingredient AND latest.m = vp.imported_at
                     WHERE vp.location_id = ?
                     ORDER BY vp.ingredient
                    """,
                arguments: [loc, loc])
            let orderGuideRows = try Row.fetchAll(db,
                sql: """
                    SELECT ingredient, unit_price, unit AS pack_unit, vendor
                      FROM order_guide_items
                     WHERE location_id = ?
                     ORDER BY ingredient
                    """,
                arguments: [loc])

            var seen = Set<String>()
            var out: [DistributorCandidate] = []
            for r in vendorRows {
                let ingredient: String = r["ingredient"]
                let key = ingredient.lowercased().trimmingCharacters(in: .whitespaces)
                if seen.contains(key) { continue }
                seen.insert(key)
                out.append(DistributorCandidate(
                    ingredient: ingredient, unitPrice: r["unit_price"],
                    packUnit: r["pack_unit"], source: "vendor_prices", vendor: r["vendor"]))
            }
            for r in orderGuideRows {
                let ingredient: String = r["ingredient"]
                let key = ingredient.lowercased().trimmingCharacters(in: .whitespaces)
                if seen.contains(key) { continue }
                seen.insert(key)
                out.append(DistributorCandidate(
                    ingredient: ingredient, unitPrice: r["unit_price"],
                    packUnit: r["pack_unit"], source: "order_guide", vendor: r["vendor"]))
            }
            return out
        }
    }
}
