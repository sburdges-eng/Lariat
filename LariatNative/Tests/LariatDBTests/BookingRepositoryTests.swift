import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Ports the `tests/js/test-shows-repo.mjs` cases /booking consumes
/// (upcomingShows, pipelineCounts, nextUpcoming). The web fixture rows
/// (2026-05-01, 05-08, 05-15, 05-22, 06-01) are seeded directly here —
/// the xlsx-ingest pipeline the web test drives is the shows wave's
/// concern, not this read layer's. archiveSearch/getShowById cases belong
/// to /shows + /playbook (other waves) and are NOT ported.
final class BookingRepositoryTests: XCTestCase {

    func testUpcomingShowsRespects35DayWindow() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        let rows = try await h.repo.upcomingShows(today: "2026-04-25", weeks: 5)
        // 5 weeks = 35 days → through 2026-05-30. Expect 4 rows (drops 06-01).
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(
            rows.map(\.showDate),
            ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22"]
        )
    }

    func testUpcomingShowsScopedByLocation() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        let other = BookingRepository(database: h.readDB, locationId: "other-location")
        let rows = try await other.upcomingShows(today: "2026-04-25", weeks: 5)
        XCTAssertEqual(rows.count, 0)
    }

    func testPipelineCountsIncludesUpcomingPlusPastActiveShows() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        // A past, unarchived, fully-settled row (web test inserts the same).
        try await h.insertShow(
            bandName: "the settled late show",
            showDate: "2026-04-01",
            statusJson: #"{"create_dice_tickets":"y","dice_email":"tix, dos"}"#
        )

        let counts = try await h.repo.pipelineCounts(today: "2026-04-25", weeks: 52)
        let total = counts.values.reduce(0, +)
        let upcoming = try await h.repo.upcomingShows(today: "2026-04-25", weeks: 52)
        XCTAssertEqual(total, upcoming.count + 1)
        XCTAssertEqual(counts["Settled"], 1)
    }

    func testPipelineCountsEveryKeyIsAKnownStage() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        let counts = try await h.repo.pipelineCounts(today: "2026-04-25", weeks: 52)
        XCTAssertEqual(
            Set(counts.keys),
            Set(ShowPipelineCompute.knownStages)
        )
    }

    func testNextUpcomingReturnsSoonestFutureShowOrNil() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        let next = try await h.repo.nextUpcoming(today: "2026-04-25")
        XCTAssertEqual(next?.showDate, "2026-05-01")
        let none = try await h.repo.nextUpcoming(today: "2030-01-01")
        XCTAssertNil(none)
    }

    func testLoadBoardBundlesCalendarCountsAndNext() async throws {
        let h = try await Harness()
        defer { h.cleanup() }

        let snap = try await h.repo.loadBoard(today: "2026-04-25")
        XCTAssertEqual(snap.upcoming.count, 4)
        XCTAssertEqual(snap.next?.showDate, "2026-05-01")
        XCTAssertEqual(Set(snap.pipelineCounts.keys), Set(ShowPipelineCompute.knownStages))
        // Fixture: 05-01 announced+2 marketing hits → Confirmed; the rest
        // are bare rows → Inquiry (06-01 included by the 52-week window).
        XCTAssertEqual(snap.pipelineCounts["Confirmed"], 1)
        XCTAssertEqual(snap.pipelineCounts["Inquiry"], 4)
    }

    func testAddDaysUtcMath() {
        XCTAssertEqual(BookingRepository.addDays("2026-04-25", days: 35), "2026-05-30")
        XCTAssertEqual(BookingRepository.addDays("2026-12-30", days: 7), "2027-01-06")
    }

    // ── harness ──────────────────────────────────────────────────────────

    private struct Harness {
        let repo: BookingRepository
        let readDB: LariatDatabase
        let writeDB: LariatWriteDatabase
        let path: String

        init() async throws {
            path = try seedBookingShowsDatabase()
            readDB = try LariatDatabase(path: path)
            writeDB = try LariatWriteDatabase(path: path)
            repo = BookingRepository(database: readDB, locationId: "default")
            // Web fixture dates: 05-01, 05-08, 05-15, 05-22, 06-01.
            try await insertShow(
                bandName: "confirmed opener",
                showDate: "2026-05-01",
                price: 15,
                doorTix: "door",
                statusJson: #"{"announce_date":"y","meta_ads":"y","fb_event":"y"}"#
            )
            for (i, date) in ["2026-05-08", "2026-05-15", "2026-05-22", "2026-06-01"].enumerated() {
                try await insertShow(bandName: "band \(i)", showDate: date, statusJson: "{}")
            }
        }

        func insertShow(
            bandName: String,
            showDate: String,
            price: Double? = 10,
            doorTix: String? = nil,
            statusJson: String,
            locationId: String = "default"
        ) async throws {
            try await writeDB.pool.write { db in
                try db.execute(
                    sql: """
                      INSERT INTO shows
                        (location_id, band_name, show_date, price, door_tix, status_json,
                         source_row, ingested_at, ingest_run_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
                      """,
                    arguments: [locationId, bandName, showDate, price, doorTix, statusJson, 1]
                )
            }
        }

        func cleanup() {
            let dir = (path as NSString).deletingLastPathComponent
            try? FileManager.default.removeItem(atPath: dir)
        }
    }
}

/// Web schema (lib/db.ts) for shows.
private func seedBookingShowsDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-booking-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE shows (
              id              INTEGER PRIMARY KEY,
              location_id     TEXT NOT NULL DEFAULT 'default',
              band_name       TEXT NOT NULL,
              show_date       TEXT NOT NULL,
              price           REAL,
              door_tix        TEXT,
              status_json     TEXT NOT NULL DEFAULT '{}',
              source_row      INTEGER NOT NULL,
              ingested_at     TEXT NOT NULL,
              ingest_run_id   INTEGER NOT NULL
            );
            """)
    }
    return path
}
