// BeoCascadeComputeTests — drives the 5 build_cascade golden fixtures plus 3
// structural tests (warning scoping, prep-demand sort, map-warning merge)
// against the Swift port at Python parity.

import XCTest
@testable import LariatModel

final class BeoCascadeComputeTests: XCTestCase {

    private func accuracy(_ places: Int?) -> Double { pow(10.0, -Double(places ?? 6)) }

    private func runCascade(_ f: BeoFixture) -> BeoCascadeResult {
        BeoCascadeCompute.buildCascade(
            manifest: BeoFixtures.manifest(f),
            beoMap: BeoFixtures.beoMap(f),
            lineItems: BeoFixtures.lineItems(f),
            qtyInYieldUnits: f.input.qtyInYieldUnits ?? false,
            inventory: BeoFixtures.inventoryDict(f),
            scales: BeoFixtures.scalesDict(f)
        )
    }

    private func og(_ result: BeoCascadeResult, _ ingredient: String) -> CascadeOrderGuideRow? {
        result.orderGuide.first { $0.ingredient == ingredient }
    }

    // MARK: - Fixtures

    func testCascadeOrderGuideScaled() throws {
        let f = try BeoFixtures.load("cascade_order_guide_scaled")
        let r = runCascade(f)
        let acc = accuracy(f.expect.tolerancePlaces)
        for (name, expected) in f.expect.orderGuideByIngredient ?? [:] {
            guard let row = og(r, name) else { return XCTFail("missing order_guide row \(name)") }
            XCTAssertEqual(row.unit, expected.unit, "\(name) unit")
            XCTAssertEqual(row.totalNeeded, expected.totalNeeded, accuracy: acc, "\(name) total")
            XCTAssertEqual(row.onHand, expected.onHand, accuracy: acc, "\(name) onHand")
            XCTAssertEqual(row.toOrder, expected.toOrder, accuracy: acc, "\(name) toOrder")
        }
        if let total = f.expect.romaTomatoesTotal {
            XCTAssertEqual(og(r, "roma tomatoes")?.totalNeeded ?? .nan, total, accuracy: acc, "roma total")
        }
        if let total = f.expect.whiteCheeseTotal {
            XCTAssertEqual(og(r, "white american cheese")?.totalNeeded ?? .nan, total, accuracy: acc, "white cheese total")
        }
    }

    func testCascadePrepDemandsNodes() throws {
        let f = try BeoFixtures.load("cascade_prep_demands_nodes")
        let r = runCascade(f)
        let acc = accuracy(f.expect.tolerancePlaces)
        let expected = f.expect.prepDemands ?? []
        XCTAssertEqual(r.prepDemands.count, expected.count, "prep_demands count")
        for (i, e) in expected.enumerated() where i < r.prepDemands.count {
            XCTAssertEqual(r.prepDemands[i].recipeSlug, e.recipeSlug, "prep[\(i)] slug")
            XCTAssertEqual(r.prepDemands[i].displayName, e.displayName, "prep[\(i)] display")
            XCTAssertEqual(r.prepDemands[i].unit, e.unit, "prep[\(i)] unit")
            XCTAssertEqual(r.prepDemands[i].qty, e.qty, accuracy: acc, "prep[\(i)] qty")
        }
        if let slugs = f.expect.slugs {
            XCTAssertEqual(r.prepDemands.map(\.recipeSlug), slugs, "prep slugs")
        }
    }

    func testCascadeMissingSubWarning() throws {
        let f = try BeoFixtures.load("cascade_missing_sub_warning")
        let r = runCascade(f)
        if let needle = f.expect.warningsContain {
            XCTAssertTrue(r.warnings.contains { $0.contains(needle) }, "warnings contain \(needle): \(r.warnings)")
        }
        if let expected = f.expect.warnings {
            XCTAssertEqual(r.warnings, expected, "exact warnings")
        }
    }

    func testCascadeUnmappedMysteryItem() throws {
        let f = try BeoFixtures.load("cascade_unmapped_mystery_item")
        let r = runCascade(f)
        let expected = f.expect.unmappedMenuItems ?? []
        XCTAssertEqual(r.unmapped.map(\.menuItem), expected, "unmapped menu items")
    }

