import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-cooling-api.mjs against an in-memory
// (on-disk temp) GRDB fixture seeded with the real cooling_log + audit_events
// schema. Exercises POST (open + audit), PATCH 422 needs_corrective_action,
// PATCH breach-with-note (status + audit update), stage2 closure, and the
// cross-location IDOR guard (404 / notFound).

final class CoolingRepositoryTests: XCTestCase {
    private let tStart = "2026-04-20T10:00:00.000Z"
    private let tStage1OK = "2026-04-20T11:30:00.000Z"     // +90m, ≤ 70°F
    private let tStage1Late = "2026-04-20T12:30:00.000Z"   // +150m → over 2h
    private let tStage2OK = "2026-04-20T14:30:00.000Z"     // +180m after stage1, ≤ 41°F

    // ── POST happy path ────────────────────────────────────────────────

    func testStartOpensBatchAndEmitsOneAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.start(
            input: CoolingStartInput(item: "pulled pork", startedAt: tStart, startReadingF: 165, cookId: "alice"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(row.item, "pulled pork")
        XCTAssertEqual(row.status, "in_progress")

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM cooling_log") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cooling_log'") ?? 0, 1)
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='cooling_log' LIMIT 1")
            XCTAssertEqual(action, "insert")
            let actor = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='cooling_log' LIMIT 1")
            XCTAssertEqual(actor, "alice")
        }
    }

    // ── POST validation ────────────────────────────────────────────────

    func testStartRejectsMissingItemWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.start(input: CoolingStartInput(item: "", startedAt: tStart), context: .nativeCook(cookId: nil))
        ) { error in
            guard let e = error as? CoolingWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM cooling_log") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testStartRejectsNonISOStartedAt() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.start(input: CoolingStartInput(item: "soup", startedAt: "yesterday"), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertTrue((error as? CoolingWriteError).map { if case .validationFailed = $0 { return true } else { return false } } ?? false)
        }
    }

    // ── PATCH 422 needs_corrective_action ──────────────────────────────

    func testStage1Over2hWithoutNoteThrowsNeedsCorrectiveActionNoUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: CoolingStartInput(item: "pulled pork", startedAt: tStart), context: .nativeCook(cookId: nil)).id

        XCTAssertThrowsError(
            try repo.logStage(input: CoolingStageInput(id: id, readingF: 65, at: tStage1Late), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertTrue((error as? CoolingWriteError)?.needsCorrectiveAction == true)
        }
        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cooling_log' AND action='update'") ?? 0
            XCTAssertEqual(updates, 0)
            let status = try String.fetchOne(db, sql: "SELECT status FROM cooling_log WHERE id=?", arguments: [id])
            XCTAssertEqual(status, "in_progress")
        }
    }

    func testStage1Over2hWithNoteRecordsBreachAndUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: CoolingStartInput(item: "pulled pork", startedAt: tStart), context: .nativeCook(cookId: nil)).id

        let result = try repo.logStage(
            input: CoolingStageInput(id: id, readingF: 65, at: tStage1Late, correctiveAction: "split into shallower pans, re-iced"),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(result.row.status, "breach")
        XCTAssertEqual(result.row.breachReason, "stage1_over_2h")
        XCTAssertEqual(result.decision, .decided(stage: 1, status: .breach, breachReason: .stage1Over2h, minutesElapsed: 150))

        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cooling_log' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='cooling_log' AND action='update' LIMIT 1")
            XCTAssertEqual(note, "breach: stage1_over_2h")
        }
    }

    // ── PATCH happy stage1 → in_progress, then stage2 → ok closure ──────

    func testStage1ThenStage2ClosesOkWithClosedByCook() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: CoolingStartInput(item: "pulled pork", startedAt: tStart, cookId: "alice"), context: .nativeCook(cookId: "alice")).id

        let s1 = try repo.logStage(input: CoolingStageInput(id: id, readingF: 65, at: tStage1OK, cookId: "alice"), context: .nativeCook(cookId: "alice"))
        XCTAssertEqual(s1.row.status, "in_progress")
        XCTAssertEqual(s1.row.stage1At, tStage1OK)
        XCTAssertEqual(s1.row.stage1ReadingF, 65)

        let s2 = try repo.logStage(input: CoolingStageInput(id: id, readingF: 39, at: tStage2OK, cookId: "bob"), context: .nativeCook(cookId: "bob"))
        XCTAssertEqual(s2.row.status, "ok")
        XCTAssertEqual(s2.row.stage2At, tStage2OK)
        XCTAssertEqual(s2.row.stage2ReadingF, 39)
        XCTAssertEqual(s2.row.closedByCookId, "bob")

        try writeDB.pool.read { db in
            // insert + 2 updates
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cooling_log'") ?? 0, 3)
        }
    }

    // ── PATCH unknown id → notFound ────────────────────────────────────

    func testLogStageUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.logStage(input: CoolingStageInput(id: 9999, readingF: 65, at: tStage1OK), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertEqual(error as? CoolingWriteError, .notFound)
        }
    }

    // ── PATCH cross-location IDOR guard → notFound, no mutation ─────────

    func testCrossLocationPatchRejectedAsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)

        // Open a batch at site-b.
        let id = try repo.start(
            input: CoolingStartInput(item: "site-b stew", startedAt: tStart),
            context: .nativeCook(cookId: nil, locationId: "site-b")
        ).id

        // site-a cook tries to patch the site-b batch.
        XCTAssertThrowsError(
            try repo.logStage(
                input: CoolingStageInput(id: id, readingF: 65, at: tStage1OK, correctiveAction: "malicious"),
                context: .nativeCook(cookId: nil, locationId: "site-a")
            )
        ) { error in
            XCTAssertEqual(error as? CoolingWriteError, .notFound)
        }

        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT status FROM cooling_log WHERE id=?", arguments: [id])
            XCTAssertEqual(status, "in_progress")
            let stage1 = try String.fetchOne(db, sql: "SELECT stage1_at FROM cooling_log WHERE id=?", arguments: [id])
            XCTAssertNil(stage1)
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cooling_log' AND action='update'") ?? 0
            XCTAssertEqual(updates, 0)
        }
    }

    func testCrossLocationMatchAllowsPatch() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(
            input: CoolingStartInput(item: "site-b stew", startedAt: tStart),
            context: .nativeCook(cookId: nil, locationId: "site-b")
        ).id
        let result = try repo.logStage(
            input: CoolingStageInput(id: id, readingF: 65, at: tStage1OK),
            context: .nativeCook(cookId: nil, locationId: "site-b")
        )
        XCTAssertEqual(result.row.status, "in_progress")
    }

    // ── load() board snapshot ──────────────────────────────────────────

    func testLoadListsOpenExcludesClosedByDefault() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.start(input: CoolingStartInput(item: "soup", startedAt: tStart), context: .nativeCook(cookId: nil))

        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.open.count, 1)
        XCTAssertEqual(snap.open.first?.item, "soup")
        XCTAssertTrue(snap.closed.isEmpty)
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedCoolingDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedCoolingDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-cooling-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
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
