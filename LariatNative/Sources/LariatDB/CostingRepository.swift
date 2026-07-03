import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the Costing screen (`app/costing/page.jsx`).
///
/// Fetches:
///   1. Latest variance snapshot   — reuses P0 `AccountingVariance` record + SQL pattern
///   2. Latest dish-coverage       — reuses P0 `DishCoverageSnapshot` record + SQL pattern
///   3. Aggregated sales lines     — for menu engineering + ABC computation
///   4. Variance trend rows        — for `getVarianceTrend` (28-day window, period_end column)
///
/// No aggregation or classification is performed here; that is `CostingCompute`'s job.
/// All queries are location-scoped via `locationId`.
///
/// ── Reuse note ────────────────────────────────────────────────────────────────
/// Queries 1 and 2 are deliberately identical to `ManagementRollupRepository.load()`'s
/// variance and coverage fetches (same SQL, same record types). We do NOT call
/// ManagementRollupRepository to avoid coupling two repositories; the SQL is a
/// one-liner each and the record types live in LariatModel/Records.swift.
public struct CostingRepository {
    let database: LariatDatabase
    let locationId: String
    /// Discovery layer for the dish-cost bridge (`recipes.menu_items[]`) —
    /// loaded from `data/cache/recipes.json` by the caller (mirrors the web
    /// threading `getRecipes()` into `buildDishComponentMap`). Defaults to []
    /// so pre-bridge call sites keep working (declared-only links then come
    /// solely from dish_components rows).
    let recipes: [BridgeRecipe]

    public init(
        database: LariatDatabase,
        locationId: String = LocationScope.resolve(),
        recipes: [BridgeRecipe] = []
    ) {
        self.database = database
        self.locationId = locationId
        self.recipes = recipes
    }

    public func fetch() async throws -> CostingBundle {
        try await database.pool.read { db in

            // 1. Latest variance snapshot (reuse P0 AccountingVariance record)
            //    Mirrors ManagementRollupRepository.load() variance fetch.
            //    SQL: SELECT * FROM accounting_variance WHERE location_id=?
            //           ORDER BY snapshot_at DESC, id DESC LIMIT 1
            let latestVariance = try AccountingVariance.fetchOne(db,
                sql: """
                    SELECT * FROM accounting_variance
                     WHERE location_id = ?
                     ORDER BY snapshot_at DESC, id DESC
                     LIMIT 1
                    """,
                arguments: [locationId])

            // 2. Latest dish-coverage snapshot (reuse P0 DishCoverageSnapshot record)
            //    Mirrors ManagementRollupRepository.load() coverage fetch.
            //    SQL: SELECT * FROM dish_coverage_snapshots WHERE location_id=?
            //           ORDER BY snapshot_at DESC, id DESC LIMIT 1
            let latestCoverage = try DishCoverageSnapshot.fetchOne(db,
                sql: """
                    SELECT * FROM dish_coverage_snapshots
                     WHERE location_id = ?
                     ORDER BY snapshot_at DESC, id DESC
                     LIMIT 1
                    """,
                arguments: [locationId])

            // 3. Aggregated sales lines for menu engineering + ABC.
            //    Mirrors the SELECT in computeMenuEngineering() (lib/menuEngineering.ts):
            //      SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
            //        FROM sales_lines WHERE location_id=? GROUP BY item_name
            //    Filtered quantity_sold > 0 to skip TOTAL/footer rows.
            //    Ordered rev DESC to match the analytics top-item convention (stable order).
            //
            //    cost_per_unit comes from the dish-cost bridge (A4.3 T1) —
            //    dish_components → recipe_costs / vendor_prices / order_guide_items,
            //    exactly the web `computeDishCost` roll-up. This replaces the former
            //    `CAST(NULL AS REAL)` staging column (T10/T14 parity gap: RESOLVED).
            let aggregated = try Row.fetchAll(db,
                sql: """
                    SELECT item_name,
                           SUM(quantity_sold)  AS qty,
                           SUM(net_sales)      AS rev
                      FROM sales_lines
                     WHERE location_id = ?
                       AND quantity_sold > 0
                     GROUP BY item_name
                     ORDER BY rev DESC
                    """,
                arguments: [locationId])

            let bridgeInputs = try Self.fetchBridgeInputs(db: db, locationId: locationId)
            let map = DishCostBridge.buildDishComponentMap(
                recipes: recipes,
                recipeCosts: bridgeInputs.recipeCosts,
                vendorPrices: bridgeInputs.vendorPrices,
                orderGuideItems: bridgeInputs.orderGuideItems,
                dishComponents: bridgeInputs.dishComponents)

            let salesLines: [CostingSalesLine] = aggregated.map { r in
                let itemName: String = r["item_name"]
                let cost = DishCostBridge.computeDishCost(dishName: itemName, map: map).totalCost
                return CostingSalesLine(
                    itemName: itemName,
                    qty: r["qty"] ?? 0,
                    rev: r["rev"] ?? 0,
                    costPerUnit: cost)
            }

            // 4. Variance trend rows — 28-day window relative to MAX(period_end).
            //    Mirrors getVarianceTrend() in lib/varianceTrend.ts:
            //      Step 1: find MAX(period_end) to anchor the window.
            //      Step 2: select rows where period_end >= (MAX - windowDays).
            //    Uses period_end column (added in T10 fixture extension).
            //    Rows without period_end (P0 snapshot rows) are excluded via IS NOT NULL.
            let latestPeriodEnd = try String.fetchOne(db,
                sql: """
                    SELECT MAX(period_end) FROM accounting_variance
                     WHERE location_id = ? AND period_end IS NOT NULL
                    """,
                arguments: [locationId])

            let varianceTrendRows: [CostingVarianceTrendRow]
            if let latest = latestPeriodEnd {
                // Compute cutoff: windowDays before latest period_end.
                // Use SQLite date arithmetic to stay in DB and avoid Swift Date parsing.
                varianceTrendRows = try CostingVarianceTrendRow.fetchAll(db,
                    sql: """
                        SELECT period_start, period_end, variance_amount, variance_pct
                          FROM accounting_variance
                         WHERE location_id = ?
                           AND period_end IS NOT NULL
                           AND period_end >= date(?, '-28 days')
                         ORDER BY period_end ASC
                        """,
                    arguments: [locationId, latest])
            } else {
                varianceTrendRows = []
            }

            // 5. A4 recipe-level cost-variance card (computeCostVariance parity).
            let recipeCostVariance = try Self.fetchRecipeCostVariance(db: db, locationId: locationId)

            return CostingBundle(
                latestVariance:     latestVariance,
                latestCoverage:     latestCoverage,
                salesLines:         salesLines,
                varianceTrendRows:  varianceTrendRows,
                recipeCostVariance: recipeCostVariance
            )
        }
    }

