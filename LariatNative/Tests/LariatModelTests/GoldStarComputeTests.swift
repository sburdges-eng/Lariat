import XCTest
@testable import LariatModel

/// Value-parity tests for the gold-stars award clamp — parity with
/// `app/api/gold-stars/route.ts` L78:
/// `Math.min(Math.max(Number(stars) || 1, 1), 3)`.
final class GoldStarComputeTests: XCTestCase {

    func testClampInRangeIsIdentity() {
        XCTAssertEqual(GoldStarCompute.clampStars(1), 1)
        XCTAssertEqual(GoldStarCompute.clampStars(2), 2)
        XCTAssertEqual(GoldStarCompute.clampStars(3), 3)
    }

    func testClampAboveThreeIsThree() {
        XCTAssertEqual(GoldStarCompute.clampStars(4), 3)
        XCTAssertEqual(GoldStarCompute.clampStars(999), 3)
    }

    func testClampZeroIsOne() {
        // `Number(0) || 1` — zero is falsy on the web → 1, not clamped-up 1.
        XCTAssertEqual(GoldStarCompute.clampStars(0), 1)
    }

    func testClampNegativeIsOne() {
        XCTAssertEqual(GoldStarCompute.clampStars(-2), 1)
    }

    func testClampNilIsOne() {
        // Missing/`NaN` stars → `Number(undefined) || 1` → 1.
        XCTAssertEqual(GoldStarCompute.clampStars(nil), 1)
    }

    func testStarTiers() {
        // GoldStarBoard.tsx STAR_TIERS: 1 Good / 2 Great / 3 Exceptional.
        XCTAssertEqual(GoldStarTier.allCases.map(\.rawValue), [1, 2, 3])
        XCTAssertEqual(GoldStarTier.one.label, "★ Good")
        XCTAssertEqual(GoldStarTier.two.label, "★★ Great")
        XCTAssertEqual(GoldStarTier.three.label, "★★★ Exceptional")
    }
}
