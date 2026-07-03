import XCTest
@testable import LariatModel

// Parity tests for `CostVarianceCompute.computeCostVariance` — the native port
// of `computeCostVariance` (lib/costingBenchmarks.mjs:141), the recipe-level
// theoretical-vs-actual cost variance behind the web costing page's B1 card.
//
// ── T1 DECISION (recorded per plan: docs/superpowers/plans/2026-07-03-lariat-native-a4-cost-variance.md) ──
//
//   NOT REUSABLE — `DishCostBridge.computeDishCost` does NOT match
//   `computeCostVariance`'s recipe re-pricing, so T2 adds a focused
//   `recipe_costs × bom_lines × vendor_prices` re-pricing helper.
//
//   Evidence: DishCostBridge prices *dishes* from `dish_components`
//   (qty_per_serving × latest `unit_price`) and lacks every element of the
//   B1 recipe re-pricing:
//     • no `bom_lines` input (qty / yield_pct / loss_factor adjustment),
//     • no `resolveMergedCost` master_id merge (preferred_vendor → mean of
//       latest-per-vendor unit costs),
//     • no `pack_price / pack_size` ratio with `convertPackSizeToLineUnit`
//       (count-bridge + density-driven pack→line unit conversion),
//     • no T10 sub-recipe batch_cost fallback,
//     • no D6 unmatched-line counting / 0.30 ratio gate.
//
//   Reused (NOT re-ported): `UnitConvert.normalizeUnit/unitDimension/convertQty`
//   and `IngredientKey.normalize`. Newly ported for this card (previously
//   deferred as out of scope for the depletion board): `UnitConvert.bridgeCount`,
//   `UnitConvert.convertPackSizeToLineUnit`, `IngredientKey.deriveMasterId`,
//   `CostVarianceCompute.resolveMergedCost`.
//
// ── GOLDEN FIXTURE ──
//
//   Mirrors tests/js/test-t9-benchmarks.mjs
//   "T9 / B1 — variance metric › aggregates: max / mean / recipes_over_5pct
//   match per-recipe values": three recipes at 0% / 3% / 10% drift
//   (bom pack $50/50lb vs vendor $50 / $51.5 / $55 per 50lb pack) →
//   max=10, mean=(0+3+10)/3→4.33, recipes_over_5pct=1.
//
//   Web semantics pinned here:
//     variance_pct = (|actual − theoretical| / theoretical) × 100, rounded 2dp
//     (JS Math.round semantics); aggregates over the ROUNDED per-recipe values;
//     unmatched gate is STRICTLY greater-than (ratio == 0.30 stays included);
//     over-5 count uses v >= 5 (exactly 5.0 counts).
final class CostVarianceComputeTests: XCTestCase {

    // ── Fixture builders ────────────────────────────────────────────────────

    private func recipe(
        _ id: String, name: String? = nil, cost: Double? = 1.0, yield: Double? = 1.0,
        yieldUnit: String? = "each", batchCost: Double? = nil
    ) -> CostVarianceRecipeRow {
        CostVarianceRecipeRow(
            recipeId: id, recipeName: name ?? id, costPerYieldUnit: cost,
            yield: yield, yieldUnit: yieldUnit, batchCost: batchCost)
    }

    private func bom(
        _ recipeId: String, _ ingredient: String, qty: Double? = 1.0, unit: String? = "lb",
        masterId: String? = nil, yieldPct: Double? = nil, lossFactor: Double? = nil
    ) -> CostVarianceBomLine {
        CostVarianceBomLine(
            recipeId: recipeId, ingredient: ingredient, masterId: masterId,
            qty: qty, unit: unit, yieldPct: yieldPct, lossFactor: lossFactor)
    }

    private func vp(
        _ ingredient: String, vendor: String? = "sysco", packPrice: Double?,
        packSize: Double? = 50.0, packUnit: String? = "lb", masterId: String? = nil
    ) -> CostVarianceVendorPrice {
        CostVarianceVendorPrice(
            ingredient: ingredient, masterId: masterId, vendor: vendor,
            packPrice: packPrice, packSize: packSize, packUnit: packUnit)
    }

