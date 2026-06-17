import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class CalibrationRepositoryTests: XCTestCase {
    func testPassCalibrationPersistsAndAudits() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = CalibrationRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let result = try repo.post(
            input: CalibrationPostInput(
                thermometerId: "THERM-001",
                method: .icePoint,
                readingF: 32.0,
                cookId: "alice"
            ),
            context: context
        )
        XCTAssertTrue(result.decision.passed)
        XCTAssertEqual(result.row.passed, 1)

        try writeDB.pool.read { db in
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM thermometer_calibrations") ?? 0,
                1
            )
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='thermometer_calibrations'") ?? 0,
                1
            )
        }
    }

    func testFailCalibrationStillPersists() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = CalibrationRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let result = try repo.post(
            input: CalibrationPostInput(
                thermometerId: "THERM-002",
                method: .icePoint,
                readingF: 40.0,
                cookId: "alice"
            ),
            context: context
        )
        XCTAssertFalse(result.decision.passed)
        XCTAssertEqual(result.row.passed, 0)

        try writeDB.pool.read { db in
            let note: String? = try String.fetchOne(
                db,
                sql: "SELECT note FROM audit_events WHERE entity='thermometer_calibrations' LIMIT 1"
            )
            XCTAssertEqual(note, "fail:THERM-002:ice_point")
        }
    }

    func testBoilingPointUsesAltitude() throws {
        let expected = CalibrationCompute.expectedReadingF(method: .boilingPoint, elevationFt: 7800)
        XCTAssertEqual(expected, 212 - 7800 / 550, accuracy: 0.01)
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedCalibrationDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedCalibrationDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-calibration-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE thermometer_calibrations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              thermometer_id TEXT NOT NULL,
              method TEXT NOT NULL,
              before_reading_f REAL,
              after_reading_f REAL,
              passed INTEGER NOT NULL DEFAULT 0,
              action_taken TEXT,
              cook_id TEXT,
              calibrated_at TEXT NOT NULL,
              frequency_days INTEGER,
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
