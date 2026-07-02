import Foundation
import GRDB
import LariatModel

/// Read-only repository for the /bar surface (A6.2) — behavior parity with
/// `app/bar/page.jsx` + `app/bar/par/page.jsx`. Both web pages are
/// server-rendered reads: NO writes, NO audit events, NO PIN (`/bar` is not
/// in middleware SENSITIVE_PREFIXES). Recipes come from `BarRecipeLoader`
/// (data/cache/recipes.json); this repository supplies the SQL half.
public struct BarRepository: Sendable {
    private let readDB: LariatDatabase

    public init(readDB: LariatDatabase) {
        self.readDB = readDB
    }

    /// All `recipe_costs` rows for a location in one query (page.jsx L129-135).
    public func loadCostRows(
        locationId: String = LocationScope.resolve()
    ) async throws -> [BarCostRow] {
        try await readDB.pool.read { db in
            try BarCostRow.fetchAll(
                db,
                sql: """
                  SELECT recipe_id, cost_per_yield_unit, batch_cost, yield, yield_unit
                    FROM recipe_costs
                   WHERE location_id = ?
                  """,
                arguments: [locationId]
            )
        }
    }

    /// Bar-scoped par list — same latest-count LEFT JOIN as /inventory/par
    /// with the beverage-category WHERE clause (bar/par/page.jsx L57-84).
    /// Category list is parameterized, mirroring the web's placeholder build.
    public func loadParRows(
        locationId: String = LocationScope.resolve()
    ) async throws -> [BarParRow] {
        try await readDB.pool.read { db in
            let categories = BarCompute.barParCategories
            let placeholders = categories.map { _ in "?" }.joined(separator: ",")
            var args: [DatabaseValueConvertible] = [locationId, locationId]
            args.append(contentsOf: categories)
            return try BarParRow.fetchAll(
                db,
                sql: """
                  SELECT p.id, p.vendor, p.ingredient, p.sku, p.par_qty, p.par_unit,
                         p.pack_size, p.pack_unit, p.category,
                         latest.on_hand_qty, latest.unit AS on_hand_unit,
                         latest.counted_at, latest.counted_by
                    FROM inventory_par p
                    LEFT JOIN (
                      SELECT l1.ingredient, l1.sku, l1.on_hand_qty, l1.unit,
                             l1.counted_at, l1.counted_by
                        FROM inventory_count_lines l1
                       WHERE l1.location_id = ?
                         AND l1.counted_at = (
                           SELECT MAX(l2.counted_at)
                             FROM inventory_count_lines l2
                            WHERE l2.location_id = l1.location_id
                              AND l2.ingredient = l1.ingredient
                              AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
                         )
                    ) AS latest
                      ON latest.ingredient = p.ingredient
                     AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
                   WHERE p.location_id = ?
                     AND p.category IS NOT NULL
                     AND lower(p.category) IN (\(placeholders))
                   ORDER BY p.category, p.ingredient
                  """,
                arguments: StatementArguments(args)
            )
        }
    }
}
