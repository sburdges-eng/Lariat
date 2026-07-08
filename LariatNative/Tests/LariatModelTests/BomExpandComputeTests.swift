// BomExpandComputeTests — drives every inline-manifest BomExpand golden fixture
// (15 of 16; the CSV-backed pork_chop_marinade_2x belongs to the A3 loader
// slice) against the Swift port, asserting Python parity at tolerance 1e-6.

import XCTest
@testable import LariatModel

final class BomExpandComputeTests: XCTestCase {

    // MARK: - Shared assertions

    private func accuracy(_ places: Int?) -> Double {
        pow(10.0, -Double(places ?? 6))
    }

    private func assertLeaves(
        _ id: String,
        aggregate: Bool = false,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let fx = try BomExpandFixtures.load(id)
        let out: [BomKey: Double]
        if aggregate {
            out = try BomExpandCompute.aggregateDemand(fx.manifest, demands: fx.input.demands!.map(\.tuple))
        } else {
            out = try BomExpandCompute.expandRecipe(
                fx.manifest, slug: fx.input.slug!, qty: fx.input.qty!, unit: fx.input.unit!
            )
        }
        let expected = fx.expect.leaves!
        XCTAssertEqual(out.count, expected.count, "\(id): leaf count", file: file, line: line)
        for t in expected {
            guard let got = out[BomKey(t.name, t.unit)] else {
                XCTFail("\(id): missing leaf \(t.name)/\(t.unit)", file: file, line: line)
                continue
            }
            XCTAssertEqual(got, t.value, accuracy: accuracy(fx.expect.tolerancePlaces),
                           "\(id): leaf \(t.name)/\(t.unit)", file: file, line: line)
        }
    }

    private func assertNodes(
        _ id: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let fx = try BomExpandFixtures.load(id)
        let out = try BomExpandCompute.expandRecipeDemand(fx.manifest, demands: fx.input.demands!.map(\.tuple))
        let expected = fx.expect.nodes!
        XCTAssertEqual(out.count, expected.count, "\(id): node count", file: file, line: line)
        for t in expected {
            guard let got = out[BomKey(t.name, t.unit)] else {
                XCTFail("\(id): missing node \(t.name)/\(t.unit)", file: file, line: line)
                continue
            }
            XCTAssertEqual(got, t.value, accuracy: accuracy(fx.expect.tolerancePlaces),
                           "\(id): node \(t.name)/\(t.unit)", file: file, line: line)
        }
    }

    private func callThrowing(_ fx: BomExpandFixture) throws -> [BomKey: Double] {
        switch fx.input.mode {
        case "expand_recipe":
            return try BomExpandCompute.expandRecipe(
                fx.manifest, slug: fx.input.slug!, qty: fx.input.qty!, unit: fx.input.unit!
            )
        case "aggregate_demand":
            return try BomExpandCompute.aggregateDemand(fx.manifest, demands: fx.input.demands!.map(\.tuple))
        case "expand_recipe_demand":
            return try BomExpandCompute.expandRecipeDemand(fx.manifest, demands: fx.input.demands!.map(\.tuple))
        default:
            XCTFail("\(fx.id): unexpected mode \(fx.input.mode)")
            return [:]
        }
    }

    private func assertThrows(
        _ id: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let fx = try BomExpandFixtures.load(id)
        XCTAssertThrowsError(try callThrowing(fx), "\(id): expected throw", file: file, line: line) { err in
            guard let be = err as? BomExpandError else {
                XCTFail("\(id): expected BomExpandError, got \(err)", file: file, line: line)
                return
            }
            XCTAssertEqual(be.errorName, fx.expect.error, "\(id): error name", file: file, line: line)
            for sub in fx.expect.messageContains ?? [] {
                XCTAssertTrue(be.message.contains(sub),
                              "\(id): message '\(be.message)' missing '\(sub)'", file: file, line: line)
            }
            if let sample = fx.expect.sampleMessage {
                XCTAssertEqual(be.message, sample, "\(id): sample_message", file: file, line: line)
            }
        }
    }

    private func assertGraceful(
        _ id: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let fx = try BomExpandFixtures.load(id)
        var warnings: [String] = []
        let out = BomExpandCompute.expandRecipe(
            fx.manifest, slug: fx.input.slug!, qty: fx.input.qty!, unit: fx.input.unit!, warnings: &warnings
        )
        let expected = fx.expect.leaves!
        XCTAssertEqual(out.count, expected.count, "\(id): leaf count", file: file, line: line)
        for t in expected {
            guard let got = out[BomKey(t.name, t.unit)] else {
                XCTFail("\(id): missing leaf \(t.name)/\(t.unit)", file: file, line: line)
                continue
            }
            XCTAssertEqual(got, t.value, accuracy: accuracy(fx.expect.tolerancePlaces),
                           "\(id): leaf \(t.name)/\(t.unit)", file: file, line: line)
        }
        if let count = fx.expect.warningCount {
            XCTAssertEqual(warnings.count, count, "\(id): warning count", file: file, line: line)
        }
        if let exact = fx.expect.warningStrings {
            XCTAssertEqual(warnings, exact, "\(id): exact warnings", file: file, line: line)
        }
        for sub in fx.expect.warningContains ?? [] {
            XCTAssertTrue(warnings.contains { $0.contains(sub) },
                          "\(id): no warning contains '\(sub)'", file: file, line: line)
        }
    }

