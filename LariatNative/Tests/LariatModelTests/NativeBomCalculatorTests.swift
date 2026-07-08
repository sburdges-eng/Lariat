// NativeBomCalculatorTests — the in-process RecipeCalculating (Wave C C1) must
// reproduce the bom_expand_cli.py contract (target_qty / scale_factor / sorted
// leaf_rows) against the real recipes/*.csv, without spawning python.

import XCTest
@testable import LariatModel

final class NativeBomCalculatorTests: XCTestCase {

    private var repoRoot: String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // LariatNative
            .deletingLastPathComponent()   // repo root
            .path
    }

    private func calc() -> NativeBomCalculator { NativeBomCalculator(root: repoRoot) }

    private func leaf(_ result: RecipeExpandResult, _ ingredient: String) -> RecipeLeafRow? {
        result.leafRows.first { $0.ingredient == ingredient }
    }

    func testScaleRecipePorkChopMarinade() async throws {
        // multiplier 2 on a 1-gal-yield recipe → 2 gal, scale 2, leaves = the
        // golden pork_chop_marinade_2x fixture (also sorted by (ingredient,unit)).
        let result = try await calc().scaleRecipe(slug: "pork_chop_marinade", multiplier: 2)
        XCTAssertEqual(result.recipeSlug, "pork_chop_marinade")
        XCTAssertEqual(result.targetQty, 2, accuracy: 1e-9)
        XCTAssertEqual(result.targetUnit, "gal")
        XCTAssertEqual(result.scaleFactor, 2, accuracy: 1e-9)

        let fx = try BomExpandFixtures.load("pork_chop_marinade_2x")
        let expected = fx.expect.leaves ?? []
        XCTAssertEqual(result.leafRows.count, expected.count, "leaf count")
        // sorted ascending by ingredient then unit
        XCTAssertEqual(result.leafRows.map(\.ingredient),
                       result.leafRows.map(\.ingredient).sorted(), "leaf_rows sorted")
        for t in expected {
            guard let row = leaf(result, t.name) else { XCTFail("missing \(t.name)"); continue }
            XCTAssertEqual(row.unit, t.unit, "\(t.name) unit")
            XCTAssertEqual(row.qty, t.value, accuracy: 1e-6, "\(t.name) qty")
        }
    }

    func testExpandForBEOScalesByGuestCount() async throws {
        // 0.5 portions/guest × 4 guests = 2 gal → same as multiplier 2.
        let results = try await calc().expandForBEO(
            recipes: [(slug: "pork_chop_marinade", portionsPerGuest: 0.5)], guestCount: 4
        )
        guard results.count == 1 else { return XCTFail("expected 1 result, got \(results.count)") }
        let r = results[0]
        XCTAssertEqual(r.targetQty, 2, accuracy: 1e-9)
        XCTAssertEqual(r.targetUnit, "gal")
        XCTAssertEqual(r.scaleFactor, 2, accuracy: 1e-9)
        XCTAssertEqual(leaf(r, "orange juice")?.qty ?? .nan, 4, accuracy: 1e-6)
    }

    func testExpandForBEORejectsNonPositiveGuestCount() async {
        do {
            _ = try await calc().expandForBEO(recipes: [(slug: "pork_chop_marinade", portionsPerGuest: 1)], guestCount: 0)
            XCTFail("expected throw")
        } catch let e as RecipeCalculatorError {
            XCTAssertEqual(e.code, "bad_guest_count")
        } catch { XCTFail("wrong error type \(error)") }
    }

    func testUnknownSlugThrowsExpandFailed() async {
        do {
            _ = try await calc().scaleRecipe(slug: "no_such_recipe", multiplier: 1)
            XCTFail("expected throw")
        } catch let e as RecipeCalculatorError {
            XCTAssertEqual(e.code, "expand_failed")
            XCTAssertTrue(e.message.contains("no_such_recipe"), "message names the slug: \(e.message)")
        } catch { XCTFail("wrong error type \(error)") }
    }
}
