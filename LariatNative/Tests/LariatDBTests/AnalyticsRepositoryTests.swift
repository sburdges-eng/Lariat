import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Parity tests for AnalyticsRepository against the T5 fixture database.
//
// Fixture known values (from task-5-report.md / Fixtures.swift comments):
//   toast_sales_daily  cg=1: 2026-06-15 net_sales=4200 orders=180 guests=230
//                      cg=1: 2026-06-14 net_sales=3900 orders=165 guests=205
//                      cg=2: net_sales=3800 orders=160 guests=198 (prior period)
//   toast_sales_dow    cg=1: day_of_week=0 net_sales=4200; cg=2: day_of_week=0 net_sales=3800
//   toast_sales_hour   cg=1: hour_24=18 label='6 PM' net_sales=1200 orders=52 guests=68
//                      cg=2: hour_24=18 label='6 PM' net_sales=1100 orders=48 guests=62
//   spend_monthly      2026-05: 14200.0; 2026-04: 13500.0
//   sales_lines        Burger qty=40 rev=600; Tacos qty=25 rev=375; MysteryX qty=5 rev=75

final class AnalyticsRepositoryTests: XCTestCase {

    private func makeRepo() throws -> (AnalyticsRepository, String) {
        let path = try seedFixtureDatabase()
        let db = try LariatDatabase(path: path)
        let repo = AnalyticsRepository(database: db, locationId: "default")
        return (repo, path)
    }

    // ── daily ──────────────────────────────────────────────────────────────

    func testDailyFetchesCurrentPeriodRows() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // 2 rows in cg=1
        XCTAssertEqual(bundle.daily.count, 2)
        // Rows ordered by shift_date ascending
        XCTAssertEqual(bundle.daily[0].shiftDate, "2026-06-14")
        XCTAssertEqual(bundle.daily[1].shiftDate, "2026-06-15")
        XCTAssertEqual(bundle.daily[0].netSales ?? -1, 3900.0, accuracy: 0.001)
        XCTAssertEqual(bundle.daily[1].netSales ?? -1, 4200.0, accuracy: 0.001)
        XCTAssertEqual(bundle.daily[0].orders, 165)
        XCTAssertEqual(bundle.daily[1].orders, 180)
    }

    // ── dowCurrent / dowPrior ──────────────────────────────────────────────

    func testDowCurrentFetchesCg1() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.dowCurrent.count, 1)
        XCTAssertEqual(bundle.dowCurrent[0].dayOfWeek, "Sun")
        XCTAssertEqual(bundle.dowCurrent[0].netSales ?? -1, 4200.0, accuracy: 0.001)
    }

    func testDowPriorFetchesCg2() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.dowPrior.count, 1)
        XCTAssertEqual(bundle.dowPrior[0].dayOfWeek, "Sun")
        XCTAssertEqual(bundle.dowPrior[0].netSales ?? -1, 3800.0, accuracy: 0.001)
    }

    // ── hourlyCurrent / hourlyPrior ────────────────────────────────────────

    func testHourlyCurrentFetchesCg1() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.hourlyCurrent.count, 1)
        XCTAssertEqual(bundle.hourlyCurrent[0].hour24, 18)
        XCTAssertEqual(bundle.hourlyCurrent[0].label, "6 PM")
        XCTAssertEqual(bundle.hourlyCurrent[0].netSales ?? -1, 1200.0, accuracy: 0.001)
        XCTAssertEqual(bundle.hourlyCurrent[0].orders, 52)
    }

    func testHourlyPriorFetchesCg2() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.hourlyPrior.count, 1)
        XCTAssertEqual(bundle.hourlyPrior[0].hour24, 18)
        XCTAssertEqual(bundle.hourlyPrior[0].netSales ?? -1, 1100.0, accuracy: 0.001)
    }

    // ── spend ──────────────────────────────────────────────────────────────

    func testSpendFetchesMonthlyRows() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // 2 months seeded
        XCTAssertEqual(bundle.spend.count, 2)
        // Ordered by month ascending
        XCTAssertEqual(bundle.spend[0].month, "2026-04")
        XCTAssertEqual(bundle.spend[0].shamrockTotalSpend ?? -1, 13500.0, accuracy: 0.001)
        XCTAssertEqual(bundle.spend[1].month, "2026-05")
        XCTAssertEqual(bundle.spend[1].shamrockTotalSpend ?? -1, 14200.0, accuracy: 0.001)
    }

    // ── top items ──────────────────────────────────────────────────────────

    func testTopItemsReturnedByRevDesc() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // 3 distinct items
        XCTAssertEqual(bundle.top.count, 3)
        // Ordered by rev DESC: Burger=600 > Tacos=375 > MysteryX=75
        XCTAssertEqual(bundle.top[0].itemName, "Burger")
        XCTAssertEqual(bundle.top[0].qty ?? -1, 40.0, accuracy: 0.001)
        XCTAssertEqual(bundle.top[0].rev ?? -1, 600.0, accuracy: 0.001)
        XCTAssertEqual(bundle.top[1].itemName, "Tacos")
        XCTAssertEqual(bundle.top[2].itemName, "MysteryX")
    }

    // ── dailyPrior ─────────────────────────────────────────────────────────

    func testDailyPriorRevSumsCg2() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        // cg=2 has one row: net_sales=3800
        // dailyPriorRev is now Double? — unwrap before accuracy comparison
        XCTAssertEqual(bundle.dailyPriorRev ?? -1, 3800.0, accuracy: 0.001)
    }

    // ── dateRange ──────────────────────────────────────────────────────────

    func testDateRangeFetchedFromCg1() async throws {
        let (repo, path) = try makeRepo()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let bundle = try await repo.fetch()

        XCTAssertEqual(bundle.dateRange, "2026-06-09 to 2026-06-15")
    }
}