    // ── Recipe cost-variance inputs (A4 card) ─────────────────────────────────

    /// Runs the SELECTs `computeCostVariance` (lib/costingBenchmarks.mjs L141)
    /// embeds and feeds `CostVarianceCompute`:
    ///   1. recipe_costs   — ALL rows for the location, unfiltered (the compute
    ///                       applies the web main-query filter; the same rowset
    ///                       also feeds the T10 sub-recipe map, exactly the two
    ///                       reads the web function makes).
    ///   2. bom_lines      — location-scoped (pack_price/pack_size omitted:
    ///                       unused post-D6).
    ///   3. vendor_prices  — location-scoped, ORDER BY imported_at DESC, id DESC
    ///                       (the ordering both the per-key "latest" pick and
    ///                       resolveMergedCost's latest-per-vendor mean rely on).
    ///   4. ingredient_densities / ingredient_unit_weights / ingredient_masters
    ///                       — global seed tables, read unscoped exactly as the
    ///                       web function does (they carry no location_id).
    ///
    /// Missing tables → `.empty` card; a missing `master_id` column (pre-T7
    /// fixture / partially-migrated DB) degrades to the normalized-key path
    /// (`NULL AS master_id`), mirroring the web's graceful partial-backfill
    /// behavior. ORDER BY id on reads 1-2 matches better-sqlite3's rowid scan
    /// order (same precedent as `fetchBridgeInputs`).
    static func fetchRecipeCostVariance(db: Database, locationId: String) throws -> RecipeCostVariance {
        guard try db.tableExists("recipe_costs"),
              try db.tableExists("bom_lines"),
              try db.tableExists("vendor_prices") else { return .empty }

        let recipeRows: [CostVarianceRecipeRow] = try Row.fetchAll(db,
            sql: """
                SELECT recipe_id, recipe_name, cost_per_yield_unit, yield, yield_unit, batch_cost
                  FROM recipe_costs
                 WHERE location_id = ?
                 ORDER BY id
                """,
            arguments: [locationId]
        ).map { r in
            CostVarianceRecipeRow(
                recipeId: r["recipe_id"],
                recipeName: r["recipe_name"],
                costPerYieldUnit: r["cost_per_yield_unit"],
                yield: r["yield"],
                yieldUnit: r["yield_unit"],
                batchCost: r["batch_cost"])
        }

        let bomMasterSel = try db.columns(in: "bom_lines").contains { $0.name == "master_id" }
            ? "master_id" : "NULL AS master_id"
        let bomRows: [CostVarianceBomLine] = try Row.fetchAll(db,
            sql: """
                SELECT recipe_id, ingredient, \(bomMasterSel), qty, unit, yield_pct, loss_factor
                  FROM bom_lines
                 WHERE location_id = ?
                 ORDER BY id
                """,
            arguments: [locationId]
        ).map { r in
            CostVarianceBomLine(
                recipeId: r["recipe_id"],
                ingredient: r["ingredient"],
                masterId: r["master_id"],
                qty: r["qty"],
                unit: r["unit"],
                yieldPct: r["yield_pct"],
                lossFactor: r["loss_factor"])
        }

        let vpMasterSel = try db.columns(in: "vendor_prices").contains { $0.name == "master_id" }
            ? "master_id" : "NULL AS master_id"
        let vendorRows: [CostVarianceVendorPrice] = try Row.fetchAll(db,
            sql: """
                SELECT ingredient, \(vpMasterSel), vendor, pack_price, pack_size, pack_unit
                  FROM vendor_prices
                 WHERE location_id = ?
                 ORDER BY imported_at DESC, id DESC
                """,
            arguments: [locationId]
        ).map { r in
            CostVarianceVendorPrice(
                ingredient: r["ingredient"],
                masterId: r["master_id"],
                vendor: r["vendor"],
                packPrice: r["pack_price"],
                packSize: r["pack_size"],
                packUnit: r["pack_unit"])
        }

        var densities: [CostVarianceDensityRow] = []
        if try db.tableExists("ingredient_densities") {
            densities = try Row.fetchAll(db,
                sql: "SELECT ingredient_key, g_per_ml FROM ingredient_densities"
            ).compactMap { r in
                guard let key: String = r["ingredient_key"], let g: Double = r["g_per_ml"] else {
                    return nil
                }
                return CostVarianceDensityRow(ingredientKey: key, gPerMl: g)
            }
        }

        var unitWeights: [CostVarianceUnitWeightRow] = []
        if try db.tableExists("ingredient_unit_weights") {
            unitWeights = try Row.fetchAll(db,
                sql: "SELECT ingredient_key, unit, g_per_unit FROM ingredient_unit_weights"
            ).compactMap { r in
                guard let key: String = r["ingredient_key"] else { return nil }
                return CostVarianceUnitWeightRow(
                    ingredientKey: key, unit: r["unit"], gPerUnit: r["g_per_unit"])
            }
        }

        // Web reads ingredient_masters only when master-joined vendor rows exist;
        // reading unconditionally is behavior-identical (the lookup is only
        // consulted on master hits) and keeps the fetch single-pass.
        var preferredVendorByMaster: [String: String] = [:]
        if try db.tableExists("ingredient_masters") {
            for r in try Row.fetchAll(db,
                sql: "SELECT master_id, preferred_vendor FROM ingredient_masters") {
                if let m: String = r["master_id"], let pv: String = r["preferred_vendor"] {
                    preferredVendorByMaster[m] = pv
                }
            }
        }

        return CostVarianceCompute.computeCostVariance(
            recipes: recipeRows,
            bomLines: bomRows,
            vendorPrices: vendorRows,
            densities: densities,
            unitWeights: unitWeights,
            preferredVendorByMaster: preferredVendorByMaster)
    }

