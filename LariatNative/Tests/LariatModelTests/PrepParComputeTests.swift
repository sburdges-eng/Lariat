import XCTest
@testable import LariatModel

/// Value-parity tests for the pure prep-par rules, taken from
/// `app/api/prep-par/route.js` (clip/num/normalize) and `app/prep/par/page.jsx`
/// (station grouping) plus `tests/js/test-prep-par-api.mjs`.
final class PrepParComputeTests: XCTestCase {

    // ── clip ────────────────────────────────────────────────────────────

    func testClipTrimsAndTruncates() {
        XCTAssertEqual(PrepParCompute.clip("  grill  ", max: 64), "grill")
        XCTAssertEqual(PrepParCompute.clip("abcdef", max: 3), "abc")
    }

    func testClipEmptyOrNilBecomesNil() {
        XCTAssertNil(PrepParCompute.clip("   ", max: 64))
        XCTAssertNil(PrepParCompute.clip("", max: 64))
        XCTAssertNil(PrepParCompute.clip(nil, max: 64))
    }

    // ── num ─────────────────────────────────────────────────────────────

    func testNumPassesFiniteAndRejectsNonFinite() {
        XCTAssertEqual(PrepParCompute.num(12), 12)
        XCTAssertEqual(PrepParCompute.num(0), 0)
        XCTAssertNil(PrepParCompute.num(nil))
        XCTAssertNil(PrepParCompute.num(.infinity))
        XCTAssertNil(PrepParCompute.num(.nan))
    }

    // ── normalize: recipe-target upsert (parity test case 1) ────────────

    func testNormalizeRecipeTargetKeepsEmptyIngredient() {
        let input = PrepParUpsertInput(
            stationId: "grill", recipeSlug: "ribeye-8oz",
            targetQty: 12, unit: "portions", sortOrder: 1
        )
        guard case .success(let n) = PrepParCompute.normalize(input) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(n.stationId, "grill")
        XCTAssertEqual(n.recipeSlug, "ribeye-8oz")
        XCTAssertEqual(n.ingredient, "")       // '' not nil — UNIQUE parity
        XCTAssertEqual(n.targetQty, 12)
        XCTAssertEqual(n.unit, "portions")
        XCTAssertEqual(n.sortOrder, 1)
    }

    // ── normalize: ingredient-target upsert (parity test case 4) ────────

    func testNormalizeIngredientTargetKeepsEmptyRecipe() {
        let input = PrepParUpsertInput(
            stationId: "cold", ingredient: "roma tomatoes",
            targetQty: 20, unit: "lbs"
        )
        guard case .success(let n) = PrepParCompute.normalize(input) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(n.ingredient, "roma tomatoes")
        XCTAssertEqual(n.recipeSlug, "")
        XCTAssertEqual(n.targetQty, 20)
    }

    // ── normalize: 400 when both empty (parity test case 3) ─────────────

    func testNormalizeRejectsBothEmpty() {
        let input = PrepParUpsertInput(stationId: "fryer", targetQty: 5)
        guard case .failure(let err) = PrepParCompute.normalize(input) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(err, .recipeOrIngredientRequired)
    }

    func testNormalizeWhitespaceOnlyCountsAsEmpty() {
        let input = PrepParUpsertInput(recipeSlug: "   ", ingredient: "  ")
        guard case .failure(let err) = PrepParCompute.normalize(input) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(err, .recipeOrIngredientRequired)
    }

    // ── normalize: sort_order default 0, truncation to INTEGER ──────────

    func testNormalizeSortOrderDefaultsToZero() {
        let input = PrepParUpsertInput(recipeSlug: "salad")
        guard case .success(let n) = PrepParCompute.normalize(input) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(n.sortOrder, 0)
        XCTAssertNil(n.targetQty)   // num(nil) -> nil
        XCTAssertNil(n.unit)
        XCTAssertNil(n.note)
    }

    func testNormalizeTrimsAndClipsFields() {
        let longNote = String(repeating: "x", count: 600)
        let input = PrepParUpsertInput(
            stationId: "  Sauté  ", recipeSlug: "  pasta  ",
            unit: "  qt  ", note: longNote
        )
        guard case .success(let n) = PrepParCompute.normalize(input) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(n.stationId, "Sauté")
        XCTAssertEqual(n.recipeSlug, "pasta")
        XCTAssertEqual(n.unit, "qt")
        XCTAssertEqual(n.note?.count, 500)   // clipped to 500
    }

    // ── validateDeleteId ────────────────────────────────────────────────

    func testValidateDeleteId() {
        guard case .success = PrepParCompute.validateDeleteId(5) else {
            return XCTFail("5 is valid")
        }
        guard case .failure(let e0) = PrepParCompute.validateDeleteId(0) else {
            return XCTFail("0 is invalid")
        }
        XCTAssertEqual(e0, .badId)
        guard case .failure = PrepParCompute.validateDeleteId(-3) else {
            return XCTFail("-3 is invalid")
        }
    }

    // ── group: station grouping + General fallback + group ordering ─────

    func testGroupOrdersStationsAndFoldsEmptyIntoGeneral() {
        let rows = [
            makeRow(id: 1, station: "saute", recipe: "risotto"),
            makeRow(id: 2, station: "grill", recipe: "steak"),
            makeRow(id: 3, station: "", ingredient: "salt"),
        ]
        let groups = PrepParCompute.group(rows)
        // '' (General) sorts first, then grill, then saute.
        XCTAssertEqual(groups.map(\.stationKey), ["", "grill", "saute"])
        XCTAssertEqual(groups.first?.title, "General")
        XCTAssertEqual(groups[1].title, "grill")
    }

    func testGroupPreservesRowOrderWithinStation() {
        let rows = [
            makeRow(id: 1, station: "grill", recipe: "aaa"),
            makeRow(id: 2, station: "grill", recipe: "bbb"),
        ]
        let groups = PrepParCompute.group(rows)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].rows.map(\.id), [1, 2])
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRow(
        id: Int64, station: String, recipe: String = "", ingredient: String = ""
    ) -> PrepParRow {
        PrepParRow(
            id: id, locationId: "default", stationId: station,
            recipeSlug: recipe, ingredient: ingredient,
            targetQty: nil, unit: nil, sortOrder: 0, note: nil, updatedAt: nil
        )
    }
}
