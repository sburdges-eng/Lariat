import XCTest
@testable import LariatModel

/// Parity tests for Management rollup traffic-light colors against the web
/// rules in `app/management/page.jsx` (`varianceColor`, `ingestColor`,
/// `warningCountColor`, `packChangeColor`). `nil` == the web `var(--muted)`
/// branch (no signal / no data).
final class RollupTileColorTests: XCTestCase {

    // MARK: varianceColor(pct): null→muted; >=5 red; >=2 yellow; else green
    func testVarianceSeverity() {
        XCTAssertNil(RollupTileColor.variance(pct: nil))
        XCTAssertEqual(RollupTileColor.variance(pct: 5.0), .red)
        XCTAssertEqual(RollupTileColor.variance(pct: 7.3), .red)
        XCTAssertEqual(RollupTileColor.variance(pct: 4.99), .yellow)
        XCTAssertEqual(RollupTileColor.variance(pct: 2.0), .yellow)
        XCTAssertEqual(RollupTileColor.variance(pct: 1.99), .green)
        XCTAssertEqual(RollupTileColor.variance(pct: 0), .green)
        XCTAssertEqual(RollupTileColor.variance(pct: -3.0), .green)
    }

    // MARK: ingestColor(ageMin,status): null age|null status|failed→red; >=1440 red; >=60 yellow; else green
    func testIngestSeverity() {
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: nil, status: "ok"), .red)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 10, status: nil), .red)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 10, status: "failed"), .red)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 1440, status: "ok"), .red)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 1439, status: "ok"), .yellow)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 60, status: "ok"), .yellow)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 59, status: "ok"), .green)
        XCTAssertEqual(RollupTileColor.ingest(ageMinutes: 0, status: "ok"), .green)
    }

    // MARK: warningCountColor(n): null→muted; >0 yellow; else green
    func testWarningCountSeverity() {
        XCTAssertNil(RollupTileColor.warningCount(nil))
        XCTAssertEqual(RollupTileColor.warningCount(0), .green)
        XCTAssertEqual(RollupTileColor.warningCount(1), .yellow)
        XCTAssertEqual(RollupTileColor.warningCount(42), .yellow)
    }

    // MARK: packChangeColor(n): null→muted; >0 yellow; else green
    func testPackChangeSeverity() {
        XCTAssertNil(RollupTileColor.packChange(nil))
        XCTAssertEqual(RollupTileColor.packChange(0), .green)
        XCTAssertEqual(RollupTileColor.packChange(3), .yellow)
    }
}
