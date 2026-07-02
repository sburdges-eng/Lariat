import XCTest
@testable import LariatModel

/// Value-parity with the `componentsFromBreakdown` cases in
/// `tests/js/test-specials-promotion.mjs`; the DB half (pack-unit alignment,
/// upserts, promotion record, audit) is pinned in
/// `LariatDBTests/SpecialsRepositoryTests`.
final class SpecialsPromotionComputeTests: XCTestCase {
    func testMergesDuplicateVendorMatchesWhenUnitsConvertible() {
        let result = SpecialsPromotionCompute.componentsFromBreakdown([
            CostBreakdownLine(item: "pork belly roast", reqQty: 4, reqUnit: "lb", match: "PORK BELLY SKIN-ON"),
            CostBreakdownLine(item: "pork belly trim", reqQty: 8, reqUnit: "oz", match: "PORK BELLY SKIN-ON"),
        ], servings: 1)

        XCTAssertEqual(result.skipped, [])
        XCTAssertEqual(result.components.count, 1)
        XCTAssertEqual(result.components[0].vendorIngredient, "PORK BELLY SKIN-ON")
        XCTAssertEqual(result.components[0].unit, "lb")
        XCTAssertEqual(result.components[0].qtyPerServing, 4.5, accuracy: 1e-9)
    }

    func testUnmatchedLinesAreSkippedWithReason() {
        let result = SpecialsPromotionCompute.componentsFromBreakdown([
            CostBreakdownLine(item: "micro greens", reqQty: 1, reqUnit: "oz", cost: nil, note: "No vendor match"),
        ], servings: 1)
        XCTAssertEqual(result.components, [])
        XCTAssertEqual(result.skipped, [SkippedComponent(item: "micro greens", reason: .unmatched)])
    }

    func testInvalidQtyAndMissingUnitAreSkipped() {
        let result = SpecialsPromotionCompute.componentsFromBreakdown([
            CostBreakdownLine(item: "a", reqQty: 0, reqUnit: "lb", match: "A"),
            CostBreakdownLine(item: "b", reqQty: nil, reqUnit: "lb", match: "B"),
            CostBreakdownLine(item: "", reqQty: 1, reqUnit: "", match: "C"),
        ], servings: 1)
        XCTAssertEqual(result.components, [])
        XCTAssertEqual(result.skipped, [
            SkippedComponent(item: "a", reason: .invalidQty),
            SkippedComponent(item: "b", reason: .invalidQty),
            SkippedComponent(item: "C", reason: .invalidQty),   // item falls back to match
        ])
    }

    func testMergeWithInconvertibleUnitsSkipsAsInvalidQty() {
        // lb (weight) then ea (count): identity fails, cross-dim to count is nil.
        let result = SpecialsPromotionCompute.componentsFromBreakdown([
            CostBreakdownLine(item: "x", reqQty: 1, reqUnit: "lb", match: "X"),
            CostBreakdownLine(item: "x2", reqQty: 2, reqUnit: "ea", match: "X"),
        ], servings: 1)
        XCTAssertEqual(result.components.count, 1)
        XCTAssertEqual(result.skipped, [SkippedComponent(item: "x2", reason: .invalidQty)])
    }

    func testPerServingDivision() {
        let result = SpecialsPromotionCompute.componentsFromBreakdown([
            CostBreakdownLine(item: "pork belly", reqQty: 4, reqUnit: "lb", match: "PORK BELLY SKIN-ON"),
            CostBreakdownLine(item: "bbq sauce", reqQty: 8, reqUnit: "oz", match: "BBQ SAUCE SWEET 1GAL"),
        ], servings: 2)
        XCTAssertEqual(result.components[0].qtyPerServing, 2)
        XCTAssertEqual(result.components[1].qtyPerServing, 4)
    }

    func testNormalizedServings() {
        XCTAssertEqual(SpecialsPromotionCompute.normalizedServings(nil), 1)
        XCTAssertEqual(SpecialsPromotionCompute.normalizedServings(0), 1)
        XCTAssertEqual(SpecialsPromotionCompute.normalizedServings(-2), 1)
        XCTAssertEqual(SpecialsPromotionCompute.normalizedServings(Double.nan), 1)
        XCTAssertEqual(SpecialsPromotionCompute.normalizedServings(4), 4)
    }

    func testComponentsJsonMatchesWebWriter() {
        let json = PromotedComponent.componentsJson([
            PromotedComponent(vendorIngredient: "PORK BELLY SKIN-ON", qtyPerServing: 2, unit: "lb"),
        ])
        XCTAssertEqual(json, "[{\"vendor_ingredient\":\"PORK BELLY SKIN-ON\",\"qty_per_serving\":2,\"unit\":\"lb\"}]")
        XCTAssertEqual(PromotedComponent.parseComponentsJson(json), [
            PromotedComponent(vendorIngredient: "PORK BELLY SKIN-ON", qtyPerServing: 2, unit: "lb"),
        ])
        XCTAssertEqual(PromotedComponent.parseComponentsJson("garbage"), [])
    }
}
