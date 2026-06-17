import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class CommandRepositoryTests: XCTestCase {

    private func todayISO() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date())
    }

    func testCommandBundleFetchesAllData() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        // eighty_six fixture uses shift_date=date('now') with resolved_at IS NULL.
        // Lobster Bisque is unresolved → eightySixCount == 1; Mahi is resolved → excluded.
        XCTAssertEqual(bundle.eightySixCount, 1)

        // shift_breaks: 2 rows seeded for date('now')
        XCTAssertEqual(bundle.shiftBreaks.count, 2)

        // staff_certifications: 3 active rows with expires_on
        XCTAssertEqual(bundle.certRows.count, 3)

        // performance_reviews: 2 today, 1 yesterday → total=3
        XCTAssertEqual(bundle.performanceReviewsToday, 2)
        XCTAssertEqual(bundle.performanceReviewsTotal, 3)

        // temp_log: 2 rows for today
        XCTAssertEqual(bundle.tempLogRows.count, 2)

        // date_marks: 2 active (non-discarded) marks
        XCTAssertEqual(bundle.dateMarkRows.count, 2)

        // thermometer_calibrations: 2 rows
        XCTAssertEqual(bundle.calibrationRows.count, 2)

        // preshift_notes: 2 for today
        XCTAssertEqual(bundle.preshiftNoteCount, 2)

        // beo_events: 1 active (1 cancelled excluded)
        XCTAssertEqual(bundle.eventsCount, 1)
        XCTAssertEqual(bundle.eventsGuests, 50)

        // reservations: 5 status rows for today (booked x2, seated, completed, no_show, cancelled)
        // 'confirmed' is not seeded — summarize() silently drops unknown statuses.
        XCTAssertEqual(bundle.reservationRows.count, 5)

        // prep_tasks: 5 rows for today (2 todo, 1 in_progress, 1 done, 1 skipped)
        XCTAssertEqual(bundle.prepTaskRows.count, 5)

        // inventory_updates: 2 waste today, 3 waste 3 days ago = 5 total in 7d window
        XCTAssertEqual(bundle.wasteTodayCount, 2)
        XCTAssertEqual(bundle.waste7dCount, 5)

        // dining_tables: 4 tables (open, seated, dirty, closed)
        XCTAssertEqual(bundle.diningTableRows.count, 4)

        // inventory_par: 3 total, 1 below par
        XCTAssertEqual(bundle.parTotal, 3)
        XCTAssertEqual(bundle.lowParIngredients.count, 1)

        // inventory_counts: 1 open count
        XCTAssertEqual(bundle.openCountsCount, 1)
    }

    func testYesterdaySalesComputedCorrectly() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        // Use 2026-06-16 as today so yesterday = 2026-06-15 which has seeded data
        let bundle = try await repo.fetch(today: "2026-06-16")

        let row = try XCTUnwrap(bundle.salesYesterday, "Expected salesYesterday to be non-nil for 2026-06-15")
        XCTAssertEqual(row.netSales, 4200.0)
        XCTAssertEqual(row.orders, 180)
        XCTAssertEqual(row.guests, 230)
    }

    func testTrailingAvgComputedFromMultipleRows() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        // Use 2026-06-16 as today → trailing subquery grabs rows with shift_date < '2026-06-16'
        // Fixture has 2 rows: 2026-06-15 (4200/180) and 2026-06-14 (3900/165)
        let bundle = try await repo.fetch(today: "2026-06-16")

        let avg = try XCTUnwrap(bundle.salesTrailing, "Expected salesTrailing to be non-nil")
        XCTAssertEqual(avg.avgSales ?? 0, (4200.0 + 3900.0) / 2, accuracy: 0.01)
        XCTAssertEqual(avg.avgOrders ?? 0, (180.0 + 165.0) / 2, accuracy: 0.01)
    }

    func testSince7DateWindow() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        // waste7dCount should include today's 2 + 3 days-ago 3 = 5
        XCTAssertEqual(bundle.waste7dCount, 5)
        // wasteTodayCount should be exactly 2
        XCTAssertEqual(bundle.wasteTodayCount, 2)
    }

    func testTempLogOutOfRangeDetectable() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        XCTAssertEqual(bundle.tempLogRows.count, 2)
        // One row is within range (reading_f=38, min=33, max=41)
        // One row is out of range (reading_f=55, min=33, max=41)
        let outOfRange = bundle.tempLogRows.filter { row in
            guard let r = row.readingF, let mn = row.requiredMinF, let mx = row.requiredMaxF else { return false }
            return r < mn || r > mx
        }
        XCTAssertEqual(outOfRange.count, 1)
    }

    func testDateMarksFilterDiscarded() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        // Only 2 non-discarded marks returned (discarded_at IS NULL filter)
        XCTAssertEqual(bundle.dateMarkRows.count, 2)
        XCTAssertTrue(bundle.dateMarkRows.allSatisfy { $0.discardedAt == nil })
    }

    func testEventsExcludeCancelled() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        // 1 active event, 1 cancelled event → only 1 counted
        XCTAssertEqual(bundle.eventsCount, 1)
        XCTAssertEqual(bundle.eventsGuests, 50)
    }

    func testReservationsGroupedByStatus() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = CommandRepository(database: try LariatDatabase(path: path), locationId: "default")
        let today = todayISO()
        let bundle = try await repo.fetch(today: today)

        // 5 status rows: booked (c=2), seated (1), completed (1), no_show (1), cancelled (1)
        XCTAssertEqual(bundle.reservationRows.count, 5)
        let bookedRow = bundle.reservationRows.first { $0.status == "booked" }
        XCTAssertEqual(bookedRow?.c, 2)
    }
}