    /// JS `Math.round(x * 100) / 100` for non-negative x (floor(x+0.5) form),
    /// used to derive expected values exactly as the web module rounds them.
    private func jsRound2(_ x: Double) -> Double { ((x * 100) + 0.5).rounded(.down) / 100 }

    // ── Golden parity (web t9 aggregates fixture) ───────────────────────────

    func testGoldenParityAggregatesMatchWebFixture() {
        // Three recipes at 0% / 3% / 10% drift, exactly as the web fixture
        // seeds them (theoretical=1.0, yield=1, one 1-lb line off a 50-lb pack).
        let recipes = [recipe("r_zero"), recipe("r_mid"), recipe("r_hi")]
        let bomLines = [
            bom("r_zero", "ing_r_zero"),
            bom("r_mid", "ing_r_mid"),
            bom("r_hi", "ing_r_hi"),
        ]
        let vendorPrices = [
            vp("ing_r_zero", packPrice: 50.0),
            vp("ing_r_mid", packPrice: 51.5),
            vp("ing_r_hi", packPrice: 55.0),
        ]

        let r = CostVarianceCompute.computeCostVariance(
            recipes: recipes, bomLines: bomLines, vendorPrices: vendorPrices)

        // Web: max_variance_pct=10, mean_variance_pct=4.33, recipes_over_5pct=1.
        XCTAssertEqual(r.max, 10.0, accuracy: 1e-6)
        XCTAssertEqual(r.mean, 4.33, accuracy: 1e-6)
        XCTAssertEqual(r.over5pctCount, 1)
        XCTAssertEqual(r.eligibleCount, 3)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 0)
        XCTAssertEqual(r.candidateCount, 3)