    func testCascadeInventorySubtract() throws {
        let f = try BeoFixtures.load("cascade_inventory_subtract")
        let r = runCascade(f)
        let acc = accuracy(f.expect.tolerancePlaces)
        guard let expected = f.expect.romaRow else { return XCTFail("no roma_row") }
        guard let row = og(r, "roma tomatoes") else { return XCTFail("missing roma order-guide row") }
        XCTAssertEqual(row.unit, expected.unit, "roma unit")
        XCTAssertEqual(row.totalNeeded, expected.totalNeeded, accuracy: acc, "roma total")
        XCTAssertEqual(row.onHand, expected.onHand, accuracy: acc, "roma onHand")
        XCTAssertEqual(row.toOrder, expected.toOrder, accuracy: acc, "roma toOrder")
    }

    // MARK: - Structural (fixture-less)

    private func leaf(_ ing: String, _ qty: Double, _ unit: String) -> BomRow {
        BomRow(ingredient: ing, qty: qty, unit: unit, isSubRecipe: false, subSlug: nil)
    }

    func testMapWarningsMergedIntoUnmapped() {
        let manifest = ["salsa": RecipeManifest(
            slug: "salsa", displayName: "Salsa", yieldQty: 1, yieldUnit: "qt",
            bom: [leaf("tomato", 1, "qt")]
        )]
        let result = BeoCascadeCompute.buildCascade(
            manifest: manifest,
            beoMap: ["side salsa": ["salsa"]],
            lineItems: [("Side Salsa", 1), ("Mystery Dish", 1)],
            mapWarnings: [CascadeUnmappedRow(menuItem: "(whole map file)", reason: "map references 'Ghost', no such recipe")]
        )
        // map-level warnings come FIRST, then per-row unmapped.
        XCTAssertEqual(result.unmapped.map(\.menuItem), ["(whole map file)", "Mystery Dish"])
    }

    func testPrepDemandsSortedByDisplayName() {
        // display names deliberately NOT in slug/insertion order.
        let manifest: [String: RecipeManifest] = [
            "zeta": RecipeManifest(slug: "zeta", displayName: "Apple Sauce", yieldQty: 1, yieldUnit: "qt", bom: [leaf("x", 1, "qt")]),
            "alpha": RecipeManifest(slug: "alpha", displayName: "Zucchini Puree", yieldQty: 1, yieldUnit: "qt", bom: [leaf("y", 1, "qt")]),
        ]
        let result = BeoCascadeCompute.buildCascade(
            manifest: manifest,
            beoMap: ["a": ["zeta"], "z": ["alpha"]],
            lineItems: [("A", 1), ("Z", 1)]
        )
        XCTAssertEqual(result.prepDemands.map(\.displayName), ["Apple Sauce", "Zucchini Puree"])
    }

    func testManifestWarningsScopedToReachableRecipes() {
        // `reached` (in the demand) declares an unreferenced sub → warned.
        // `unreached` (not in the demand) also has an orphan → must NOT appear.
        let manifest: [String: RecipeManifest] = [
            "reached": RecipeManifest(slug: "reached", displayName: "Reached", yieldQty: 1, yieldUnit: "qt",
                                      subRecipeSlugs: ["orphan_a"], bom: [leaf("water", 1, "qt")]),
            "unreached": RecipeManifest(slug: "unreached", displayName: "Unreached", yieldQty: 1, yieldUnit: "qt",
                                        subRecipeSlugs: ["orphan_b"], bom: [leaf("salt", 1, "qt")]),
            "orphan_a": RecipeManifest(slug: "orphan_a", displayName: "Orphan A", yieldQty: 1, yieldUnit: "qt"),
            "orphan_b": RecipeManifest(slug: "orphan_b", displayName: "Orphan B", yieldQty: 1, yieldUnit: "qt"),
        ]
        let result = BeoCascadeCompute.buildCascade(
            manifest: manifest,
            beoMap: ["reached item": ["reached"]],
            lineItems: [("Reached Item", 1)]
        )
        let warnedRecipes = Set(result.manifestWarnings.map(\.recipe))
        XCTAssertTrue(warnedRecipes.contains("reached"), "reached orphan should be warned")
        XCTAssertFalse(warnedRecipes.contains("unreached"), "unreached orphan must be scoped out")
    }

    // MARK: - Batch flooring (P3)
    //
    // A BEO orders and preps in batches. The Python engine floored in
    // 2026-07-28; the Swift port did not, and nothing gated the divergence.
    // Spec: docs/superpowers/specs/2026-07-28-beo-batch-ordering-design.md.

