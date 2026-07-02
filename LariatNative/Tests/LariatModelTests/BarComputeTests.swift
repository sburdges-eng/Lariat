import XCTest
@testable import LariatModel

/// Value-parity tests for the /bar pour-cost dashboard compute
/// (`app/bar/page.jsx` — server component; no web test file exists, so these
/// cases are authored directly against the page code, lines cited inline).
final class BarComputeTests: XCTestCase {

    private func recipe(
        slug: String = "cocktail_test",
        name: String = "Test",
        category: String? = "cocktail",
        yieldQty: Double? = 1.5,
        yieldUnit: String? = "oz",
        menuItems: [BarMenuItemRef]? = nil
    ) -> BarRecipe {
        BarRecipe(slug: slug, name: name, category: category,
                  yieldQty: yieldQty, yieldUnit: yieldUnit, menuItems: menuItems)
    }

    private func cost(
        recipeId: String = "cocktail_test",
        cpu: Double? = 2.0,
        batchCost: Double? = nil,
        yield: Double? = 1.5,
        yieldUnit: String? = "oz"
    ) -> BarCostRow {
        BarCostRow(recipeId: recipeId, costPerYieldUnit: cpu,
                   batchCost: batchCost, yield: yield, yieldUnit: yieldUnit)
    }

    // ── isBarRecipe (page.jsx L58-73) ───────────────────────────────────

    func testIsBarRecipeByCategoryRegex() {
        for cat in ["cocktail", "Cocktails", "House Drinks", "beverage", "Beverages", "Spirits", "LIQUOR"] {
            XCTAssertTrue(BarCompute.isBarRecipe(recipe(category: cat)), cat)
        }
        for cat in ["sauce", "entree", "prep"] {
            XCTAssertFalse(BarCompute.isBarRecipe(recipe(slug: "aji_verde", category: cat, menuItems: nil)), cat)
        }
    }

    func testIsBarRecipeBySlugPrefix() {
        XCTAssertTrue(BarCompute.isBarRecipe(recipe(slug: "cocktail_margarita", category: "sauce")))
        XCTAssertTrue(BarCompute.isBarRecipe(recipe(slug: "drink_paloma", category: nil)))
        XCTAssertFalse(BarCompute.isBarRecipe(recipe(slug: "salsa_cocktail_sauce", category: "sauce")))
    }

    func testIsBarRecipeByPricedMenuItem() {
        // menu_items with an object entry carrying numeric price > 0 → bar menu.
        let priced = recipe(slug: "x", category: "sauce",
                            menuItems: [BarMenuItemRef(name: "Marg", price: 14, sizeOz: nil)])
        XCTAssertTrue(BarCompute.isBarRecipe(priced))
        // String entries (current data shape) carry no price → not bar by this rule.
        let strings = recipe(slug: "x", category: "sauce",
                             menuItems: [BarMenuItemRef(name: "Marg", price: nil, sizeOz: nil)])
        XCTAssertFalse(BarCompute.isBarRecipe(strings))
        // price 0 is not > 0.
        let zero = recipe(slug: "x", category: "sauce",
                          menuItems: [BarMenuItemRef(name: "Free", price: 0, sizeOz: nil)])
        XCTAssertFalse(BarCompute.isBarRecipe(zero))
    }

    // ── firstMenuPrice (L78-86) ─────────────────────────────────────────

    func testFirstMenuPricePicksFirstPricedEntry() {
        let r = recipe(menuItems: [
            BarMenuItemRef(name: "unpriced", price: nil, sizeOz: nil),
            BarMenuItemRef(name: "zero", price: 0, sizeOz: nil),
            BarMenuItemRef(name: "Marg", price: 14, sizeOz: 3),
            BarMenuItemRef(name: "Second", price: 16, sizeOz: 4),
        ])
        let mi = BarCompute.firstMenuPrice(r)
        XCTAssertEqual(mi?.name, "Marg")
        XCTAssertEqual(mi?.price, 14)
        XCTAssertEqual(mi?.sizeOz, 3)
    }

    func testFirstMenuPriceNilWhenNoObjects() {
        XCTAssertNil(BarCompute.firstMenuPrice(recipe(menuItems: nil)))
        XCTAssertNil(BarCompute.firstMenuPrice(recipe(menuItems: [BarMenuItemRef(name: "s", price: nil, sizeOz: nil)])))
    }

    // ── computePourCost (L89-113) ───────────────────────────────────────

