import XCTest
@testable import LariatModel

/// Value-parity tests for `PriceSeriesCompute` / `PriceSeriesOptions`, authored
/// fresh vs `lib/vendorPricesRepo.ts:319-353` (`listPriceSeries`; there is no
/// dedicated JS oracle for this function) plus the delta rule documented in
/// the wave brief and demonstrated at
/// `app/costing/prices/[vendor]/[sku]/page.jsx:124-127`.
final class PriceSeriesComputeTests: XCTestCase {
    private func pt(_ at: String, _ p: Double?) -> PriceSeriesPoint {
        PriceSeriesPoint(snapshotAt: at, unitPrice: p, packPrice: nil, packSize: nil, packUnit: nil)
    }

    func testDeltaOverTwoPoints() {
        // first 10 -> last 12.5 => +25%
        let d = PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 10), pt("2026-06-05 00:00:00", 12.5)])
        XCTAssertEqual(d ?? 0, 25.0, accuracy: 1e-6)
    }

    func testSinglePointHasNoDelta() {
        XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 10)]))
    }

    func testFirstZeroHasNoDelta() {
        XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 0), pt("2026-06-05 00:00:00", 5)]))
    }

    func testFirstNilHasNoDelta() {
        XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", nil), pt("2026-06-05 00:00:00", 5)]))
    }

    // Deliberate hardening vs the web page (page.jsx:124-127 only guards
    // `first`, not `last` — a nil last endpoint would produce NaN in JS).
    // No web oracle exists for this exact case; documented divergence.
    func testLastNilHasNoDelta() {
        XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 10), pt("2026-06-05 00:00:00", nil)]))
    }

    func testOptionsBlankAndClamp() {
        XCTAssertTrue(PriceSeriesOptions(vendor: "  ", sku: "X").isBlank)
        XCTAssertTrue(PriceSeriesOptions(vendor: "v", sku: "").isBlank)
        XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s", limit: 99999).limit, 1000)
        XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s", limit: 0).limit, 100)   // non-positive -> default
        XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s").limit, 100)
    }

    // PriceSeriesResult computes deltaPct internally via PriceSeriesCompute.summarize.
    func testResultComputesDeltaInternally() {
        let r = PriceSeriesResult(points: [pt("2026-06-01 00:00:00", 10), pt("2026-06-05 00:00:00", 12.5)])
        XCTAssertEqual(r.deltaPct ?? 0, 25.0, accuracy: 1e-6)
        XCTAssertEqual(r.points.count, 2)
    }
}
