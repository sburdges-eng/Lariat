import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-sanitizer-api.mjs against an on-disk temp
// GRDB fixture seeded with the real sanitizer_checks + audit_events schema.
// Exercises POST happy path (row + one audit), 400 unknown chemistry, 422
// needs_corrective_action (no row, no audit), low-with-note (row saved as breach
// status + audit), GET rows + latest-per-point roll-up, location scoping, and the
// same-transaction rollback contract (audit failure rolls back the reading).

final class SanitizerRepositoryTests: XCTestCase {
    private let date = "2026-04-20"

    // ── POST happy path ────────────────────────────────────────────────

    func testInBandQuatReadingWritesRowAndOneAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.record(
            input: SanitizerCheckInput(
                pointLabel: "Wiping bucket — line",
                chemistry: "quat",
                concentrationPpm: 200,
                cookId: "alice",
                shiftDate: date
            ),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(result.row.chemistry, "quat")
        XCTAssertEqual(result.classification.status, .ok)
        XCTAssertEqual(result.row.status, "ok")

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sanitizer_checks") ?? -1, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sanitizer_checks'") ?? -1, 1)
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='sanitizer_checks' LIMIT 1")
            XCTAssertEqual(action, "insert")
            let actor = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='sanitizer_checks' LIMIT 1")
            XCTAssertEqual(actor, "alice")
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='sanitizer_checks' LIMIT 1")
            XCTAssertEqual(source, "native_cook")
        }
    }

    func testInBandChlorineStoresBandBounds() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        // 80 ppm @ 80°F → hot band 50–100 → ok, bounds recorded.
        let result = try repo.record(
            input: SanitizerCheckInput(
                pointLabel: "Dish pit final rinse",
                chemistry: "chlorine",
                concentrationPpm: 80,
                waterTempF: 80
            ),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(result.row.status, "ok")
        XCTAssertEqual(result.row.requiredMinPpm, 50)
        XCTAssertEqual(result.row.requiredMaxPpm, 100)
        XCTAssertEqual(result.row.waterTempF, 80)
    }

    // ── POST validation → 400 ──────────────────────────────────────────

    func testUnknownChemistryThrowsValidationWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.record(
                input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "lemon_juice", concentrationPpm: 200),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            guard let e = error as? SanitizerWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sanitizer_checks") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testMissingPointLabelThrowsValidation() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.record(
                input: SanitizerCheckInput(pointLabel: "   ", chemistry: "quat", concentrationPpm: 200),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            guard let e = error as? SanitizerWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed")
            }
        }
    }

    func testOffTheChartsConcentrationThrowsValidation() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.record(
                input: SanitizerCheckInput(pointLabel: "Dish pit final rinse", chemistry: "chlorine", concentrationPpm: 1500),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            guard let e = error as? SanitizerWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed")
            }
        }
    }

    // ── POST 422 needs_corrective_action ───────────────────────────────

    func testLowQuatWithoutNoteThrowsNeedsCorrectiveActionNoWrite() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.record(
                input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "quat", concentrationPpm: 50),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            guard let e = error as? SanitizerWriteError,
                  case let .needsCorrectiveAction(_, status, requiredMin, _) = e else {
                return XCTFail("expected needsCorrectiveAction")
            }
            XCTAssertTrue(e.needsCorrectiveAction)
            XCTAssertEqual(status, .low)
            XCTAssertEqual(requiredMin, 150)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sanitizer_checks") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sanitizer_checks'") ?? -1, 0)
        }
    }

    func testLowReadingWithNoteSavesRowAsBreachStatusPlusAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.record(
            input: SanitizerCheckInput(
                pointLabel: "Wiping bucket — line",
                chemistry: "quat",
                concentrationPpm: 50,
                correctiveAction: "remade bucket, re-tested at 250 ppm"
            ),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(result.row.status, "low")
        XCTAssertTrue(result.row.correctiveAction?.contains("remade bucket") == true)

        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT status FROM sanitizer_checks LIMIT 1")
            XCTAssertEqual(status, "low")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sanitizer_checks'") ?? -1, 1)
            // Audit note carries the breach reason (parity with web postAuditEvent note).
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='sanitizer_checks' LIMIT 1")
            XCTAssertTrue(note?.contains("quaternary ammonia") == true)
        }
    }

    // ── GET rows + latest-per-point ────────────────────────────────────

    func testLoadReturnsRowsAndLatestPerPoint() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "quat", concentrationPpm: 200, shiftDate: date),
            context: .nativeCook(cookId: nil, shiftDate: date)
        )
        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Wiping bucket — grill", chemistry: "quat", concentrationPpm: 250, shiftDate: date),
            context: .nativeCook(cookId: nil, shiftDate: date)
        )

        let snap = try await repo.load(date: date, locationId: "default")
        XCTAssertEqual(snap.rows.count, 2)
        XCTAssertEqual(snap.latest.count, 2)
        XCTAssertFalse(snap.knownPoints.isEmpty)
        // Sorted by point_label ascending: "grill" before "line".
        XCTAssertEqual(snap.latest.first?.pointLabel, "Wiping bucket — grill")
    }

    func testLatestPerPointKeepsMostRecentReadingForALabel() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        // Two readings for the same point; the later (created_at ASC → last) wins.
        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "quat", concentrationPpm: 200, shiftDate: date),
            context: .nativeCook(cookId: nil, shiftDate: date)
        )
        // Bump created_at so ordering is deterministic even at sub-second resolution.
        try writeDB.write { db in
            try db.execute(sql: "UPDATE sanitizer_checks SET created_at = '2026-04-20 10:00:00'")
        }
        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "quat", concentrationPpm: 300, shiftDate: date),
            context: .nativeCook(cookId: nil, shiftDate: date)
        )
        try writeDB.write { db in
            try db.execute(sql: "UPDATE sanitizer_checks SET created_at = '2026-04-20 11:00:00' WHERE concentration_ppm = 300")
        }

        let snap = try await repo.load(date: date, locationId: "default")
        XCTAssertEqual(snap.rows.count, 2)
        XCTAssertEqual(snap.latest.count, 1)
        XCTAssertEqual(snap.latest.first?.concentrationPpm, 300)
    }

    // ── location scoping ───────────────────────────────────────────────

    func testLoadIsScopedByLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Site A bucket", chemistry: "quat", concentrationPpm: 200, shiftDate: date),
            context: .nativeCook(cookId: nil, locationId: "site-a", shiftDate: date)
        )
        _ = try repo.record(
            input: SanitizerCheckInput(pointLabel: "Site B bucket", chemistry: "quat", concentrationPpm: 200, shiftDate: date),
            context: .nativeCook(cookId: nil, locationId: "site-b", shiftDate: date)
        )

        let a = try await repo.load(date: date, locationId: "site-a")
        XCTAssertEqual(a.rows.count, 1)
        XCTAssertEqual(a.rows.first?.pointLabel, "Site A bucket")
    }

    // ── same-transaction rollback (audit failure rolls back the reading) ─

    func testAuditFailureRollsBackReadingNoStrandedRows() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)

        // Rename audit_events out of the way so the audit INSERT throws mid-tx.
        try writeDB.write { db in
            try db.execute(sql: "ALTER TABLE audit_events RENAME TO audit_events_stash")
        }
        defer {
            try? writeDB.write { db in
                try db.execute(sql: "ALTER TABLE audit_events_stash RENAME TO audit_events")
            }
        }

        XCTAssertThrowsError(
            try repo.record(
                input: SanitizerCheckInput(pointLabel: "Wiping bucket — line", chemistry: "quat", concentrationPpm: 200, cookId: "alice"),
                context: .nativeCook(cookId: "alice")
            )
        )
        try writeDB.pool.read { db in
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sanitizer_checks") ?? -1, 0,
                "sanitizer_checks must roll back when the audit write fails — no stranded rows"
            )
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedSanitizerDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedSanitizerDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-sanitizer-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    // DatabasePool establishes WAL mode so a read-only pool can open the file.
    let dbPool = try DatabasePool(path: path)
    try dbPool.write { db in
        try db.execute(sql: """
            CREATE TABLE sanitizer_checks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              station_id TEXT,
              point_label TEXT NOT NULL,
              chemistry TEXT NOT NULL
                CHECK(chemistry IN ('chlorine','quat','iodine','other')),
              concentration_ppm REAL NOT NULL,
              required_min_ppm REAL,
              required_max_ppm REAL,
              water_temp_f REAL,
              status TEXT NOT NULL CHECK(status IN ('ok','low','high')),
              corrective_action TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_sanitizer_shift
              ON sanitizer_checks(location_id, shift_date);
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL
                CHECK(action IN ('insert','update','delete','correction','view')),
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
