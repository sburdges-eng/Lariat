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
}
