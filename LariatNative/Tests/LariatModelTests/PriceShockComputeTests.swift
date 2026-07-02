import XCTest
@testable import LariatModel

/// Value-parity tests for `PriceShockCompute` against `lib/vendorPricesRepo.ts#listPriceShocks`
/// (L419-604) and its oracle `tests/js/test-price-shocks.mjs`.
final class PriceShockComputeTests: XCTestCase {
    private let d6 = "2026-06-25 00:00:00"
    private let d5 = "2026-06-26 00:00:00"
    private let d3 = "2026-06-28 00:00:00"
    private let d0 = "2026-07-01 00:00:00"

    private func input(_ v: String, _ s: String, _ ing: String, _ p: Double, _ at: String, _ cat: String? = nil) -> PriceShockInput {
        PriceShockInput(vendor: v, sku: s, ingredient: ing, category: cat, snapshotAt: at, unitPrice: p)
    }

    // Oracle: "uses earliest in window vs latest overall, computes signed % delta"
    func testEarliestBaselineLatestOverall() {
        let rows = PriceShockCompute.compute(
            inputs: [input("sysco", "AVO-1", "Avocado", 2.00, d6), input("sysco", "AVO-1", "Avocado", 2.50, d0)],
            live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].baselineUnitPrice, 2.00, accuracy: 1e-9)
        XCTAssertEqual(rows[0].latestUnitPrice, 2.50, accuracy: 1e-9)
        XCTAssertEqual(rows[0].direction, .up)
        XCTAssertEqual(rows[0].deltaPct, 25.0, accuracy: 1e-6)
    }

    // Oracle: "handles a price drop with direction=down"
    func testDrop() {
        let rows = PriceShockCompute.compute(
            inputs: [input("shamrock", "OIL-1", "Canola Oil", 10, d5), input("shamrock", "OIL-1", "Canola Oil", 8, d0)],
            live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].direction, .down)
        XCTAssertTrue(rows[0].deltaPct < 0)
    }

    // Oracle: "filters out SKUs whose move is below the threshold"
    func testBelowThresholdDropped() {
        let rows = PriceShockCompute.compute(inputs: [
            input("sysco", "A", "A", 100, d5), input("sysco", "A", "A", 102, d0), // +2%
            input("sysco", "B", "B", 100, d5), input("sysco", "B", "B", 110, d0), // +10%
        ], live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].sku, "B")
    }

    // Oracle: "sorts by absolute % move desc and trims to limit"
    func testSortDescAndLimit() {
        let rows = PriceShockCompute.compute(inputs: [
            input("v", "A", "A", 100, d5), input("v", "A", "A", 110, d0), // +10
            input("v", "B", "B", 100, d5), input("v", "B", "B", 130, d0), // +30
            input("v", "C", "C", 100, d5), input("v", "C", "C", 80, d0),  // -20
            input("v", "D", "D", 100, d5), input("v", "D", "D", 105, d0), // +5
        ], live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5, limit: 3))
        XCTAssertEqual(rows.map(\.sku), ["B", "C", "A"])
    }

    // Oracle: "skips SKUs with only one snapshot in window"
    func testSingleSnapshotSkipped() {
        let rows = PriceShockCompute.compute(
            inputs: [input("v", "lonely", "lonely", 100, d0)],
            live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 0))
        XCTAssertEqual(rows.count, 0)
    }

    // Oracle (live overlay): "live price overrides a stale history latest for the same SKU"
    func testLiveOverridesStaleLatest() {
        let rows = PriceShockCompute.compute(
            inputs: [input("v", "OIL-9", "Oil", 10, d6), input("v", "OIL-9", "Oil", 10.2, d3)],
            live: [PriceShockLive(vendor: "v", sku: "OIL-9", ingredient: "Oil", category: nil, unitPrice: 13, importedAt: d0)],
            options: PriceShockOptions(windowDays: 30, minPctMove: 5))
        let hit = rows.first { $0.sku == "OIL-9" }
        XCTAssertNotNil(hit)
        XCTAssertEqual(hit?.latestUnitPrice ?? 0, 13, accuracy: 1e-9)
        XCTAssertEqual(hit?.baselineUnitPrice ?? 0, 10, accuracy: 1e-9)
    }

    // Oracle (live overlay): "does not invent a shock when there is no in-window history baseline"
    func testLiveOnlyNoBaseline() {
        let rows = PriceShockCompute.compute(
            inputs: [], live: [PriceShockLive(vendor: "sysco", sku: "ONLY-LIVE", ingredient: "Onions", category: nil, unitPrice: 5, importedAt: d0)],
            options: PriceShockOptions(windowDays: 30, minPctMove: 5))
        XCTAssertNil(rows.first { $0.sku == "ONLY-LIVE" })
    }

    // Oracle: "surfaces a fresh-ingest price move that lives only in vendor_prices"
    func testFreshIngestViaLive() {
        let rows = PriceShockCompute.compute(
            inputs: [input("sysco", "TOM-1", "Tomatoes", 10, d3)],
            live: [PriceShockLive(vendor: "sysco", sku: "TOM-1", ingredient: "Tomatoes", category: nil, unitPrice: 12, importedAt: d0)],
            options: PriceShockOptions(windowDays: 30, minPctMove: 5))
        let hit = rows.first { $0.sku == "TOM-1" }
        XCTAssertEqual(hit?.latestUnitPrice ?? 0, 12, accuracy: 1e-9)
        XCTAssertEqual(hit?.deltaPct ?? 0, 20, accuracy: 1e-6)
    }

    // Oracle: options clamp — parity with vendorPricesRepo.ts:428-444 (the REPO/options
    // layer clamp, NOT the API route's `asNum`/`asInt` clamp). A negative/invalid
    // minPctMove falls back to the DEFAULT (5), it does not clamp to 0 — this matches
    // the shipped `MarginDeltaOptions` precedent and vendorPricesRepo.ts:434-438
    // (`Number.isFinite(rawMin) && rawMin >= 0 ? min(1000, rawMin) : 5`). The route's
    // own `asNum(v, 5, 0, 1000)` clamp (which WOULD map -50 -> 0) is a distinct,
    // route-level concern not modeled by this options struct.
    func testOptionClamps() {
        let o = PriceShockOptions(windowDays: 999, minPctMove: -50, limit: 99999)
        XCTAssertEqual(o.windowDays, 90)
        XCTAssertEqual(o.minPctMove, 5, accuracy: 1e-9)
        XCTAssertEqual(o.limit, 500)
        let d = PriceShockOptions()
        XCTAssertEqual(d.windowDays, 7)
        XCTAssertEqual(d.minPctMove, 5, accuracy: 1e-9)
        XCTAssertEqual(d.limit, 50)
    }

    // Union pass keeps the most-recent non-null category (vendorPricesRepo.ts:535);
    // the live overlay only fills category if the group's is still nil (:570).
    func testCategoryUnionKeepsMostRecentNonNull() {
        let rows = PriceShockCompute.compute(
            inputs: [
                input("v", "BEER1", "Pilsner", 1, d5, "Beer"),
                input("v", "BEER1", "Pilsner", 1.2, d0, nil),
            ],
            live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.first?.category, "Beer")
    }

    func testCategoryLiveOverlayFillsOnlyIfNil() {
        let rows = PriceShockCompute.compute(
            inputs: [
                input("v", "OIL-9", "Oil", 10, d6, "Pantry"),
                input("v", "OIL-9", "Oil", 10.2, d3, nil),
            ],
            live: [PriceShockLive(vendor: "v", sku: "OIL-9", ingredient: "Oil", category: "OverlayCat", unitPrice: 13, importedAt: d0)],
            options: PriceShockOptions(windowDays: 30, minPctMove: 5))
        // group's category is already "Pantry" (non-nil) from the union pass, so the
        // overlay must NOT override it.
        XCTAssertEqual(rows.first?.category, "Pantry")
    }
}
