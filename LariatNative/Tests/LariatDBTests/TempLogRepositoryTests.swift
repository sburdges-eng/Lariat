import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class TempLogRepositoryTests: XCTestCase {
    func testInRangeInsertWithAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let result = try repo.postReading(
            input: TempLogPostInput(
                shiftDate: ShiftDate.todayISO(),
                pointId: "walk_in_cooler",
                readingF: 38,
                cookId: "alice"
            ),
            context: context
        )
        XCTAssertEqual(result.classification, .ok)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM temp_log") ?? 0, 1)
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='temp_log'") ?? 0,
                1
            )
            let note: String? = try String.fetchOne(
                db,
                sql: "SELECT note FROM audit_events WHERE entity='temp_log' LIMIT 1"
            )
            XCTAssertNil(note)
        }
    }

    func testOutOfRangeWithoutNoteWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        XCTAssertThrowsError(
            try repo.postReading(
                input: TempLogPostInput(
                    shiftDate: ShiftDate.todayISO(),
                    pointId: "walk_in_cooler",
                    readingF: 55,
                    cookId: "alice"
                ),
                context: context
            )
        ) { error in
            XCTAssertTrue((error as? RuleGateError)?.needsCorrectiveAction == true)
        }

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM temp_log") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testOutOfRangeWithNoteInsertsAuditNote() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        _ = try repo.postReading(
            input: TempLogPostInput(
                shiftDate: ShiftDate.todayISO(),
                pointId: "walk_in_cooler",
                readingF: 55,
                correctiveAction: "moved product",
                cookId: "alice"
            ),
            context: context
        )

        try writeDB.pool.read { db in
            let note: String? = try String.fetchOne(
                db,
                sql: "SELECT note FROM audit_events WHERE entity='temp_log' LIMIT 1"
            )
            XCTAssertEqual(note, "out_of_range:walk_in_cooler")
        }
    }

    func testBackDateWithoutPinRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        XCTAssertThrowsError(
            try repo.postReading(
                input: TempLogPostInput(
                    shiftDate: "2020-01-01",
                    pointId: "walk_in_cooler",
                    readingF: 38,
                    cookId: "alice"
                ),
                context: context,
                env: ["LARIAT_PIN": "9999"]
            )
        ) { error in
            XCTAssertEqual(error as? TempLogWriteError, .pinRequiredForPastDate)
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedTempLogDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedTempLogDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-temp-log-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE temp_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT NOT NULL DEFAULT 'default',
              point_id TEXT,
              reading_f REAL,
              required_min_f REAL,
              required_max_f REAL,
              corrective_action TEXT,
              cook_id TEXT,
              probe_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              shift_date TEXT,
              location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