    func testPourCostOzPrefersMenuSizeOz() {
        // yield_unit oz + menu size_oz 3 → cpu × 3 (not the recipe yield).
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: 1.5, yieldUnit: "oz"),
            recipe: recipe(),
            menuRef: BarMenuItemRef(name: "Marg", price: 14, sizeOz: 3)
        )
        XCTAssertEqual(v, 6.0)
    }

    func testPourCostOzFallsBackToCostRowYield() {
        // No size_oz → pour = cost-row yield (1.5 oz) → 2.0 × 1.5 = 3.0.
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: 1.5, yieldUnit: "oz"),
            recipe: recipe(), menuRef: nil
        )
        XCTAssertEqual(v, 3.0)
    }

    func testPourCostOzFallsBackToRecipeYieldQty() {
        // costRow.yield null → recipe.yield_qty (2.0) → 2.0 × 2.0 = 4.0.
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: nil, yieldUnit: "oz"),
            recipe: recipe(yieldQty: 2.0), menuRef: nil
        )
        XCTAssertEqual(v, 4.0)
    }

    func testPourCostSizeOzZeroFallsBackToYield() {
        // size_oz must be > 0 to be used (L100).
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: 1.5, yieldUnit: "oz"),
            recipe: recipe(),
            menuRef: BarMenuItemRef(name: "Marg", price: 14, sizeOz: 0)
        )
        XCTAssertEqual(v, 3.0)
    }

    func testPourCostEachReturnsCpu() {
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 4.25, yield: 1, yieldUnit: "each"),
            recipe: recipe(yieldUnit: "each"), menuRef: nil
        )
        XCTAssertEqual(v, 4.25)
    }

    func testPourCostNonPortionableUnitsReturnNil() {
        for unit in ["qt", "gal", "ml", "batch"] {
            XCTAssertNil(BarCompute.computePourCost(
                costRow: cost(cpu: 2.0, yield: 4, yieldUnit: unit),
                recipe: recipe(yieldUnit: unit), menuRef: nil
            ), unit)
        }
    }

    func testPourCostNilCpuOrNoYieldReturnsNil() {
        XCTAssertNil(BarCompute.computePourCost(costRow: nil, recipe: recipe(), menuRef: nil))
        XCTAssertNil(BarCompute.computePourCost(
            costRow: cost(cpu: nil, yield: 1.5, yieldUnit: "oz"), recipe: recipe(), menuRef: nil))
        // oz but no usable pour size anywhere → nil.
        XCTAssertNil(BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: nil, yieldUnit: "oz"),
            recipe: recipe(yieldQty: nil), menuRef: nil))
        // yield 0 is not > 0 → nil.
        XCTAssertNil(BarCompute.computePourCost(
            costRow: cost(cpu: 2.0, yield: 0, yieldUnit: "oz"),
            recipe: recipe(yieldQty: nil), menuRef: nil))
    }

    func testCostRowYieldUnitWinsOverRecipe() {
        // costRow.yield_unit ?? recipe.yield_unit (L93) — cost row wins.
        let v = BarCompute.computePourCost(
            costRow: cost(cpu: 3.0, yield: 1, yieldUnit: "each"),
            recipe: recipe(yieldUnit: "oz"), menuRef: nil
        )
        XCTAssertEqual(v, 3.0)
        // cost row yield_unit nil → falls back to recipe's ("each").
        let w = BarCompute.computePourCost(
            costRow: cost(cpu: 3.0, yield: 1, yieldUnit: nil),
            recipe: recipe(yieldUnit: "each"), menuRef: nil
        )
        XCTAssertEqual(w, 3.0)
    }

    // ── toneFor (L38-43): green ≤ 18 < yellow ≤ 22 < red; nil → gray ────

    func testToneThresholds() {
        XCTAssertEqual(BarCompute.tone(for: nil), .gray)
        XCTAssertEqual(BarCompute.tone(for: Double.nan), .gray)
        XCTAssertEqual(BarCompute.tone(for: 17.9), .green)
        XCTAssertEqual(BarCompute.tone(for: 18.0), .green)
        XCTAssertEqual(BarCompute.tone(for: 18.01), .yellow)
        XCTAssertEqual(BarCompute.tone(for: 22.0), .yellow)
        XCTAssertEqual(BarCompute.tone(for: 22.01), .red)
    }

    // ── buildRows (L139-185): pct math, gray reasons, sort, counts ──────

    func testBuildRowsPctGrayReasonsSortAndCounts() {
        let recipes = [
            // green: cost/pour 2.0×1.5=3.0, menu 20 → 15%
            recipe(slug: "cocktail_green", name: "Green", yieldQty: 1.5,
                   menuItems: [BarMenuItemRef(name: "G", price: 20, sizeOz: nil)]),
            // red: 3.0 / 12 → 25%
            recipe(slug: "cocktail_red", name: "Red", yieldQty: 1.5,
                   menuItems: [BarMenuItemRef(name: "R", price: 12, sizeOz: nil)]),
            // yellow: 3.0 / 15 → 20%
            recipe(slug: "cocktail_yellow", name: "Yellow", yieldQty: 1.5,
                   menuItems: [BarMenuItemRef(name: "Y", price: 15, sizeOz: nil)]),
            // gray — no cost row at all
            recipe(slug: "cocktail_nocost", name: "NoCost",
                   menuItems: [BarMenuItemRef(name: "N", price: 10, sizeOz: nil)]),
            // gray — costed but qt yield: not portionable
            recipe(slug: "cocktail_batch", name: "Batch", yieldUnit: "qt",
                   menuItems: [BarMenuItemRef(name: "B", price: 10, sizeOz: nil)]),
            // gray — portionable but no menu price
            recipe(slug: "cocktail_nomenu", name: "NoMenu", menuItems: nil),
        ]
        let costs = [
            cost(recipeId: "cocktail_green", cpu: 2.0),
            cost(recipeId: "cocktail_red", cpu: 2.0),
            cost(recipeId: "cocktail_yellow", cpu: 2.0),
            cost(recipeId: "cocktail_batch", cpu: 2.0, yield: 4, yieldUnit: "qt"),
            cost(recipeId: "cocktail_nomenu", cpu: 2.0),
        ]
        let rows = BarCompute.buildRows(recipes: recipes, costRows: costs)

        // Sort: red > yellow > green > gray (pct desc within tone).
        XCTAssertEqual(rows.map(\.slug).prefix(3), ["cocktail_red", "cocktail_yellow", "cocktail_green"])
        XCTAssertEqual(rows[0].pourCostPct.map { round($0 * 10) / 10 }, 25.0)
        XCTAssertEqual(rows[0].tone, .red)
        XCTAssertEqual(rows[1].pourCostPct.map { round($0 * 10) / 10 }, 20.0)
        XCTAssertEqual(rows[1].tone, .yellow)
        XCTAssertEqual(rows[2].pourCostPct.map { round($0 * 10) / 10 }, 15.0)
        XCTAssertEqual(rows[2].tone, .green)

        // Gray reasons (L150-157).
        let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.slug, $0) })
        XCTAssertEqual(byId["cocktail_nocost"]?.grayReason, "add recipe cost")
        XCTAssertEqual(byId["cocktail_batch"]?.grayReason, "yield not portionable")
        XCTAssertEqual(byId["cocktail_nomenu"]?.grayReason, "add menu price")
        XCTAssertNil(byId["cocktail_red"]?.grayReason)

        // Counts (L179-185).
        let counts = BarCompute.toneCounts(rows)
        XCTAssertEqual(counts[.red], 1)
        XCTAssertEqual(counts[.yellow], 1)
        XCTAssertEqual(counts[.green], 1)
        XCTAssertEqual(counts[.gray], 3)
    }

    func testBuildRowsUsesNameFallbackToSlug() {
        let rows = BarCompute.buildRows(
            recipes: [recipe(slug: "cocktail_x", name: "", menuItems: nil)],
            costRows: []
        )
        XCTAssertEqual(rows.first?.name, "cocktail_x")
    }

    // ── menu_items decode: strings and objects mix (forward-spec) ───────

    func testBarRecipeDecodesMixedMenuItems() throws {
        let json = """
        [{"slug":"cocktail_m","name":"Marg","category":"cocktail","yield_qty":1.5,
          "yield_unit":"oz",
          "menu_items":["House Marg", {"name":"Marg (rocks)","price":14,"size_oz":3}]}]
        """
        let recipes = try JSONDecoder().decode([BarRecipe].self, from: Data(json.utf8))
        XCTAssertEqual(recipes.count, 1)
        let items = recipes[0].menuItems ?? []
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[0].name, "House Marg")
        XCTAssertNil(items[0].price)
        XCTAssertEqual(items[1].price, 14)
        XCTAssertEqual(items[1].sizeOz, 3)
        // Non-numeric price in an object is ignored (typeof check on web).
        let badPrice = """
        [{"slug":"x","name":"X","category":"cocktail","yield_qty":1,"yield_unit":"oz",
          "menu_items":[{"name":"str-price","price":"14"}]}]
        """
        let bp = try JSONDecoder().decode([BarRecipe].self, from: Data(badPrice.utf8))
        XCTAssertNil(bp[0].menuItems?[0].price)
    }
}