        // Top offenders sorted by variance desc (web rows sort).
        XCTAssertEqual(r.topOffenders.count, 3)
        XCTAssertEqual(r.topOffenders[0].name, "r_hi")
        XCTAssertEqual(r.topOffenders[0].variancePct, 10.0, accuracy: 1e-6)
        XCTAssertEqual(r.topOffenders[1].name, "r_mid")
        XCTAssertEqual(r.topOffenders[1].variancePct, 3.0, accuracy: 1e-6)
        XCTAssertEqual(r.topOffenders[2].name, "r_zero")
        XCTAssertEqual(r.topOffenders[2].variancePct, 0.0, accuracy: 1e-6)
    }

    func testZeroDriftIsExactlyZero() {
        // Web "zero-drift case": vendor pack_price == bom pack_price → 0 byte-exact.
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1", name: "R1")],
            bomLines: [bom("r1", "onion")],
            vendorPrices: [vp("onion", packPrice: 50.0)])
        XCTAssertEqual(r.max, 0.0)
        XCTAssertEqual(r.mean, 0.0)
        XCTAssertEqual(r.over5pctCount, 0)
        XCTAssertEqual(r.eligibleCount, 1)
    }

    // ── Boundary: empty / all-excluded ──────────────────────────────────────

    func testEmptyInputsYieldEmptyResult() {
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [], bomLines: [], vendorPrices: [])
        XCTAssertEqual(r.max, 0.0)
        XCTAssertEqual(r.mean, 0.0)
        XCTAssertEqual(r.over5pctCount, 0)
        XCTAssertEqual(r.eligibleCount, 0)
        XCTAssertEqual(r.candidateCount, 0)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 0)
        XCTAssertTrue(r.topOffenders.isEmpty)
    }

    func testAllRecipesExcludedYieldsEmptyAggregatesWithExclusionCount() {
        // Web D6 "pre-D6 fallback is gone": recipe with NO vendor matches is
        // entirely unmatched → excluded, aggregate stays 0, not fabricated.
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")],
            bomLines: [
                bom("r1", "a", qty: 0.5, yieldPct: 1.0, lossFactor: 0.0),
                bom("r1", "b", qty: 0.5, yieldPct: 1.0, lossFactor: 0.0),
            ],
            vendorPrices: [])
        XCTAssertEqual(r.max, 0.0)
        XCTAssertEqual(r.mean, 0.0)
        XCTAssertEqual(r.over5pctCount, 0)
        XCTAssertEqual(r.eligibleCount, 0)
        XCTAssertEqual(r.candidateCount, 1)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 1)
        XCTAssertTrue(r.topOffenders.isEmpty)
    }

    // ── Boundary: exactly 5% counts as over (web `v >= 5`) ──────────────────

    func testExactlyFivePercentCountsAsOver5() {
        // vendor 52.5 / 50-lb pack → actual 1.05 → variance rounds to exactly 5.0.
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")],
            bomLines: [bom("r1", "onion")],
            vendorPrices: [vp("onion", packPrice: 52.5)])
        XCTAssertEqual(r.eligibleCount, 1)
        XCTAssertEqual(r.max, 5.0, accuracy: 1e-6)
        XCTAssertEqual(r.over5pctCount, 1, "web counts v >= 5 as over — exactly 5.0 is included")
    }

    // ── Boundary: unmatched ratio exactly at threshold stays included ───────

    func testUnmatchedRatioExactlyAtThresholdIsIncluded() {
        // 10 cost-eligible lines, 3 unmatched → ratio 3/10 == 0.30 threshold.
        // Web gate is `ratio > threshold` (strict) → recipe stays included.
        var bomLines: [CostVarianceBomLine] = []
        var vendorPrices: [CostVarianceVendorPrice] = []
        for i in 0..<10 {
            let ing = "ing_\(i)"
            bomLines.append(bom("r1", ing, qty: 0.1))
            if i < 7 { vendorPrices.append(vp(ing, packPrice: 50.0)) }
        }
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")], bomLines: bomLines, vendorPrices: vendorPrices)
        XCTAssertEqual(r.eligibleCount, 1, "ratio == threshold must NOT exclude (web strict >)")
        XCTAssertEqual(r.excludedHighUnmatchedCount, 0)
        // 7 matched lines × 0.1 qty × $1/lb = 0.7 actual vs 1.0 theoretical → 30%.
        XCTAssertEqual(r.max, 30.0, accuracy: 1e-6)
    }

    func testUnmatchedRatioAboveThresholdExcludes() {
        // Web D6 "50% unmatched at default threshold 30%": 2 of 4 unmatched → excluded.
        let bomLines = [
            bom("r1", "a", qty: 0.25, yieldPct: 1.0, lossFactor: 0.0),
            bom("r1", "b", qty: 0.25, yieldPct: 1.0, lossFactor: 0.0),
            bom("r1", "c", qty: 0.25, yieldPct: 1.0, lossFactor: 0.0),
            bom("r1", "d", qty: 0.25, yieldPct: 1.0, lossFactor: 0.0),
        ]
        let vendorPrices = [vp("a", packPrice: 50.0), vp("b", packPrice: 50.0)]
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")], bomLines: bomLines, vendorPrices: vendorPrices)
        XCTAssertEqual(r.eligibleCount, 0)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 1)
        XCTAssertEqual(r.max, 0.0)
        XCTAssertEqual(r.mean, 0.0)
        XCTAssertEqual(r.over5pctCount, 0)
    }

    // ── Boundary: single eligible recipe ────────────────────────────────────

    func testSingleEligibleRecipeMeanEqualsMax() {
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1", name: "Demi")],
            bomLines: [bom("r1", "veal bones")],
            vendorPrices: [vp("veal bones", packPrice: 55.0)])
        XCTAssertEqual(r.eligibleCount, 1)
        XCTAssertEqual(r.max, 10.0, accuracy: 1e-6)
        XCTAssertEqual(r.mean, r.max, accuracy: 1e-6)
        XCTAssertEqual(r.topOffenders.count, 1)
        XCTAssertEqual(r.topOffenders[0].name, "Demi")
    }

    // ── Web T4 parity: cross-dim pack conversion via density ────────────────

    func testCrossDimPackUnitsConvertViaDensity() {
        // Mirrors web "converts cross-dim pack units via density: cup line off
        // a lb pack" — 1 cup of 'diced onion' priced off a 50-lb $50 pack with
        // g_per_ml=0.56.
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1", name: "R1")],
            bomLines: [bom("r1", "diced onion", unit: "cup")],
            vendorPrices: [vp("diced onion", packPrice: 50.0)],
            densities: [CostVarianceDensityRow(ingredientKey: "diced onion", gPerMl: 0.56)])
        XCTAssertEqual(r.eligibleCount, 1)
        // pack_size in cups: 50 lb × 453.59237 g/lb ÷ 0.56 g/ml ÷ 236.5882365 ml/cup
        let packCup = 50.0 * 453.59237 / 0.56 / 236.5882365
        let expectedActual = (1.0 * 50.0) / packCup   // yield = 1
        let expectedVariance = jsRound2(abs(expectedActual - 1.0) / 1.0 * 100.0)
        XCTAssertEqual(r.max, expectedVariance, accuracy: 1e-6)
    }

    func testCrossDimWithoutDensityCountsUnmatched() {
        // Web "counts a cross-dim line with no density as unmatched (D6 gate fires)".
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")],
            bomLines: [bom("r1", "mystery pulp", unit: "cup")],
            vendorPrices: [vp("mystery pulp", packPrice: 50.0)])
        XCTAssertEqual(r.eligibleCount, 0)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 1)
        XCTAssertEqual(r.max, 0.0)
    }

    // ── Web T7 parity: master_id merge path ─────────────────────────────────

    func testMasterMergePreferredVendorWins() {
        // Mirrors web T7 e2e "spec fixture: heinz_ketchup_1gal master" —
        // sysco $12/gal + shamrock $11/gal, preferred=shamrock → actual=11,
        // theoretical=11 → variance 0.
        let master = "heinz_ketchup_1gal"
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("burger", cost: 11.0, batchCost: 11.0)],
            bomLines: [bom("burger", "heinz ketchup 1gal", unit: "gal", masterId: master)],
            vendorPrices: [
                // Caller order = imported_at DESC, id DESC (web SQL).
                vp("heinz ketchup 1gal", vendor: "shamrock", packPrice: 11.0, packSize: 1.0,
                   packUnit: "gal", masterId: master),
                vp("heinz ketchup 1gal", vendor: "sysco", packPrice: 12.0, packSize: 1.0,
                   packUnit: "gal", masterId: master),
            ],
            preferredVendorByMaster: [master: "shamrock"])
        XCTAssertEqual(r.eligibleCount, 1)
        XCTAssertEqual(r.max, 0.0, accuracy: 1e-6)
    }

    func testMasterMergeMeanFallbackAcrossVendors() {
        // Web "without preferred_vendor, merged cost is the mean across vendors":
        // mean of $12 and $10 per gal = $11 → actual=11 vs theoretical=11 → 0.
        let master = "ketchup"
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("burger", cost: 11.0)],
            bomLines: [bom("burger", "ketchup", unit: "gal", masterId: master)],
            vendorPrices: [
                vp("ketchup", vendor: "shamrock", packPrice: 10.0, packSize: 1.0,
                   packUnit: "gal", masterId: master),
                vp("ketchup", vendor: "sysco", packPrice: 12.0, packSize: 1.0,
                   packUnit: "gal", masterId: master),
            ])
        XCTAssertEqual(r.eligibleCount, 1)
        XCTAssertEqual(r.max, 0.0, accuracy: 1e-6)
    }

    // ── Web T10 parity: sub-recipe batch_cost fallback ──────────────────────

    func testSubRecipeFallbackPricesUnmatchedLine() {
        // 'demi glace' has no vendor row but deriveMasterId('demi glace') →
        // 'demi_glace' resolves to a recipe_costs row (batch_cost=20, yield=4 cup)
        // → unit cost $5/cup; parent line 2 cup → contributes $10.
        let recipes = [
            recipe("entree", cost: 10.0),
            // Sub-recipe: no cost_per_yield_unit → NOT a variance candidate,
            // but present in the sub-recipe map (web reads all recipe_costs rows).
            recipe("demi_glace", cost: nil, yield: 4.0, yieldUnit: "cup", batchCost: 20.0),
        ]
        let r = CostVarianceCompute.computeCostVariance(
            recipes: recipes,
            bomLines: [bom("entree", "demi glace", qty: 2.0, unit: "cup")],
            vendorPrices: [])
        XCTAssertEqual(r.candidateCount, 1, "sub-recipe (nil cost) is not a candidate")
        XCTAssertEqual(r.eligibleCount, 1)
        // actual = 2 cup × $5/cup = 10 vs theoretical 10 → 0% variance.
        XCTAssertEqual(r.max, 0.0, accuracy: 1e-6)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 0)
    }

    // ── Yield adjustment parity (T3-identical factor) ───────────────────────

    func testYieldAdjustmentAppliesToMatchedLines() {
        // yield_pct=0.5, loss_factor=0 → adj = 1/(0.5×1) = 2 → actual doubles.
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1", cost: 2.0)],
            bomLines: [bom("r1", "onion", yieldPct: 0.5, lossFactor: 0.0)],
            vendorPrices: [vp("onion", packPrice: 50.0)])
        // actual = 1 × (50/50) × 2 = 2.0 vs theoretical 2.0 → 0%.
        XCTAssertEqual(r.eligibleCount, 1)
        XCTAssertEqual(r.max, 0.0, accuracy: 1e-6)
    }

    func testDegenerateYieldAdjustmentSkipsLineEntirely() {
        // yield_pct=0 → denom 0 → line skipped BEFORE totalLines counts it
        // (web: noise, not unmapped signal). Sole line skipped → totalLines=0
        // → recipe dropped silently (not excluded, not eligible).
        let r = CostVarianceCompute.computeCostVariance(
            recipes: [recipe("r1")],
            bomLines: [bom("r1", "onion", yieldPct: 0.0)],
            vendorPrices: [vp("onion", packPrice: 50.0)])
        XCTAssertEqual(r.eligibleCount, 0)
        XCTAssertEqual(r.excludedHighUnmatchedCount, 0)
        XCTAssertEqual(r.candidateCount, 1)
    }

    // ── resolveMergedCost unit parity (web T7 unit tests) ───────────────────

    private func mergedRow(
        vendor: String?, packPrice: Double?, packSize: Double?, packUnit: String? = nil
    ) -> CostVarianceVendorPrice {
        CostVarianceVendorPrice(
            ingredient: nil, masterId: nil, vendor: vendor,
            packPrice: packPrice, packSize: packSize, packUnit: packUnit)
    }

    func testResolveMergedCostEmptyOrDegenerateIsNil() {
        XCTAssertNil(CostVarianceCompute.resolveMergedCost(rows: [], preferredVendor: "sysco"))
        XCTAssertNil(CostVarianceCompute.resolveMergedCost(
            rows: [mergedRow(vendor: "sysco", packPrice: nil, packSize: 10)], preferredVendor: nil))
        XCTAssertNil(CostVarianceCompute.resolveMergedCost(
            rows: [mergedRow(vendor: "sysco", packPrice: -1, packSize: 10)], preferredVendor: nil))
    }

    func testResolveMergedCostPreferredVendorWins() {
        let merged = CostVarianceCompute.resolveMergedCost(
            rows: [
                mergedRow(vendor: "sysco", packPrice: 12, packSize: 1),
                mergedRow(vendor: "shamrock", packPrice: 11, packSize: 1),
            ],
            preferredVendor: "shamrock")
        XCTAssertNotNil(merged)
        XCTAssertEqual(merged?.packPrice, 11)
        XCTAssertEqual(merged?.source, .preferredVendor)
    }

    func testResolveMergedCostFallsBackToMeanWhenPreferredMissing() {
        let merged = CostVarianceCompute.resolveMergedCost(
            rows: [
                mergedRow(vendor: "sysco", packPrice: 12, packSize: 1),
                mergedRow(vendor: "shamrock", packPrice: 10, packSize: 1),
            ],
            preferredVendor: "usfoods")
        XCTAssertEqual(merged?.packPrice, 11)   // (12+10)/2
        XCTAssertEqual(merged?.source, .mean)
    }

    func testResolveMergedCostMeanUsesLatestPerVendor() {
        // First occurrence per vendor wins (caller order = imported_at DESC).
        let merged = CostVarianceCompute.resolveMergedCost(
            rows: [
                mergedRow(vendor: "sysco", packPrice: 12, packSize: 1),    // latest
                mergedRow(vendor: "sysco", packPrice: 20, packSize: 1),    // stale
                mergedRow(vendor: "shamrock", packPrice: 10, packSize: 1),
            ],
            preferredVendor: nil)
        XCTAssertEqual(merged?.packPrice, 11)
    }

    func testResolveMergedCostMeanOfUnitCostsNotRatioOfMeans() {
        // $24/2gal = $12/gal; $10/1gal = $10/gal → mean $11/gal, pack_size 1.
        let merged = CostVarianceCompute.resolveMergedCost(
            rows: [
                mergedRow(vendor: "sysco", packPrice: 24, packSize: 2),
                mergedRow(vendor: "shamrock", packPrice: 10, packSize: 1),
            ],
            preferredVendor: nil)
        XCTAssertEqual(merged?.source, .mean)
        XCTAssertEqual(merged?.packSize, 1)
        XCTAssertEqual(merged?.packPrice, 11)
    }

    // ── Newly ported UnitConvert helpers (lib/unitConvert.mjs parity) ───────

    func testBridgeCountCountToWeight() {
        // 12 ea × 50 g/ea = 600 g → / 453.59237 = lb.
        let r = UnitConvert.bridgeCount(12, from: "ea", to: "lb", density: nil,
                                        unitWeights: ["ea": 50.0])
        XCTAssertNotNil(r)
        XCTAssertEqual(r!, 600.0 / 453.59237, accuracy: 1e-12)
    }

    func testBridgeCountRefusesWithoutUnitWeight() {
        XCTAssertNil(UnitConvert.bridgeCount(12, from: "ea", to: "lb", density: nil,
                                             unitWeights: nil))
    }

    func testConvertPackSizeIdentityFallbackWhenPackUnitUnknown() {
        // packUnit empty/unknown → identity fallback (legacy T3 assumption).
        let r = UnitConvert.convertPackSizeToLineUnit(
            50, packUnit: nil, lineUnit: "lb", density: nil, unitWeights: nil)
        XCTAssertEqual(r.value, 50)
        XCTAssertFalse(r.flag)
    }

    func testConvertPackSizeFlagsWhenLineUnitUnknown() {
        let r = UnitConvert.convertPackSizeToLineUnit(
            50, packUnit: "lb", lineUnit: nil, density: nil, unitWeights: nil)
        XCTAssertNil(r.value)
        XCTAssertTrue(r.flag)
    }

    func testDeriveMasterIdSlug() {
        XCTAssertEqual(IngredientKey.deriveMasterId("Heinz Ketchup 1gal"), "heinz_ketchup_1gal")
        XCTAssertNil(IngredientKey.deriveMasterId("   "))
        XCTAssertNil(IngredientKey.deriveMasterId(nil))
    }
}
