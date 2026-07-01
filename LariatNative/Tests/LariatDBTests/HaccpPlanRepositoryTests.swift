import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Parity tests for HaccpPlanRepository against a self-contained in-memory GRDB
// fixture (never a mock, never the real DB). Schema columns match the web-owned
// lariat.db exactly (verified against `.schema`). The plan is assembled for a
// FIXED plan_date ('2026-07-15') so the 30-day window is deterministic:
//   window_start = 2026-06-15, plan_date = 2026-07-15.
//
// Seeded rows deliberately straddle the window and mix locations so the tests
// pin location-scoping, date-windowing, and the corrective/module/probe SELECTs.

final class HaccpPlanRepositoryTests: XCTestCase {

    private let planDate = "2026-07-15"
    private let generatedAt = "2026-07-15T20:00:00.000Z"

    private func makeRepo(location: String = "default") throws -> (HaccpPlanRepository, String) {
        let path = try seedHaccpDatabase()
        let db = try LariatDatabase(path: path)
        return (HaccpPlanRepository(database: db, locationId: location), path)
    }

    private func cleanup(_ path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }

    // ── Window + top-level fields ──────────────────────────────────────────

    func testPlanWindowFields() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        XCTAssertEqual(plan.planDate, "2026-07-15")
        XCTAssertEqual(plan.windowStart, "2026-06-15")
        XCTAssertEqual(plan.windowDays, 30)
        XCTAssertEqual(plan.locationId, "default")
        XCTAssertEqual(plan.generatedAt, generatedAt)
    }

    // ── CCP inventory: temp_log grouped counts, windowed + scoped ──────────

    func testCcpCountsWindowedAndScoped() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)

        // 13 CCP tiles (one per registry point), always present.
        XCTAssertEqual(plan.ccps.count, 13)

        // walk_in_cooler: 3 in-window rows seeded, 1 with a corrective note.
        // (a 4th row is dated 2026-06-01 — BEFORE window_start → excluded;
        //  a 5th row is location_id='other' → excluded by scope.)
        let walkIn = plan.ccps.first { $0.pointId == "walk_in_cooler" }!
        XCTAssertEqual(walkIn.logs30d, 3)
        XCTAssertEqual(walkIn.corrective30d, 1)

        // hot_hold: 1 in-window row, 0 corrective.
        let hotHold = plan.ccps.first { $0.pointId == "hot_hold" }!
        XCTAssertEqual(hotHold.logs30d, 1)
        XCTAssertEqual(hotHold.corrective30d, 0)

        // freezer: no rows.
        let freezer = plan.ccps.first { $0.pointId == "freezer" }!
        XCTAssertEqual(freezer.logs30d, 0)
    }

    // ── Cooling summary ────────────────────────────────────────────────────

    func testCoolingSummaryCountsBreachesAndOpen() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        // 3 in-window cooling_log rows: 1 breach, 1 in_progress (open), 1 ok.
        XCTAssertEqual(plan.cooling.ccpId, "CCP-8")
        XCTAssertEqual(plan.cooling.batches30d, 3)
        XCTAssertEqual(plan.cooling.breaches30d, 1)
        XCTAssertEqual(plan.cooling.openNow, 1)
    }

    // ── Rule-module inventory ──────────────────────────────────────────────

    func testRuleModuleCounts() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        let byId = Dictionary(uniqueKeysWithValues: plan.ruleModules.map { ($0.id, $0) })

        // receiving_log: 2 in-window rows.
        XCTAssertEqual(byId["receiving"]?.records, 2)
        XCTAssertEqual(byId["receiving"]?.active, true)
        // date_marks by prepared_on: 1 in-window.
        XCTAssertEqual(byId["date_marking"]?.records, 1)
        // tphc_entries: 1 in-window.
        XCTAssertEqual(byId["tphc"]?.records, 1)
        // sanitizer_checks: 0.
        XCTAssertEqual(byId["sanitizer"]?.records, 0)
        XCTAssertEqual(byId["sanitizer"]?.active, false)
        // cleaning_log: 1.
        XCTAssertEqual(byId["cleaning"]?.records, 1)
        // sick_worker_reports: 0.
        XCTAssertEqual(byId["sick_worker"]?.records, 0)
        // pest_control_log: 1.
        XCTAssertEqual(byId["pest_control"]?.records, 1)
        // sds_registry active=1 count: 2 (one archived/inactive excluded).
        XCTAssertEqual(byId["sds"]?.records, 2)
        XCTAssertEqual(byId["sds"]?.active, true)
    }

    // ── Corrective-action feed ─────────────────────────────────────────────

    func testCorrectiveFeedMergesSourcesNewestFirst() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        // 1 temp_log corrective (walk_in_cooler) + 1 line_check fail w/ note.
        XCTAssertEqual(plan.correctiveActions.count, 2)
        // line_check row created_at is later → leads.
        XCTAssertEqual(plan.correctiveActions.entries[0].source, .lineCheck)
        XCTAssertEqual(plan.correctiveActions.entries[0].subject, "grill: Ribeye")
        XCTAssertEqual(plan.correctiveActions.entries[1].source, .tempLog)
        XCTAssertEqual(plan.correctiveActions.entries[1].subject, "walk_in_cooler")
        // A line_check row with status='pass' must NOT appear.
        XCTAssertFalse(plan.correctiveActions.entries.contains { $0.note == "should-not-appear" })
    }

    // ── Calibration window records + probe board ───────────────────────────

    func testCalibrationWindowRecordsScoped() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        // 2 in-window calibrations for 'default' (a 3rd is dated 2026-05-01,
        // before window_start → excluded from records but IN the probe board).
        XCTAssertEqual(plan.calibrations.records.count, 2)
        // Ordered calibrated_at DESC — THERM-002 (07-10) before THERM-001 (07-01).
        XCTAssertEqual(plan.calibrations.records[0].thermometerId, "THERM-002")
        XCTAssertEqual(plan.calibrations.records[1].thermometerId, "THERM-001")
    }

    func testProbeBoardUsesAllHistory() async throws {
        let (repo, path) = try makeRepo()
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        let byId = Dictionary(uniqueKeysWithValues: plan.calibrations.probes.map { ($0.thermometerId, $0) })

        // THERM-001: last pass 2026-07-01, freq 30 → due 2026-07-31; now 07-15 → ok.
        XCTAssertEqual(byId["THERM-001"]?.status, .ok)
        // THERM-002: last pass 2026-07-10 → due 2026-08-09 → ok.
        XCTAssertEqual(byId["THERM-002"]?.status, .ok)
        // THERM-OLD: only a 2026-05-01 pass (outside the records window but
        // present in the probe board), freq 30 → due 2026-05-31 → overdue.
        XCTAssertEqual(byId["THERM-OLD"]?.status, .overdue)
        XCTAssertEqual(byId["THERM-OLD"]?.total, 1)
        // 3 probes total.
        XCTAssertEqual(plan.calibrations.probes.count, 3)
        // Sort: overdue before ok.
        XCTAssertEqual(plan.calibrations.probes[0].thermometerId, "THERM-OLD")
    }

    // ── Location scoping: a different location sees only its own rows ──────

    func testLocationScopingIsolatesOtherLocation() async throws {
        let (repo, path) = try makeRepo(location: "other")
        defer { cleanup(path) }
        let plan = try await repo.buildPlan(today: planDate, generatedAt: generatedAt)
        // 'other' has 1 walk_in_cooler temp_log row and nothing else.
        let walkIn = plan.ccps.first { $0.pointId == "walk_in_cooler" }!
        XCTAssertEqual(walkIn.logs30d, 1)
        XCTAssertEqual(plan.cooling.batches30d, 0)
        XCTAssertEqual(plan.correctiveActions.count, 0)
        XCTAssertTrue(plan.calibrations.probes.isEmpty)
    }
}