    /// Assert every prep row against the oracle, including the three
    /// quantities. Fails on the first mismatch with the recipe named, because
    /// "prep[2] order_qty" is not something you can read a diff of.
    private func assertPrepRows(
        _ result: BeoCascadeResult, _ f: BeoFixture, file: StaticString = #filePath, line: UInt = #line
    ) {
        let acc = accuracy(f.expect.tolerancePlaces)
        let expected = f.expect.prepDemands ?? []
        XCTAssertEqual(result.prepDemands.count, expected.count, "prep_demands count", file: file, line: line)
        for (i, e) in expected.enumerated() where i < result.prepDemands.count {
            let got = result.prepDemands[i]
            XCTAssertEqual(got.recipeSlug, e.recipeSlug, "prep[\(i)] slug", file: file, line: line)
            XCTAssertEqual(got.qty, e.qty, accuracy: acc, "\(e.recipeSlug) qty (consumption)", file: file, line: line)
            if let o = e.orderQty {
                XCTAssertEqual(got.orderQty, o, accuracy: acc, "\(e.recipeSlug) order_qty", file: file, line: line)
            }
            if let pq = e.prepQty {
                XCTAssertEqual(got.prepQty, pq, accuracy: acc, "\(e.recipeSlug) prep_qty", file: file, line: line)
            }
            if let b = e.batchQty {
                XCTAssertEqual(got.batchQty, b, accuracy: acc, "\(e.recipeSlug) batch_qty", file: file, line: line)
            }
        }
    }

    private func assertOrderGuide(
        _ result: BeoCascadeResult, _ f: BeoFixture, file: StaticString = #filePath, line: UInt = #line
    ) {
        guard let expected = f.expect.orderGuide else { return }
        let acc = accuracy(f.expect.tolerancePlaces)
        XCTAssertEqual(result.orderGuide.count, expected.count, "order_guide count", file: file, line: line)
        for (i, e) in expected.enumerated() where i < result.orderGuide.count {
            let got = result.orderGuide[i]
            XCTAssertEqual(got.ingredient, e.ingredient, "order[\(i)] ingredient", file: file, line: line)
            XCTAssertEqual(got.unit, e.unit, "\(e.ingredient) unit", file: file, line: line)
            XCTAssertEqual(got.totalNeeded, e.totalNeeded, accuracy: acc, "\(e.ingredient) total_needed", file: file, line: line)
            XCTAssertEqual(got.toOrder, e.toOrder, accuracy: acc, "\(e.ingredient) to_order", file: file, line: line)
        }
    }

    /// The spec's own worked example: 50 Nashville Sliders.
    ///
    /// | recipe          | eats     | order            | prep               |
    /// | Buttermilk Brine| 12.0 qt  | 1 batch — 12 qt  | 1.0 batch — 12 qt  |
    /// | Special Sauce   | 3.125 qt | 1 batch — 4 qt   | 1.0 batch — 4 qt   |
    /// | Coleslaw        | 3.125 qt | 1 batch — 12 qt  | 0.5 batch — 6 qt   |
    ///
    /// Coleslaw is the row that earns the order/prep distinction: buy the
    /// ingredients for 12 qt, make 6.
    func testCascadeBatchFloorWorkedExample() throws {
        let f = try BeoFixtures.load("cascade_batch_floor_worked_example")
        let r = runCascade(f)
        assertPrepRows(r, f)
        assertOrderGuide(r, f)

        // Named assertions on top of the fixture sweep, so a regression says
        // which rule broke rather than "prep[1] order_qty".
        let bySlug = Dictionary(uniqueKeysWithValues: r.prepDemands.map { ($0.recipeSlug, $0) })
        XCTAssertEqual(bySlug["coleslaw"]?.orderQty ?? .nan, 12.0, accuracy: 1e-6,
                       "0.26 of a batch still buys one whole batch")
        XCTAssertEqual(bySlug["coleslaw"]?.prepQty ?? .nan, 6.0, accuracy: 1e-6,
                       "prep rounds up to half-batch granularity, not to a whole batch")
        XCTAssertEqual(bySlug["buttermilk_brine"]?.orderQty ?? .nan, 12.0, accuracy: 1e-6,
                       "an exact batch count must not be pushed to two by float error")

        // A sub-recipe shared by two parents is summed BEFORE it is rounded.
        // Rounding each branch separately orders two batches of rub where one
        // covers both.
        XCTAssertEqual(bySlug["lariat_rub"]?.orderQty ?? .nan, 2.0, accuracy: 1e-6,
                       "shared sub settles to ONE batch, not one per parent")

        // The order guide buys for the batches, not for consumption: coleslaw's
        // BOM is 10 qt of cabbage per 12 qt batch, and the event eats 0.26 of a
        // batch. Buying 2.6 qt while the board says to make 12 is two answers
        // to one question.
        let cabbage = r.orderGuide.first { $0.ingredient == "green cabbage" }
        XCTAssertEqual(cabbage?.totalNeeded ?? .nan, 10.0, accuracy: 1e-6,
                       "guide buys for the floored batch, not the linear fraction")
    }

