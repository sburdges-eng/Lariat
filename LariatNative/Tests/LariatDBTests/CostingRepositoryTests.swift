import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Parity tests for CostingRepository against the T5+T10 fixture database.
//
// Fixture known values (Fixtures.swift + T10 extensions):
//
//   accounting_variance (latest by snapshot_at DESC):
//     id=2  theoretical_cogs=900.0  actual_cogs=950.0  variance_amount=50.0  variance_pct=5.5
//     snapshot_at='2026-06-16 10:00:00'
//
//   dish_coverage_snapshots (latest by snapshot_at DESC):
//     total_dishes=73  covered_dishes=70  coverage_pct=95.9
//
//   sales_lines (location_id='default'):
//     item_name='Burger'   quantity_sold=40  net_sales=600.0  cost_per_unit=4.0
//     item_name='Tacos'    quantity_sold=25  net_sales=375.0  cost_per_unit=5.0
//     item_name='MysteryX' quantity_sold=5   net_sales=75.0   cost_per_unit=NULL
//
//   accounting_variance trend rows (T10 extension, period_start / period_end):
//     Row A: period_start=date('now','-14 days')  period_end=date('now','-7 days')
//            variance_amount=80.0  variance_pct=8.0
//     Row B: period_start=date('now','-7 days')   period_end=date('now')
//            variance_amount=50.0  variance_pct=5.5
//
//   windowDays=28 relative to MAX(period_end) = date('now')
//   Both rows fall within the 28-day window → rowsFound=2
//   pCurrent = 5.5 (last row variance_pct)
//   pAverage = (8.0 + 5.5) / 2 = 6.75

final class CostingRepositoryTests: XCTestCase {

    private func makeRepo() throws -> (CostingRepository, String) {
        let path = try seedFixtureDatabase()
        let db = try LariatDatabase(path: path)
        let repo = CostingRepository(database: db, locationId: "default")
        return (repo, path)
    }

    // ── latest variance (reuse P0 AccountingVariance record) ──────────────

    func testLatestVarianceReturnsNewestSnapshot() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // Latest row: snapshot_at='2026-06-16 10:00:00' → theoretical=900, actual=950, pct=5.5
        XCTAssertNotNil(bundle.latestVariance)
        XCTAssertEqual(bundle.latestVariance?.theoreticalCogs ?? -1, 900.0, accuracy: 0.001)
        XCTAssertEqual(bundle.latestVariance?.actualCogs     ?? -1, 950.0, accuracy: 0.001)
        XCTAssertEqual(bundle.latestVariance?.variancePct    ?? -1,   5.5, accuracy: 0.001)
    }

    // ── latest dish coverage (reuse P0 DishCoverageSnapshot record) ───────

    func testLatestCoverageReturnsNewestSnapshot() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertNotNil(bundle.latestCoverage)
        XCTAssertEqual(bundle.latestCoverage?.totalDishes,    73)
        XCTAssertEqual(bundle.latestCoverage?.coveredDishes,  70)
        XCTAssertEqual(bundle.latestCoverage?.coveragePct ?? -1, 95.9, accuracy: 0.001)
    }

    // ── sales lines (menu engineering input) ──────────────────────────────

    func testSalesLinesReturnedForLocation() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // 3 items seeded
        XCTAssertEqual(bundle.salesLines.count, 3)
        // Ordered by rev DESC: Burger=600 > Tacos=375 > MysteryX=75
        XCTAssertEqual(bundle.salesLines[0].itemName, "Burger")
        XCTAssertEqual(bundle.salesLines[0].qty,      40.0, accuracy: 0.001)
        XCTAssertEqual(bundle.salesLines[0].rev,      600.0, accuracy: 0.001)
        XCTAssertEqual(bundle.salesLines[0].costPerUnit ?? -1, 4.0, accuracy: 0.001)

        XCTAssertEqual(bundle.salesLines[1].itemName, "Tacos")
        XCTAssertEqual(bundle.salesLines[1].costPerUnit ?? -1, 5.0, accuracy: 0.001)

        XCTAssertEqual(bundle.salesLines[2].itemName, "MysteryX")
        XCTAssertNil(bundle.salesLines[2].costPerUnit, "MysteryX has no cost → nil")
    }

    // ── variance trend rows ────────────────────────────────────────────────

    func testVarianceTrendRowsReturnedInWindow() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // 2 trend rows seeded (both within 28-day window of MAX(period_end))
        XCTAssertEqual(bundle.varianceTrendRows.count, 2)
        // Ordered by period_end ASC
        XCTAssertEqual(bundle.varianceTrendRows[0].variancePct ?? -1, 8.0, accuracy: 0.001)
        XCTAssertEqual(bundle.varianceTrendRows[1].variancePct ?? -1, 5.5, accuracy: 0.001)
    }

    func testVarianceTrendRowsExcludeOutsideWindow() async throws {
        // Seed a third accounting_variance row whose period_end is 40 days ago — well
        // outside the 28-day window of MAX(period_end)=date('now'). The repository
        // WHERE period_end >= date(MAX,'- 28 days') must exclude it, leaving exactly 2.
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        // Open a writer to insert the out-of-window row before reading.
        let writer = try DatabasePool(path: path)
        try await writer.write { db in
            try db.execute(
                sql: """
                    INSERT INTO accounting_variance
                      (location_id, theoretical_cogs, actual_cogs, variance_amount, variance_pct,
                       snapshot_at, period_start, period_end)
                    VALUES (?, 800.0, 880.0, 80.0, 10.0,
                            '2026-01-01 00:00:00',
                            date('now', '-47 days'),
                            date('now', '-40 days'))
                    """,
                arguments: ["default"]
            )
        }
        // Close writer so DatabasePool can be re-opened as read-only.
        _ = writer  // deinits here

        let db = try LariatDatabase(path: path)
        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.varianceTrendRows.count, 2,
            "The out-of-window row (period_end = now-40d) must be excluded; only 2 in-window rows expected")
    }
}
