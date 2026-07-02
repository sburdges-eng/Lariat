import Foundation
import GRDB
import LariatModel

/// Ports `listDepletionExceptions` (lib/depletionExceptions.ts:72-165) — the
/// operator-triage queue of dishes whose Toast sales lines couldn't be
/// resolved into inventory depletions. Pure read: aggregates `sales_lines`
/// by dish (case-insensitive), then replays `DepletionExceptionResolver`
/// against current `dish_components` / `entities_recipes` / `bom_lines` for
/// each unique dish, keeping only dishes with a first unresolved reason.
///
/// The web applies `limit` as a break INSIDE the per-dish replay loop
/// (depletionExceptions.ts:162), NOT a SQL `LIMIT` — the aggregation SQL has
/// no `LIMIT` clause. This port mirrors that: full aggregation, then stop
/// once `exceptions.count >= limit`.
///
/// Read-only: goes through `LariatDatabase` (never `LariatWriteDatabase`) —
/// this surface performs no writes. The web route IS PIN-gated
/// (`requirePin` in route.js), but native manager/costing-tier reads are not
/// per-view PIN-gated today (matches the `priceShocks`/`varianceAttribution`
/// board precedent) — a deliberate, noted divergence, not an oversight.
public struct DepletionExceptionsRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func list(periodLabel: String? = nil, limit: Int = 200) async throws -> [DepletionException] {
        let cap = max(1, min(1000, limit))
        return try await database.pool.read { db in
            var whereClause = """
                location_id = ?
                    AND quantity_sold > 0
                    AND item_name IS NOT NULL
                    AND TRIM(item_name) != ''
                """
            var args: [DatabaseValueConvertible] = [locationId]
            if let p = periodLabel, !p.isEmpty {
                whereClause += " AND period_label = ?"
                args.append(p)
            }
            let aggSql = """
                WITH sales AS (
                  SELECT LOWER(TRIM(item_name)) AS item_key, TRIM(item_name) AS item_name,
                         quantity_sold, net_sales, imported_at, period_label
                    FROM sales_lines WHERE \(whereClause)),
                display_names AS (
                  SELECT item_key, item_name FROM (
                    SELECT item_key, item_name,
                           ROW_NUMBER() OVER (PARTITION BY item_key
                             ORDER BY quantity_sold DESC, COALESCE(net_sales,0) DESC, item_name ASC) AS display_rank
                      FROM sales) WHERE display_rank = 1),
                aggregates AS (
                  SELECT item_key, COUNT(*) AS affected_sales_count,
                         SUM(quantity_sold) AS total_quantity_sold, SUM(net_sales) AS total_net_sales,
                         MAX(imported_at) AS latest_imported_at,
                         GROUP_CONCAT(DISTINCT period_label) AS sample_period_labels
                    FROM sales GROUP BY item_key)
                SELECT display_names.item_name, aggregates.affected_sales_count,
                       aggregates.total_quantity_sold, aggregates.total_net_sales,
                       aggregates.latest_imported_at, aggregates.sample_period_labels
                  FROM aggregates JOIN display_names ON display_names.item_key = aggregates.item_key
                 ORDER BY COALESCE(aggregates.total_net_sales,0) DESC, aggregates.total_quantity_sold DESC
                """
            let rows = try Row.fetchAll(db, sql: aggSql, arguments: StatementArguments(args))

            var out: [DepletionException] = []
            for r in rows {
                let dishName: String = r["item_name"]
                let components = try Self.fetchComponents(db, dishName: dishName, locationId: locationId)

                // `firstUnresolved`'s fetch closures are non-throwing per its
                // pure-compute contract; capture the first SQL error (if any)
                // here and re-throw after the loop rather than silently
                // mapping a DB error onto a false "recipe missing yield" —
                // JS's synchronous resolveDepletionsForSale would throw
                // directly (salesDepletion.ts:132-137, 148-155).
                var sqlError: Error?
                let unresolved = DepletionExceptionResolver.firstUnresolved(
                    quantitySold: 1,
                    components: components,
                    yieldFor: { slug in
                        do { return try Self.fetchYield(db, slug: slug, locationId: locationId) }
                        catch { sqlError = error; return nil }
                    },
                    bomFor: { slug in
                        do { return try Self.fetchBom(db, slug: slug, locationId: locationId) }
                        catch { sqlError = error; return [] }
                    })
                if let sqlError { throw sqlError }

                guard let first = unresolved else { continue }
                let concat: String? = r["sample_period_labels"]
                out.append(DepletionException(
                    dishName: dishName,
                    reason: first.reason,
                    detail: first.detail,
                    affectedSalesCount: r["affected_sales_count"],
                    // JS: Number(r.total_quantity_sold ?? 0) — NULL coalesces to 0,
                    // never surfaces NaN (depletionExceptions.ts:154).
                    totalQuantitySold: Self.decodeQtyOrZero(r["total_quantity_sold"]),
                    totalNetSales: (r["total_net_sales"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue(r["total_net_sales"]),
                    latestImportedAt: r["latest_imported_at"],
                    // JS: r.sample_period_labels.split(',').slice(0, 5) — JS split
                    // keeps empty subsequences, so mirror with
                    // omittingEmptySubsequences: false for byte parity.
                    samplePeriodLabels: concat.map {
                        Array($0.split(separator: ",", omittingEmptySubsequences: false).prefix(5).map(String.init))
                    } ?? []))
                if out.count >= cap { break }
            }
            return out
        }
    }

    private static func fetchComponents(_ db: Database, dishName: String, locationId: String) throws -> [DishComponentRow] {
        try Row.fetchAll(db, sql: """
            SELECT component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit
              FROM dish_components
             WHERE LOWER(TRIM(dish_name)) = LOWER(TRIM(?)) AND location_id = ?
            """, arguments: [dishName, locationId]).map {
            DishComponentRow(componentType: $0["component_type"], recipeSlug: $0["recipe_slug"],
                             vendorIngredient: $0["vendor_ingredient"],
                             qtyPerServing: decodeQtyOrZero($0["qty_per_serving"]), unit: $0["unit"] ?? "")
        }
    }
    private static func fetchYield(_ db: Database, slug: String, locationId: String) throws -> RecipeYield? {
        guard let row = try Row.fetchOne(db, sql: """
            SELECT yield_qty, yield_unit FROM entities_recipes WHERE slug = ? AND location_id = ? LIMIT 1
            """, arguments: [slug, locationId]) else { return nil }
        let yq = (row["yield_qty"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue(row["yield_qty"])
        return RecipeYield(yieldQty: yq, yieldUnit: row["yield_unit"])
    }
    private static func fetchBom(_ db: Database, slug: String, locationId: String) throws -> [BomLineRow] {
        try Row.fetchAll(db, sql: """
            SELECT ingredient, qty, unit, loss_factor FROM bom_lines
             WHERE recipe_id = ? AND location_id = ? AND ingredient IS NOT NULL AND TRIM(ingredient) != ''
            """, arguments: [slug, locationId]).map {
            BomLineRow(ingredient: $0["ingredient"],
                       qty: ($0["qty"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue($0["qty"]),
                       unit: $0["unit"], lossFactor: ($0["loss_factor"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue($0["loss_factor"]))
        }
    }
    private static func decodeQtyOrZero(_ v: DatabaseValue) -> Double {
        if v.isNull { return 0 }
        if let d = Double.fromDatabaseValue(v) { return d }
        if let i = Int.fromDatabaseValue(v) { return Double(i) }
        return 0
    }
}