    /// The floor applies only where a batch is a real measure.
    ///
    /// A yield in `ea` is a count. Flooring one orders a 60-piece batch of mac
    /// balls to serve 20 — an over-order nothing absorbs.
    func testCascadeBatchFloorCountedYieldPassesThrough() throws {
        let f = try BeoFixtures.load("cascade_batch_floor_counted_yield_passthrough")
        let r = runCascade(f)
        assertPrepRows(r, f)
        assertOrderGuide(r, f)

        let macBalls = r.prepDemands.first { $0.recipeSlug == "mac_balls" }
        XCTAssertNotNil(macBalls, "the counted recipe is still on the board")
        XCTAssertEqual(macBalls?.orderQty ?? .nan, macBalls?.qty ?? .nan, accuracy: 1e-6,
                       "a counted yield orders the linear figure")
        XCTAssertEqual(macBalls?.prepQty ?? .nan, macBalls?.qty ?? .nan, accuracy: 1e-6,
                       "and preps it")
        XCTAssertLessThan(macBalls?.orderQty ?? .infinity, 60.0,
                          "flooring a count would order a whole 60-piece batch to serve 20")
    }

    /// `per_count` 0 means the item is on the menu and eats none of this
    /// recipe. That has to stay zero all the way down the sub-recipe walk
    /// rather than becoming a full batch — and a full batch of every sub under
    /// it. A trace is NOT zero: 0.01 qt still buys the whole batch below.
    func testCascadeBatchFloorZeroPerCountStaysZero() throws {
        let f = try BeoFixtures.load("cascade_batch_floor_zero_per_count")
        let r = runCascade(f)
        assertPrepRows(r, f)
        assertOrderGuide(r, f)

        XCTAssertTrue(r.prepDemands.isEmpty,
                      "nothing to buy and nothing to make means the recipe is off the board: \(r.prepDemands.map(\.recipeSlug))")
        XCTAssertTrue(r.orderGuide.isEmpty,
                      "a zero row is clutter on a guide read at a glance: \(r.orderGuide.map(\.ingredient))")
    }

    // MARK: - roundUpBatches, directly

    func testRoundUpBatchesMatchesThePythonKernel() {
        // Whole batches.
        XCTAssertEqual(BomExpandCompute.roundUpBatches(0.26, granularity: 1.0), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BomExpandCompute.roundUpBatches(0.78, granularity: 1.0), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BomExpandCompute.roundUpBatches(1.0, granularity: 1.0), 1.0, accuracy: 1e-9,
                       "an exact batch must not be pushed to two by float error")
        XCTAssertEqual(BomExpandCompute.roundUpBatches(1.01, granularity: 1.0), 2.0, accuracy: 1e-9)
        // Half batches.
        XCTAssertEqual(BomExpandCompute.roundUpBatches(0.26, granularity: 0.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(BomExpandCompute.roundUpBatches(0.78, granularity: 0.5), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BomExpandCompute.roundUpBatches(1.0, granularity: 0.5), 1.0, accuracy: 1e-9)
        // Nothing demanded is nothing made.
        XCTAssertEqual(BomExpandCompute.roundUpBatches(0.0, granularity: 1.0), 0.0, accuracy: 1e-9)
        XCTAssertEqual(BomExpandCompute.roundUpBatches(-1.0, granularity: 1.0), 0.0, accuracy: 1e-9)
        // A trace is not zero.
        XCTAssertEqual(BomExpandCompute.roundUpBatches(1e-6, granularity: 1.0), 1.0, accuracy: 1e-9)
    }
}