    // ── Dish-cost bridge inputs (A4.3 T1) ─────────────────────────────────────

    /// The four DB-side inputs `DishCostBridge.buildDishComponentMap` needs.
    public struct DishBridgeInputs {
        public let recipeCosts: [BridgeRecipeCost]
        public let vendorPrices: [BridgeVendorPrice]
        public let orderGuideItems: [BridgeVendorPrice]
        public let dishComponents: [BridgeDishComponent]
    }

    /// Runs the SELECTs `lib/dishCostBridge.ts buildDishComponentMap` embeds:
    ///   1. recipe_costs      — location-scoped, `recipe_id != 'TOTAL'` (L136-142)
    ///   2. vendor_prices     — latest-imported_at join per ingredient (L158-171)
    ///   3. order_guide_items — non-placeholder fallback rows (L179-191)
    ///   4. dish_components   — all rows for the location (L242-247)
    ///
    /// A missing table is treated as an empty input (`db.tableExists` guard):
    /// pre-bridge fixture DBs / partially-migrated production copies must not
    /// break the whole costing fetch. ORDER BY id matches better-sqlite3's
    /// rowid scan order, so index precedence (last-write-wins for
    /// vendor_prices, first-write-wins for order_guide) is byte-parity.
    /// Shared with `MenuEngineeringRepository` — do not duplicate this SQL.
    static func fetchBridgeInputs(db: Database, locationId: String) throws -> DishBridgeInputs {
        var recipeCosts: [BridgeRecipeCost] = []
        if try db.tableExists("recipe_costs") {
            recipeCosts = try Row.fetchAll(db,
                sql: """
                    SELECT recipe_id, recipe_name, cost_per_yield_unit, yield_unit
                      FROM recipe_costs
                     WHERE location_id = ? AND recipe_id != 'TOTAL'
                     ORDER BY id
                    """,
                arguments: [locationId]
            ).map { r in
                BridgeRecipeCost(
                    recipeId: r["recipe_id"],
                    recipeName: r["recipe_name"],
                    costPerYieldUnit: r["cost_per_yield_unit"],
                    yieldUnit: r["yield_unit"])
            }
        }

        var vendorPrices: [BridgeVendorPrice] = []
        if try db.tableExists("vendor_prices") {
            vendorPrices = try Row.fetchAll(db,
                sql: """
                    SELECT vp.ingredient, vp.unit_price, vp.pack_unit
                      FROM vendor_prices vp
                      JOIN (
                        SELECT ingredient, MAX(imported_at) AS m
                          FROM vendor_prices
                         WHERE location_id = ?
                         GROUP BY ingredient
                      ) latest ON latest.ingredient = vp.ingredient AND latest.m = vp.imported_at
                     WHERE vp.location_id = ?
                     ORDER BY vp.id
                    """,
                arguments: [locationId, locationId]
            ).map { r in
                BridgeVendorPrice(ingredient: r["ingredient"], unitPrice: r["unit_price"], packUnit: r["pack_unit"])
            }
        }

        var orderGuideItems: [BridgeVendorPrice] = []
        if try db.tableExists("order_guide_items") {
            // Skip is_placeholder=1 rows — recipe-derived placeholder costs
            // must never leak into dish costing (web L179-191).
            orderGuideItems = try Row.fetchAll(db,
                sql: """
                    SELECT ingredient, unit_price, unit AS pack_unit
                      FROM order_guide_items
                     WHERE location_id = ?
                       AND COALESCE(is_placeholder, 0) = 0
                     ORDER BY id
                    """,
                arguments: [locationId]
            ).map { r in
                BridgeVendorPrice(ingredient: r["ingredient"], unitPrice: r["unit_price"], packUnit: r["pack_unit"])
            }
        }

        var dishComponents: [BridgeDishComponent] = []
        if try db.tableExists("dish_components") {
            dishComponents = try Row.fetchAll(db,
                sql: """
                    SELECT dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit
                      FROM dish_components
                     WHERE location_id = ?
                     ORDER BY id
                    """,
                arguments: [locationId]
            ).map { r in
                BridgeDishComponent(
                    dishName: r["dish_name"],
                    componentType: r["component_type"],
                    recipeSlug: r["recipe_slug"],
                    vendorIngredient: r["vendor_ingredient"],
                    qtyPerServing: r["qty_per_serving"],
                    unit: r["unit"])
            }
        }

        return DishBridgeInputs(
            recipeCosts: recipeCosts,
            vendorPrices: vendorPrices,
            orderGuideItems: orderGuideItems,
            dishComponents: dishComponents)
    }
}