    private func assertManifestWarnings(
        _ id: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let fx = try BomExpandFixtures.load(id)
        let out = BomExpandCompute.findManifestWarnings(fx.manifest)
        let expected = fx.expect.warningObjects ?? []
        XCTAssertEqual(out.count, expected.count, "\(id): warning count", file: file, line: line)
        for e in expected {
            XCTAssertTrue(
                out.contains { $0.recipe == e.recipe && $0.subSlug == e.subSlug && $0.issue == e.issue },
                "\(id): missing warning \(e.recipe)/\(e.subSlug)", file: file, line: line
            )
        }
        for pair in fx.expect.warningPairs ?? [] {
            XCTAssertTrue(
                out.contains { $0.recipe == pair[0] && $0.subSlug == pair[1] },
                "\(id): missing pair \(pair)", file: file, line: line
            )
        }
    }

    // MARK: - Leaf expansion (expand_recipe)

    func testSingleLeafScalesLinearly() throws { try assertLeaves("single_leaf_scale") }
    func testGalDemandOnQtRecipeConverts() throws { try assertLeaves("gal_demand_on_qt_recipe") }
    func testCupToQtSubReferenceConverts() throws { try assertLeaves("cup_to_qt_sub_reference") }
    func testPackSizeBagToQtResolves() throws { try assertLeaves("pack_size_bag_to_qt") }
    func testExplicitSubRecipePinBindsChild() throws { try assertLeaves("explicit_sub_recipe_pin") }
    func testQuesoPullsSalsaLeaves() throws { try assertLeaves("queso_embeds_salsa") }
    // Inline-manifest subset of the real recipe (loaded from CSV in Wave C); the
    // 2x-gal expansion scales cup/bunch leaves linearly with no unit conversion.
    func testPorkChopMarinade2xRealManifest() throws { try assertLeaves("pork_chop_marinade_2x") }

    // MARK: - Aggregation

    func testQuesoPlusStandaloneSalsaAggregates() throws {
        try assertLeaves("queso_plus_standalone_salsa", aggregate: true)
    }

    // MARK: - Recipe-node demand (expand_recipe_demand)

    func testExpandRecipeDemandHalfBatch() throws { try assertNodes("expand_recipe_demand_half_batch") }
    func testExpandRecipeDemandCompoundSalsa() throws { try assertNodes("expand_recipe_demand_compound_salsa") }

    // MARK: - Fail-loud errors

    func testUnitMismatchTopLevelThrows() throws { try assertThrows("unit_mismatch_top") }
    func testCycleDetectedThrows() throws { try assertThrows("cycle_a_b") }
    func testSubRecipeUnitMismatchThrows() throws { try assertThrows("unit_mismatch_sub_bag") }
    func testCanaryQuesoGreenChileBagExpectsError() throws { try assertThrows("canary_queso_green_chile_bag") }

    // MARK: - Graceful degradation + manifest warnings

    func testGracefulSkipBadSubKeepsSiblings() throws { try assertGraceful("graceful_skip_bad_sub") }
    func testManifestWarningOrphanSub() throws { try assertManifestWarnings("manifest_warning_orphan_sub") }

    // Determinism: with 2+ orphan-declaring recipes the output must be stable
    // and sorted by (recipe, subSlug), not left to Swift's per-process Dictionary
    // hash order (parity audit 2026-07-08). A leaf child ("water"/"salt") keeps
    // the declared sub unreferenced.
    func testFindManifestWarningsAreDeterministicallyOrdered() {
        func leafRecipe(_ slug: String, sub: String, leaf: String) -> RecipeManifest {
            RecipeManifest(
                slug: slug, displayName: slug, yieldQty: 1, yieldUnit: "qt",
                subRecipeSlugs: [sub],
                bom: [BomRow(ingredient: leaf, qty: 1, unit: "qt", isSubRecipe: false, subSlug: nil)]
            )
        }
        func plainRecipe(_ slug: String) -> RecipeManifest {
            RecipeManifest(slug: slug, displayName: slug, yieldQty: 1, yieldUnit: "qt")
        }
        let manifest: [String: RecipeManifest] = [
            "zeta": leafRecipe("zeta", sub: "a_sub", leaf: "salt"),
            "alpha": leafRecipe("alpha", sub: "z_sub", leaf: "water"),
            "a_sub": plainRecipe("a_sub"),
            "z_sub": plainRecipe("z_sub"),
        ]
        let expected = [
            ManifestWarning(recipe: "alpha", subSlug: "z_sub",
                            issue: "declares sub-recipe 'z_sub' but no BOM row references it"),
            ManifestWarning(recipe: "zeta", subSlug: "a_sub",
                            issue: "declares sub-recipe 'a_sub' but no BOM row references it"),
        ]
        // Run twice: the result must be identical and in sorted order.
        XCTAssertEqual(BomExpandCompute.findManifestWarnings(manifest), expected)
        XCTAssertEqual(BomExpandCompute.findManifestWarnings(manifest), expected)
    }
}
