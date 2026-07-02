import XCTest
@testable import LariatModel

/// Value-parity with the web oracle `tests/js/test-dish-cost-bridge.mjs`.
///
/// The oracle seeds a SQLite DB and calls `buildDishComponentMap` /
/// `computeDishCost`; the native compute is pure, so each seed helper here
/// constructs the row arrays the repository SQL would yield:
///   - `recipeCosts`      ← `SELECT … FROM recipe_costs WHERE recipe_id != 'TOTAL'`
///   - `vendorPrices`     ← the latest-`imported_at` join over `vendor_prices`
///   - `orderGuideItems`  ← `order_guide_items WHERE COALESCE(is_placeholder,0)=0`
///   - `dishComponents`   ← `dish_components` rows
///
/// The three `is_placeholder` oracle cases and the latest-`imported_at` pick
/// are SQL-layer behavior → covered by `CostingBridgeRepositoryTests`
/// (LariatDBTests) against a real GRDB fixture.
///
/// `computeMenuEngineering` (full bridged variant, `lib/menuEngineering.ts`)
/// has no dedicated web test file — those cases are authored directly against
/// the web code path and documented as such.
final class DishCostBridgeComputeTests: XCTestCase {

    // ── seed helpers mirroring the oracle's inserts ─────────────────────────

    private func recipe(_ slug: String, _ name: String, _ menuItems: [String]) -> BridgeRecipe {
        BridgeRecipe(slug: slug, name: name, menuItems: menuItems)
    }
    private func recipeCost(_ slug: String, _ name: String, _ costPerYieldUnit: Double, _ yieldUnit: String) -> BridgeRecipeCost {
        BridgeRecipeCost(recipeId: slug, recipeName: name, costPerYieldUnit: costPerYieldUnit, yieldUnit: yieldUnit)
    }
    private func vendorPrice(_ ingredient: String, _ unitPrice: Double, _ packUnit: String) -> BridgeVendorPrice {
        BridgeVendorPrice(ingredient: ingredient, unitPrice: unitPrice, packUnit: packUnit)
    }
    private func dishComp(_ dish: String, _ slug: String, _ qty: Double, _ unit: String) -> BridgeDishComponent {
        BridgeDishComponent(dishName: dish, componentType: "recipe", recipeSlug: slug,
                            vendorIngredient: nil, qtyPerServing: qty, unit: unit)
    }
    private func vendorComp(_ dish: String, _ ingredient: String, _ qty: Double, _ unit: String) -> BridgeDishComponent {
        BridgeDishComponent(dishName: dish, componentType: "vendor_item", recipeSlug: nil,
                            vendorIngredient: ingredient, qtyPerServing: qty, unit: unit)
    }
    private func sale(_ item: String, _ qty: Double, _ rev: Double) -> BridgeSalesRow {
        BridgeSalesRow(itemName: item, qty: qty, rev: rev)
    }

    private func buildMap(
        recipes: [BridgeRecipe] = [],
        recipeCosts: [BridgeRecipeCost] = [],
        vendorPrices: [BridgeVendorPrice] = [],
        orderGuideItems: [BridgeVendorPrice] = [],
        dishComponents: [BridgeDishComponent] = []
    ) -> [String: [DishComponentResolved]] {
        DishCostBridge.buildDishComponentMap(
            recipes: recipes, recipeCosts: recipeCosts, vendorPrices: vendorPrices,
            orderGuideItems: orderGuideItems, dishComponents: dishComponents)
    }

    // ── normalizeDishName ───────────────────────────────────────────────────

    // Oracle: "lowercases and collapses non-alphanumerics"
    func testNormalizeLowercasesAndCollapses() {
        XCTAssertEqual(DishCostBridge.normalizeDishName("Mtn Mac & Cheese"), "mtn mac cheese")
        XCTAssertEqual(DishCostBridge.normalizeDishName("THE ROPE BURGER"), "the rope burger")
        XCTAssertEqual(DishCostBridge.normalizeDishName("  Fish  &  Chips  "), "fish chips")
    }

    // Oracle: "returns empty string for null/undefined/empty"
    func testNormalizeEmptyForNilOrEmpty() {
        XCTAssertEqual(DishCostBridge.normalizeDishName(nil), "")
        XCTAssertEqual(DishCostBridge.normalizeDishName(""), "")
    }

