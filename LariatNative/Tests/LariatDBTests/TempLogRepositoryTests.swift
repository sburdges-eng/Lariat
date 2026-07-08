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

    // ── Calibration warning (C1 verify-41 T8) ──────────────────────────

    /// A CCP reading that cites a probe whose LAST calibration failed must carry
    /// the advisory + stamp `calibration_warning:<probe>` in the audit note
    /// (web route.js Bundle G). Native previously hardcoded the warning to nil.
    func testReadingCitingFailedProbeStampsCalibrationWarning() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO thermometer_calibrations (location_id, thermometer_id, method, passed, calibrated_at, frequency_days) VALUES ('default','probe-7','ice_point',0,'2026-01-01 10:00:00',30)"
            )
        }
        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let result = try repo.postReading(
            input: TempLogPostInput(shiftDate: ShiftDate.todayISO(), pointId: "walk_in_cooler", readingF: 38, cookId: "alice", probeId: "probe-7"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(
            result.calibrationWarning,
            "probe \"probe-7\" failed its last calibration on 2026-01-01 10:00:00 — recalibrate before using it for a CCP reading"
        )
        try writeDB.pool.read { db in
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='temp_log' LIMIT 1")
            XCTAssertEqual(note, "calibration_warning:probe-7")
        }
    }

    /// A probe with NO calibration on record → 'unknown' advisory (web passes
    /// `known_probe_ids:[probe_id]`, so classifyProbes emits an unknown summary).
    func testReadingCitingUncalibratedProbeStampsUnknownWarning() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let result = try repo.postReading(
            input: TempLogPostInput(shiftDate: ShiftDate.todayISO(), pointId: "walk_in_cooler", readingF: 38, cookId: "alice", probeId: "probe-9"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(
            result.calibrationWarning,
            "probe \"probe-9\" has no calibration on record — log an ice-point or boiling-point calibration before using it for a CCP reading"
        )
        try writeDB.pool.read { db in
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='temp_log' LIMIT 1")
            XCTAssertEqual(note, "calibration_warning:probe-9")
        }
    }

    /// A probe with a recent PASSING calibration → no advisory, no calibration
    /// note (non-blocking either way).
    func testReadingCitingRecentlyPassedProbeHasNoWarning() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO thermometer_calibrations (location_id, thermometer_id, method, passed, calibrated_at, frequency_days) VALUES ('default','probe-3','ice_point',1,?,30)",
                arguments: [ShiftDate.todayISO()]
            )
        }
        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let result = try repo.postReading(
            input: TempLogPostInput(shiftDate: ShiftDate.todayISO(), pointId: "walk_in_cooler", readingF: 38, cookId: "alice", probeId: "probe-3"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertNil(result.calibrationWarning)
        try writeDB.pool.read { db in
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='temp_log' LIMIT 1")
            XCTAssertNil(note)
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
            CREATE TABLE thermometer_calibrations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              thermometer_id TEXT NOT NULL,
              method TEXT,
              before_reading_f REAL,
              passed INTEGER,
              calibrated_at TEXT,
              frequency_days INTEGER
            );
            """)
    }
    return path
}
