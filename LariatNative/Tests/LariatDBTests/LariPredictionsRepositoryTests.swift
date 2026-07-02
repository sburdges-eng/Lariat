import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// DB-semantics parity for GET /api/lari/predictions
/// (tests/js/test-lari-predictions-api.mjs — the PIN gate is app-layer
/// natively; these pin the surface routing + data plumbing).
final class LariPredictionsRepositoryTests: XCTestCase {
    private let LOC = "default"

    private func makeRepo() throws -> (LariPredictionsRepository, LariatWriteDatabase, String) {
        let path = try seedAssistantDatabase()
        let writeDB = try LariatWriteDatabase(path: path)
        // Extra tables this surface needs (real web schema subsets).
        _ = try writeDB.write { db in
            try db.execute(sql: """
                CREATE TABLE shows (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  band_name TEXT,
                  show_date TEXT,
                  location_id TEXT DEFAULT 'default'
                );
                CREATE TABLE sound_scenes (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  show_id INTEGER NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  scene_name TEXT NOT NULL,
                  plot_json TEXT,
                  spl_limit_db REAL,
                  notes TEXT,
                  saved_by_cook_id TEXT,
                  saved_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE spl_readings (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  show_id INTEGER NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  db_value REAL NOT NULL,
                  taken_at TEXT DEFAULT (datetime('now')),
                  noted_by_cook_id TEXT
                );
                CREATE TABLE waitlist_parties (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT DEFAULT 'default',
                  party_name TEXT NOT NULL,
                  party_size INTEGER,
                  joined_at TEXT DEFAULT (datetime('now')),
                  status TEXT DEFAULT 'waiting',
                  seated_at TEXT,
                  left_at TEXT,
                  phone TEXT,
                  notes TEXT
                );
                """)
        }
        let readDB = try LariatDatabase(path: path)
        return (LariPredictionsRepository(readDB: readDB), writeDB, path)
    }

    func testUnknownSurfaceReturnsEmptyWithNoteNeverThrows() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let feed = try repo.feed(surface: "kds", locationId: LOC, date: "2026-05-13")
        XCTAssertEqual(feed.predictions, [])
        XCTAssertEqual(feed.note, "Surface \"kds\" has no LaRi handler yet.")
    }

    func testSoundSurfaceRequiresShowId() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        XCTAssertThrowsError(try repo.feed(surface: "sound", locationId: LOC, date: "2026-05-13")) {
            XCTAssertEqual(
                $0 as? LariPredictionsRepository.BadRequest,
                LariPredictionsRepository.BadRequest("show_id query param required for surface=sound")
            )
        }
    }

    func testSoundSurfaceUnknownShowReturnsNote() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let feed = try repo.feed(surface: "sound", locationId: LOC, date: "2026-05-13", showId: 42)
        XCTAssertEqual(feed.predictions, [])
        XCTAssertEqual(feed.note, "Show 42 not found at location default.")
    }

    func testSoundSurfaceBuildsOverLimitAlert() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let showId: Int64 = try writeDB.write { db in
            try db.execute(sql: "INSERT INTO shows (band_name, location_id) VALUES ('The Stand', ?)", arguments: [LOC])
            let id = db.lastInsertedRowID
            try db.execute(
                sql: """
                  INSERT INTO sound_scenes (show_id, location_id, scene_name, plot_json, spl_limit_db)
                  VALUES (?, ?, 'Mix A', '{"channels":[{"ch":1}],"monitors":[]}', 100)
                  """,
                arguments: [id, LOC]
            )
            for v in [102.0, 105.0, 98.0] {
                try db.execute(
                    sql: "INSERT INTO spl_readings (show_id, location_id, db_value) VALUES (?, ?, ?)",
                    arguments: [id, LOC, v]
                )
            }
            return id
        }
        let feed = try repo.feed(surface: "sound", locationId: LOC, date: "2026-05-13", showId: showId)
        XCTAssertEqual(feed.showId, showId)
        let alert = feed.predictions.first { $0.id == "sound-over-limit-\(showId)" }
        XCTAssertNotNil(alert, "2 readings over the 100 dB ceiling must alert")
        XCTAssertEqual(alert?.severity, .alert)
        XCTAssertTrue(alert?.text.contains("2 readings") == true)
    }

    func testHostSurfaceRollsUpWaitlist() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let today = ShiftDate.todayISO()
        _ = try writeDB.write { db in
            for i in 0..<9 {
                try db.execute(
                    sql: "INSERT INTO waitlist_parties (location_id, party_name, party_size, status, joined_at) VALUES (?, ?, 2, 'waiting', datetime('now', '-10 minutes'))",
                    arguments: [LOC, "Party \(i)"]
                )
            }
        }
        let feed = try repo.feed(surface: "host", locationId: LOC, date: today)
        XCTAssertNotNil(feed.predictions.first { $0.id == "host-overflow-\(today)" },
                        "9 waiting parties crosses the 8-party overflow threshold")
    }

    func testBeoSurfaceBuildsMissingContactAlert() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let today = ShiftDate.todayISO()
        let eventId: Int64 = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO beo_events (title, event_date, contact_name, guest_count, location_id) VALUES ('Hendricks Wedding', ?, NULL, 80, ?)",
                arguments: [today, LOC]
            )
            return db.lastInsertedRowID
        }
        let feed = try repo.feed(surface: "beo", locationId: LOC, date: today)
        let alert = feed.predictions.first { $0.id == "beo-missing-contact-\(eventId)" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
    }

    func testBeoSurfaceLocationScoped() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let today = ShiftDate.todayISO()
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO beo_events (title, event_date, contact_name, guest_count, location_id) VALUES ('Foreign Event', ?, NULL, 80, 'site-b')",
                arguments: [today]
            )
        }
        let feed = try repo.feed(surface: "beo", locationId: LOC, date: today)
        XCTAssertEqual(feed.predictions, [], "foreign-location events never leak")
    }
}