// MARK: - Self-contained fixture DB (real lariat.db column shapes)

private func seedHaccpDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-haccp-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    // DatabasePool establishes WAL so a read-only LariatDatabase pool can open it.
    let writer = try DatabasePool(path: path)
    try writer.write { db in
        try db.execute(sql: """
            -- temp_log (HACCP CCP monitoring)
            CREATE TABLE temp_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              point_id TEXT NOT NULL,
              reading_f REAL NOT NULL,
              required_min_f REAL,
              required_max_f REAL,
              corrective_action TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              probe_id TEXT
            );

            -- 3 in-window walk_in_cooler rows (1 corrective), 1 pre-window, 1 other loc
            INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, required_min_f, required_max_f, corrective_action, cook_id, created_at)
            VALUES
              ('2026-07-01', 'default', 'walk_in_cooler', 39.0, NULL, 41.0, NULL,               'alice', '2026-07-01 09:00:00'),
              ('2026-07-02', 'default', 'walk_in_cooler', 40.0, NULL, 41.0, '   ',              'alice', '2026-07-02 09:00:00'),
              ('2026-07-05', 'default', 'walk_in_cooler', 44.0, NULL, 41.0, 'Moved to reach-in','alice', '2026-07-05 09:00:00'),
              ('2026-06-01', 'default', 'walk_in_cooler', 40.0, NULL, 41.0, NULL,               'alice', '2026-06-01 09:00:00'),
              ('2026-07-04', 'other',   'walk_in_cooler', 40.0, NULL, 41.0, NULL,               'zed',   '2026-07-04 09:00:00'),
              ('2026-07-06', 'default', 'hot_hold',       142.0, 140.0, NULL, NULL,             'alice', '2026-07-06 12:00:00');

            -- cooling_log (CCP-8) — real schema
            CREATE TABLE cooling_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              item TEXT NOT NULL,
              station_id TEXT,
              started_at TEXT NOT NULL,
              start_reading_f REAL,
              stage1_at TEXT,
              stage1_reading_f REAL,
              stage2_at TEXT,
              stage2_reading_f REAL,
              status TEXT NOT NULL DEFAULT 'in_progress'
                CHECK(status IN ('in_progress','ok','breach')),
              breach_reason TEXT,
              corrective_action TEXT,
              cook_id TEXT,
              closed_by_cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );

            -- 3 in-window: 1 breach, 1 in_progress, 1 ok; 1 pre-window excluded
            INSERT INTO cooling_log (shift_date, location_id, item, started_at, status)
            VALUES
              ('2026-07-03', 'default', 'Chili',  '2026-07-03T14:00:00Z', 'breach'),
              ('2026-07-04', 'default', 'Stock',  '2026-07-04T14:00:00Z', 'in_progress'),
              ('2026-07-05', 'default', 'Sauce',  '2026-07-05T14:00:00Z', 'ok'),
              ('2026-06-01', 'default', 'OldPot', '2026-06-01T14:00:00Z', 'breach');

            -- receiving_log — real schema (subset of columns)
            CREATE TABLE receiving_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              vendor TEXT NOT NULL,
              category TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('accepted','rejected','accepted_with_note')),
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO receiving_log (shift_date, location_id, vendor, category, status)
            VALUES
              ('2026-07-02', 'default', 'Sysco',  'produce', 'accepted'),
              ('2026-07-10', 'default', 'Shamrock','protein','accepted'),
              ('2026-06-01', 'default', 'Sysco',  'produce', 'accepted');  -- pre-window

            -- date_marks — counted by prepared_on
            CREATE TABLE date_marks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              item TEXT NOT NULL,
              prepared_on TEXT NOT NULL,
              discard_on TEXT NOT NULL,
              discarded_at TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO date_marks (location_id, item, prepared_on, discard_on)
            VALUES
              ('default', 'Stock',  '2026-07-01', '2026-07-08'),
              ('default', 'OldMark','2026-06-01', '2026-06-08');  -- pre-window

            -- tphc_entries
            CREATE TABLE tphc_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              item TEXT NOT NULL,
              started_at TEXT NOT NULL,
              cutoff_at TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO tphc_entries (shift_date, location_id, item, started_at, cutoff_at)
            VALUES ('2026-07-05', 'default', 'Aioli', '2026-07-05T11:00:00Z', '2026-07-05T17:00:00Z');

            -- sanitizer_checks (none seeded → count 0)
            CREATE TABLE sanitizer_checks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              point_label TEXT NOT NULL,
              chemistry TEXT NOT NULL,
              concentration_ppm REAL NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );

            -- cleaning_log
            CREATE TABLE cleaning_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              area TEXT NOT NULL,
              task TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
            VALUES ('2026-07-08', 'default', 'line', 'Sanitize boards', '2026-07-08T22:00:00Z');

            -- sick_worker_reports (none seeded → count 0)
            CREATE TABLE sick_worker_reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              symptoms TEXT NOT NULL,
              action TEXT NOT NULL,
              started_at TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );

            -- pest_control_log
            CREATE TABLE pest_control_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              entry_type TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO pest_control_log (shift_date, location_id, entry_type)
            VALUES ('2026-07-09', 'default', 'trap_check');

            -- sds_registry — count active=1 only
            CREATE TABLE sds_registry (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              product_name TEXT NOT NULL,
              active INTEGER DEFAULT 1,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO sds_registry (location_id, product_name, active)
            VALUES
              ('default', 'Degreaser', 1),
              ('default', 'Sanitizer', 1),
              ('default', 'RetiredChem', 0);

            -- line_check_entries — corrective source #2 (status='fail' w/ note)
            CREATE TABLE line_check_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              item TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('pass','fail','na')),
              note TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default'
            );
            INSERT INTO line_check_entries (shift_date, station_id, item, status, note, cook_id, created_at, location_id)
            VALUES
              ('2026-07-06', 'grill', 'Ribeye', 'fail', 'Refired',           'bob', '2026-07-06 18:30:00', 'default'),
              ('2026-07-06', 'grill', 'Fries',  'pass', 'should-not-appear', 'bob', '2026-07-06 18:35:00', 'default');

            -- thermometer_calibrations — real schema
            CREATE TABLE thermometer_calibrations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              thermometer_id TEXT NOT NULL,
              method TEXT NOT NULL
                CHECK(method IN ('ice_point','boiling_point','reference_probe')),
              before_reading_f REAL,
              after_reading_f REAL,
              passed INTEGER NOT NULL DEFAULT 0,
              action_taken TEXT,
              cook_id TEXT,
              calibrated_at TEXT NOT NULL,
              frequency_days INTEGER,
              created_at TEXT DEFAULT (datetime('now'))
            );
            -- 2 in-window (records) + 1 pre-window (probe board only, overdue)
            INSERT INTO thermometer_calibrations (location_id, thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days)
            VALUES
              ('default', 'THERM-001', 'ice_point',     32.2, 1, '2026-07-01 08:00:00', 30),
              ('default', 'THERM-002', 'boiling_point', 197.9,1, '2026-07-10 08:00:00', 30),
              ('default', 'THERM-OLD', 'ice_point',     32.0, 1, '2026-05-01 08:00:00', 30);
            """)
    }
    // writer deinits, closing the pool; WAL persists in the file.
    return path
}