    // Oracle: 'intentionally does NOT collapse "and" / "&" — alias is per-dish'
    func testNormalizeDoesNotCollapseAndAmpersand() {
        XCTAssertNotEqual(
            DishCostBridge.normalizeDishName("mac and cheese"),
            DishCostBridge.normalizeDishName("mac & cheese"))
    }

    // ── cleanedSalesRows ────────────────────────────────────────────────────

    // Oracle: "drops literal TOTAL/TOTALS Toast CSV footer noise"
    func testCleanedSalesDropsTotalFooterNoise() {
        let out = DishCostBridge.cleanedSalesRows([
            sale("TOTAL", 100, 1000),
            sale("TOTALS", 50, 500),
            sale("Real Dish", 10, 100),
            sale("  total  ", 1, 1),
        ])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].itemName, "Real Dish")
    }

    // Oracle: "drops empty / whitespace-only item_name"
    func testCleanedSalesDropsEmptyNames() {
        let out = DishCostBridge.cleanedSalesRows([
            sale("", 1, 1), sale("   ", 1, 1), sale("Burger", 1, 1),
        ])
        XCTAssertEqual(out.count, 1)
    }

    // ── buildDishComponentMap (declared-only path) ──────────────────────────

    // Oracle: "returns empty when no recipes and no dish_components"
    func testEmptyMapWhenNoInputs() {
        XCTAssertTrue(buildMap().isEmpty)
    }

    // Oracle: "declared-only: recipe.menu_items[] without dish_components → no_dish_component"
    func testDeclaredOnlyRecipeWithoutComponentRow() {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", ["The Rope Burger"])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")])
        let comps = m["the rope burger"]
        XCTAssertNotNil(comps)
        XCTAssertEqual(comps?.count, 1)
        XCTAssertEqual(comps?[0].componentType, "recipe")
        XCTAssertEqual(comps?[0].recipeSlug, "bacon_jam")
        XCTAssertNil(comps?[0].qtyPerServing)
        XCTAssertEqual(comps?[0].unitPrice, 4.0)
        XCTAssertEqual(comps?[0].baseUnit, "qt")
        XCTAssertEqual(comps?[0].status, .noDishComponent)
        XCTAssertNil(comps?[0].perServingCost)
    }

    // ── buildDishComponentMap (recipe-side cost roll-up) ────────────────────

    // Oracle: "fully linked: dish_component + recipe_cost → unit-converted per-serving $"
    func testFullyLinkedRecipeComponentUnitConverted() throws {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", ["The Rope Burger"])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")],       // $1/cup
            dishComponents: [dishComp("the rope burger", "bacon_jam", 0.5, "cup")]) // $0.50
        let comps = try XCTUnwrap(m["the rope burger"])
        XCTAssertEqual(comps[0].status, .ok)
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 0.5, accuracy: 0.001)
    }

    // Oracle: "dish_components row introduces a (dish, recipe) pair not in menu_items[]"
    func testDishComponentIntroducesUndeclaredPair() throws {
        let m = buildMap(
            recipes: [recipe("lariat_rub", "Lariat Rub", [])],
            recipeCosts: [recipeCost("lariat_rub", "Lariat Rub", 12.0, "cup")],
            dishComponents: [dishComp("grilled chicken", "lariat_rub", 0.25, "cup")]) // $3
        let comps = try XCTUnwrap(m["grilled chicken"])
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 3.0, accuracy: 1e-9)
    }

    // Oracle: "unit_convert_failed when component is weight, recipe yield is volume"
    func testUnitConvertFailedWeightToVolume() throws {
        let m = buildMap(
            recipes: [recipe("jam", "Jam", ["Toast Plate"])],
            recipeCosts: [recipeCost("jam", "Jam", 8.0, "qt")],
            dishComponents: [dishComp("toast plate", "jam", 30, "g")]) // weight → volume needs density
        let comps = try XCTUnwrap(m["toast plate"])
        XCTAssertEqual(comps[0].status, .unitConvertFailed)
        XCTAssertNil(comps[0].perServingCost)
    }

    // Oracle: "no_recipe_cost when dish_components exists but recipe_costs missing"
    func testNoRecipeCostStatus() throws {
        let m = buildMap(
            recipes: [recipe("mystery_sauce", "Mystery Sauce", [])],
            dishComponents: [dishComp("mystery dish", "mystery_sauce", 1, "oz")])
        let comps = try XCTUnwrap(m["mystery dish"])
        XCTAssertEqual(comps[0].status, .noRecipeCost)
        XCTAssertNil(comps[0].perServingCost)
    }

    // ── buildDishComponentMap (vendor_item path) ────────────────────────────

    // Oracle: "vendor_item with vendor_prices match → per-serving $ via unit_price × qty"
    func testVendorItemWithVendorPrice() throws {
        let m = buildMap(
            vendorPrices: [vendorPrice("Brioche Bun", 0.50, "each")],
            dishComponents: [vendorComp("rope burger", "Brioche Bun", 1, "each")])
        let comps = try XCTUnwrap(m["rope burger"])
        XCTAssertEqual(comps[0].componentType, "vendor_item")
        XCTAssertEqual(comps[0].vendorIngredient, "Brioche Bun")
        XCTAssertEqual(comps[0].status, .ok)
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 0.5, accuracy: 0.001)
    }

    // Oracle: "vendor_item falls back to order_guide_items when not in vendor_prices"
    func testVendorItemFallsBackToOrderGuide() throws {
        let m = buildMap(
            orderGuideItems: [vendorPrice("American Cheese Slice", 0.12, "each")],
            dishComponents: [vendorComp("cheeseburger", "American Cheese Slice", 2, "each")]) // $0.24
        let comps = try XCTUnwrap(m["cheeseburger"])
        XCTAssertEqual(comps[0].status, .ok)
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 0.24, accuracy: 0.001)
    }

    // Oracle: "vendor_item lookup is case-insensitive on ingredient"
    func testVendorLookupCaseInsensitive() throws {
        let m = buildMap(
            vendorPrices: [vendorPrice("BRIOCHE BUN", 0.50, "each")],
            dishComponents: [vendorComp("any dish", "brioche bun", 1, "each")])
        let comps = try XCTUnwrap(m["any dish"])
        XCTAssertEqual(comps[0].status, .ok)
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 0.5, accuracy: 0.001)
    }

    // Oracle: "no_vendor_price status when neither vendor_prices nor order_guide has the ingredient"
    func testNoVendorPriceStatus() throws {
        let m = buildMap(
            dishComponents: [vendorComp("mystery dish", "Unicorn Bacon", 1, "each")])
        let comps = try XCTUnwrap(m["mystery dish"])
        XCTAssertEqual(comps[0].status, .noVendorPrice)
        XCTAssertNil(comps[0].perServingCost)
    }

    // Oracle: "vendor_item unit conversion: lb-priced item with oz qty"
    func testVendorItemUnitConversionLbToOz() throws {
        // Ground beef priced at $5/lb. Burger uses 8 oz = 0.5 lb → $2.50.
        let m = buildMap(
            vendorPrices: [vendorPrice("80/20 Ground Beef", 5.0, "lb")],
            dishComponents: [vendorComp("rope burger", "80/20 Ground Beef", 8, "oz")])
        let comps = try XCTUnwrap(m["rope burger"])
        XCTAssertEqual(comps[0].status, .ok)
        XCTAssertEqual(try XCTUnwrap(comps[0].perServingCost), 2.5, accuracy: 0.001)
    }

    // Oracle: "vendor_prices preferred over order_guide_items when both exist"
    func testVendorPricesPreferredOverOrderGuide() throws {
        let m = buildMap(
            vendorPrices: [vendorPrice("Brioche Bun", 0.40, "each")],
            orderGuideItems: [vendorPrice("Brioche Bun", 0.99, "each")],
            dishComponents: [vendorComp("rope burger", "Brioche Bun", 1, "each")])
        let comps = try XCTUnwrap(m["rope burger"])
        XCTAssertEqual(comps[0].unitPrice, 0.40, "vendor_prices should win")
    }

    // ── buildDishComponentMap (mixed dish: recipe + vendor_item) ────────────

    // Oracle: "a single dish can hold both a sub-recipe and a distributor item"
    func testMixedRecipeAndVendorDish() throws {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", [])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")],  // $1/cup
            vendorPrices: [vendorPrice("Brioche Bun", 0.50, "each")],
            dishComponents: [
                dishComp("rope burger", "bacon_jam", 0.5, "cup"),        // $0.50
                vendorComp("rope burger", "Brioche Bun", 1, "each"),     // $0.50
            ])
        let r = DishCostBridge.computeDishCost(dishName: "Rope Burger", map: m)
        XCTAssertEqual(r.linkState, .fullyLinked)
        XCTAssertEqual(r.components.count, 2)
        XCTAssertEqual(try XCTUnwrap(r.totalCost), 1.0, accuracy: 0.001)
    }

    // ── computeDishCost ─────────────────────────────────────────────────────

    // Oracle: "multi-component recipe sum"
    func testMultiComponentRecipeSum() throws {
        let m = buildMap(
            recipes: [
                recipe("bacon_jam", "Bacon Jam", ["Rope"]),
                recipe("lariat_rub", "Lariat Rub", ["Rope"]),
            ],
            recipeCosts: [
                recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt"),
                recipeCost("lariat_rub", "Lariat Rub", 12.0, "cup"),
            ],
            dishComponents: [
                dishComp("rope", "bacon_jam", 0.5, "cup"),   // $0.50
                dishComp("rope", "lariat_rub", 0.1, "cup"),  // $1.20
            ])
        let r = DishCostBridge.computeDishCost(dishName: "Rope", map: m)
        XCTAssertEqual(r.linkState, .fullyLinked)
        XCTAssertEqual(r.components.count, 2)
        XCTAssertEqual(try XCTUnwrap(r.totalCost), 1.7, accuracy: 0.01)
    }

    // Oracle: "partial: one component costed, one missing qty"
    func testPartialOneCostedOneMissingQty() {
        let m = buildMap(
            recipes: [
                recipe("bacon_jam", "Bacon Jam", ["Rope"]),
                recipe("lariat_rub", "Lariat Rub", ["Rope"]),
            ],
            recipeCosts: [
                recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt"),
                recipeCost("lariat_rub", "Lariat Rub", 12.0, "cup"),
            ],
            dishComponents: [dishComp("rope", "bacon_jam", 0.5, "cup")])
        let r = DishCostBridge.computeDishCost(dishName: "Rope", map: m)
        XCTAssertEqual(r.linkState, .partial)
        XCTAssertFalse(r.fullyCosted)
        XCTAssertNotNil(r.totalCost)
    }

    // Oracle: "unlinked: no recipe declares this dish AND no dish_components row"
    func testUnlinkedDish() {
        let r = DishCostBridge.computeDishCost(dishName: "Bourbon Well", map: buildMap())
        XCTAssertEqual(r.linkState, .unlinked)
        XCTAssertEqual(r.components.count, 0)
        XCTAssertNil(r.totalCost)
    }

    // ── computeDishCoverage ─────────────────────────────────────────────────

    // Oracle: "counts coverage tiers correctly and filters TOTAL noise"
    func testCoverageCountsAndTotalFilter() {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", ["ROPE BURGER"])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")],
            dishComponents: [dishComp("rope burger", "bacon_jam", 0.5, "cup")])
        let report = DishCostBridge.computeDishCoverage(
            sales: [
                sale("ROPE BURGER", 100, 1000),
                sale("Bourbon Well", 50, 250),
                sale("TOTAL", 9999, 99999),
            ],
            map: m)
        XCTAssertEqual(report.totalSalesDishes, 2, "TOTAL must be filtered")
        XCTAssertEqual(report.fullyLinked, 1)
        XCTAssertEqual(report.unlinked, 1)
        XCTAssertEqual(report.unlinkedDishes.map(\.itemName), ["Bourbon Well"])
        XCTAssertEqual(report.unlinkedDishes[0].netSales, 250, accuracy: 1e-9)
    }

    // Coverage: declared-only dishes are listed with their component count
    // (web computeDishCoverage declared_only branch — authored, no oracle case).
    func testCoverageDeclaredOnlyList() {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", ["Toast Plate"])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")])
        let report = DishCostBridge.computeDishCoverage(
            sales: [sale("Toast Plate", 10, 100)], map: m)
        XCTAssertEqual(report.declaredOnly, 1)
        XCTAssertEqual(report.declaredOnlyDishes.map(\.itemName), ["Toast Plate"])
        XCTAssertEqual(report.declaredOnlyDishes[0].componentCount, 1)
    }

    // Coverage: unlinked dishes sorted by net sales DESC (web sort L448).
    func testCoverageUnlinkedSortedByNetSalesDesc() {
        let report = DishCostBridge.computeDishCoverage(
            sales: [sale("Small", 1, 10), sale("Big", 1, 500), sale("Mid", 1, 100)],
            map: buildMap())
        XCTAssertEqual(report.unlinkedDishes.map(\.itemName), ["Big", "Mid", "Small"])
    }

    // ── computeMenuEngineering (bridged) ────────────────────────────────────
    // No dedicated web test file exists for lib/menuEngineering.ts; these
    // cases are authored against the web code path (documented in the plan).

    // End-to-end: TOTAL filtered, cpu from the bridge, quadrant + coverage.
    func testMenuEngineeringEndToEnd() throws {
        let m = buildMap(
            recipes: [recipe("bacon_jam", "Bacon Jam", ["ROPE BURGER"])],
            recipeCosts: [recipeCost("bacon_jam", "Bacon Jam", 4.0, "qt")],   // $1/cup
            dishComponents: [dishComp("rope burger", "bacon_jam", 0.5, "cup")]) // $0.50
        let result = DishCostBridge.computeMenuEngineering(
            sales: [
                sale("ROPE BURGER", 100, 1000),   // avg $10, cpu $0.50 → margin 95%
                sale("Bourbon Well", 50, 250),    // unlinked → margin nil
                sale("TOTAL", 9999, 99999),       // footer noise → dropped
            ],
            map: m)

        XCTAssertEqual(result.rows.count, 2)
        let burger = try XCTUnwrap(result.rows.first { $0.itemName == "ROPE BURGER" })
        XCTAssertEqual(burger.avgPrice, 10.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(burger.costPerUnit), 0.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(burger.marginPct), 95.0, accuracy: 0.01)
        XCTAssertEqual(burger.linkState, .fullyLinked)
        XCTAssertEqual(burger.quadrant, .star)
        XCTAssertEqual(burger.components.count, 1)

        let well = try XCTUnwrap(result.rows.first { $0.itemName == "Bourbon Well" })
        XCTAssertNil(well.costPerUnit)
        XCTAssertNil(well.marginPct)
        XCTAssertEqual(well.linkState, .unlinked)
        XCTAssertEqual(well.quadrant, .unknown)

        XCTAssertEqual(result.coverage.fullyLinked, 1)
        XCTAssertEqual(result.coverage.unlinked, 1)
        XCTAssertEqual(result.coverage.total, 2)
        XCTAssertEqual(result.medianMargin, 95.0, accuracy: 0.01)
        // pops sorted [0.5, 1.0] → index count/2 = 1 → 1.0
        XCTAssertEqual(result.medianPop, 1.0, accuracy: 1e-9)
    }

    // qty=0 guard: avg_price=0 → margin nil even when the dish is costed
    // (web L84: `cpu != null && avg > 0`).
    func testMenuEngineeringZeroQtyYieldsNilMargin() throws {
        let m = buildMap(
            vendorPrices: [vendorPrice("Brioche Bun", 0.50, "each")],
            dishComponents: [vendorComp("freebie", "Brioche Bun", 1, "each")])
        let result = DishCostBridge.computeMenuEngineering(
            sales: [sale("Freebie", 0, 0)], map: m)
        let row = try XCTUnwrap(result.rows.first)
        XCTAssertEqual(row.avgPrice, 0)
        XCTAssertNotNil(row.costPerUnit)
        XCTAssertNil(row.marginPct)
        XCTAssertEqual(row.quadrant, .unknown)
    }

    // Empty sales → empty rows, medianMargin 0, medianPop 0.5 defaults
    // (web L107-111 fallbacks).
    func testMenuEngineeringEmptySalesDefaults() {
        let result = DishCostBridge.computeMenuEngineering(sales: [], map: buildMap())
        XCTAssertTrue(result.rows.isEmpty)
        XCTAssertEqual(result.medianMargin, 0)
        XCTAssertEqual(result.medianPop, 0.5)
        XCTAssertEqual(result.coverage.total, 0)
    }
}
