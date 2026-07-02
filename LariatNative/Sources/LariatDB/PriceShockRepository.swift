import Foundation
import GRDB
import LariatModel

/// Per-ingredient join result: dishes/recipes whose recipe references the
/// price-shocked ingredient. Mirrors `lib/priceShockImpact.js` (`affectedDishes`
/// + `affectedRecipes`) — distinct, sorted, per ingredient.
public struct PriceShockImpact: Sendable, Equatable {
    public let dishes: [String]
    public let recipes: [String]
}

/// Reads `vendor_prices` + `vendor_prices_history` (both web-owned tables in
/// the shared lariat.db) and feeds `PriceShockCompute` / `PriceSeriesCompute`
/// — the SQL half of `lib/vendorPricesRepo.ts#listPriceShocks` /
/// `#listPriceSeries` + `lib/priceShockImpact.js`. Additive alongside
/// `ManagementRollupRepository.loadPriceShocks` (which stays untouched — it
/// powers the Command "Price moves" tile and only returns summary counts).
///
/// Read-only: goes through `LariatDatabase` (never `LariatWriteDatabase`);
/// this surface performs no regulated writes.
public struct PriceShockRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// Full price-shock board rows: the two-source UNION + live overlay,
    /// grouped/gated/sorted by `PriceShockCompute`.
    public func load(options: PriceShockOptions) async throws -> [PriceShockRow] {
        let sinceModifier = "-\(options.windowDays) days"
        return try await database.pool.read { db in
            let unionRows = try Row.fetchAll(db, sql: """
                SELECT vendor, sku, ingredient, category, snapshot_at, unit_price, source_order, row_order
                  FROM (
                    SELECT vendor, sku, ingredient, category, snapshot_at, unit_price,
                           0 AS source_order, id AS row_order
                      FROM vendor_prices_history
                     WHERE location_id = ? AND snapshot_at >= datetime('now', ?)
                       AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
                    UNION ALL
                    SELECT vendor, sku, ingredient, category,
                           COALESCE(imported_at, datetime('now')) AS snapshot_at, unit_price,
                           1 AS source_order, id AS row_order
                      FROM vendor_prices
                     WHERE location_id = ? AND COALESCE(imported_at, datetime('now')) >= datetime('now', ?)
                       AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
                  )
                 ORDER BY vendor, sku, ingredient, snapshot_at ASC, source_order ASC, row_order ASC
                """, arguments: [options.locationId, sinceModifier, options.locationId, sinceModifier])

            let inputs = unionRows.map { r -> PriceShockInput in
                PriceShockInput(
                    vendor: r["vendor"], sku: r["sku"],
                    ingredient: r["ingredient"] as String? ?? "",
                    category: r["category"], snapshotAt: r["snapshot_at"], unitPrice: r["unit_price"])
            }

            let liveRows = try Row.fetchAll(db, sql: """
                SELECT vendor, sku, ingredient, category, unit_price, imported_at
                  FROM vendor_prices
                 WHERE location_id = ?
                   AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
                """, arguments: [options.locationId])
            let live = liveRows.map { r -> PriceShockLive in
                PriceShockLive(
                    vendor: r["vendor"], sku: r["sku"],
                    ingredient: r["ingredient"] as String? ?? "",
                    category: r["category"], unitPrice: r["unit_price"], importedAt: r["imported_at"])
            }

            return PriceShockCompute.compute(inputs: inputs, live: live, options: options)
        }
    }

    /// Per-ingredient dish/recipe impact — port of `priceShockImpact.js`
    /// (`affectedDishes` exact-match `component_type = 'vendor_item'`,
    /// `affectedRecipes` fallback join on `bom_lines`). Short-circuits on an
    /// empty ingredient list (matches `ingredients.length === 0` guard).
    public func impact(ingredients: [String]) async throws -> [String: PriceShockImpact] {
        guard !ingredients.isEmpty else { return [:] }
        return try await database.pool.read { db in
            let placeholders = ingredients.map { _ in "?" }.joined(separator: ",")

            var dishArgs: [DatabaseValueConvertible] = [self.locationId]
            dishArgs.append(contentsOf: ingredients)
            let dishRows = try Row.fetchAll(db, sql: """
                SELECT vendor_ingredient AS ingredient, dish_name
                  FROM dish_components
                 WHERE location_id = ?
                   AND component_type = 'vendor_item'
                   AND vendor_ingredient IN (\(placeholders))
                """, arguments: StatementArguments(dishArgs))

            var recipeArgs: [DatabaseValueConvertible] = [self.locationId]
            recipeArgs.append(contentsOf: ingredients)
            let recipeRows = try Row.fetchAll(db, sql: """
                SELECT vendor_ingredient AS ingredient, recipe_id
                  FROM bom_lines
                 WHERE location_id = ?
                   AND vendor_ingredient IN (\(placeholders))
                """, arguments: StatementArguments(recipeArgs))

            var dishesByIngredient: [String: Set<String>] = [:]
            for r in dishRows {
                let ingredient: String = r["ingredient"]
                let dish: String = r["dish_name"]
                dishesByIngredient[ingredient, default: []].insert(dish)
            }
            var recipesByIngredient: [String: Set<String>] = [:]
            for r in recipeRows {
                let ingredient: String = r["ingredient"]
                let recipe: String = r["recipe_id"]
                recipesByIngredient[ingredient, default: []].insert(recipe)
            }

            var out: [String: PriceShockImpact] = [:]
            let allIngredients = Set(dishesByIngredient.keys).union(recipesByIngredient.keys)
            for ingredient in allIngredients {
                out[ingredient] = PriceShockImpact(
                    dishes: (dishesByIngredient[ingredient] ?? []).sorted(),
                    recipes: (recipesByIngredient[ingredient] ?? []).sorted())
            }
            return out
        }
    }

    /// Single-SKU price-history drill-down. Mirrors
    /// `vendorPricesRepo.ts:342-352` (`snapshot_at ASC, id ASC LIMIT ?`).
    /// Blank vendor/sku -> `[]` (no query issued), matching `isBlank`.
    public func series(options: PriceSeriesOptions) async throws -> PriceSeriesResult {
        guard !options.isBlank else { return PriceSeriesResult(points: []) }
        return try await database.pool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT snapshot_at, run_id, pack_size, pack_unit, pack_price, unit_price,
                       yield_pct, actual_received_lb, reconciled_unit_price, imported_at
                  FROM vendor_prices_history
                 WHERE location_id = ? AND vendor = ? AND sku = ?
                 ORDER BY snapshot_at ASC, id ASC
                 LIMIT ?
                """, arguments: [options.locationId, options.vendor, options.sku, options.limit])
            let points = rows.map { r -> PriceSeriesPoint in
                PriceSeriesPoint(
                    snapshotAt: r["snapshot_at"], runId: r["run_id"],
                    unitPrice: r["unit_price"], packPrice: r["pack_price"],
                    packSize: r["pack_size"], packUnit: r["pack_unit"])
            }
            return PriceSeriesResult(points: points)
        }
    }

    /// Zero-state discriminator: whether `vendor_prices_history` has any rows
    /// for this location (mirrors `page.jsx:154-156`) — tells the board
    /// whether "no movement" or "no data ingested yet" is the right message.
    public func historyCount() async throws -> Int {
        try await database.pool.read { db in
            try Int.fetchOne(db, sql: """
                SELECT COUNT(*) FROM vendor_prices_history WHERE location_id = ?
                """, arguments: [locationId]) ?? 0
        }
    }
}
