import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of app/api/sick-worker/route.js against an in-memory
// (on-disk temp) GRDB fixture seeded with the real sick_worker_reports +
// audit_events schema. Exercises POST file (insert + one audit, FDA-floor
// validation → 400, actor_source native_cook), PATCH clear (update + audit,
// 409 already-cleared, 404 unknown, cross-location IDOR → 404), and the GET
// board snapshot (active = open, history = cleared).

final class SickWorkerRepositoryTests: XCTestCase {
    private let tStart = "2026-04-20T10:00:00.000Z"

    // ── POST file — happy path (insert + one audit) ────────────────────

    func testFileRecordsReportAndEmitsOneAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.file(
            input: SickReportFileInput(
                cookId: "alice",
                reportedByPicId: "pic-bob",
                symptoms: ["vomiting"],
                action: "excluded",
                startedAt: tStart
            ),
            context: .nativeCook(cookId: "pic-bob")
        )
        XCTAssertEqual(row.cookId, "alice")
        XCTAssertEqual(row.action, "excluded")
        XCTAssertEqual(row.symptoms, "vomiting")
        XCTAssertNil(row.returnAt)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sick_worker_reports") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_worker_reports'") ?? 0, 1)
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='sick_worker_reports' LIMIT 1")
            XCTAssertEqual(action, "insert")
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='sick_worker_reports' LIMIT 1")
            XCTAssertEqual(source, "native_cook")
            let actor = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='sick_worker_reports' LIMIT 1")
            XCTAssertEqual(actor, "pic-bob")
        }
    }

    /// Web POST derives the FDA minimum when `action` is omitted (board passes
    /// the suggested action; the route falls back to it). Diarrhea → excluded.
    func testFileUsesFDAMinimumWhenActionOmitted() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.file(
            input: SickReportFileInput(cookId: "carol", symptoms: ["diarrhea"], action: nil, startedAt: tStart),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.action, "excluded")
    }

    func testFileDiagnosisOnlyReport() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.file(
            input: SickReportFileInput(cookId: "dan", symptoms: [], diagnosedIllness: "norovirus", action: "excluded", startedAt: tStart),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.diagnosedIllness, "norovirus")
        XCTAssertEqual(row.symptoms, "")
    }

    // ── POST validation → 400 (validationFailed), writes nothing ───────

    func testFileRejectsLoweringBelowFDAFloor() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.file(
                input: SickReportFileInput(cookId: "eve", symptoms: ["vomiting"], action: "restricted", startedAt: tStart),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            guard let e = error as? SickWorkerWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sick_worker_reports") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testFileRejectsMissingCookIdWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.file(input: SickReportFileInput(cookId: "  ", symptoms: ["vomiting"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertTrue((error as? SickWorkerWriteError).map { if case .validationFailed = $0 { return true } else { return false } } ?? false)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sick_worker_reports") ?? 0, 0)
        }
    }

    func testFileRejectsEmptyReport() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.file(input: SickReportFileInput(cookId: "eve", symptoms: [], diagnosedIllness: nil, action: "none", startedAt: tStart), context: .nativeCook(cookId: nil))
        )
    }

    func testFileRejectsUnknownSymptom() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.file(input: SickReportFileInput(cookId: "eve", symptoms: ["headache"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil))
        )
    }

    // ── PATCH clear — happy path (update + audit) ──────────────────────

    func testClearRecordsReturnAndEmitsUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.file(
            input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart),
            context: .nativeCook(cookId: nil)
        ).id

        let cleared = try repo.clear(
            input: SickReportClearInput(id: id, clearanceSource: "medical_clearance", reportedByPicId: "pic-bob"),
            context: .nativeCook(cookId: "pic-bob")
        )
        XCTAssertEqual(cleared.clearanceSource, "medical_clearance")
        XCTAssertNotNil(cleared.returnAt)

        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_worker_reports' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='sick_worker_reports' AND action='update' LIMIT 1")
            XCTAssertEqual(note, "cleared: medical_clearance")
        }
    }

    // ── PATCH clear — 409 already cleared ──────────────────────────────

    func testClearAlreadyClearedThrows409NoSecondAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.file(
            input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart),
            context: .nativeCook(cookId: nil)
        ).id
        _ = try repo.clear(input: SickReportClearInput(id: id, clearanceSource: "asymptomatic_24h"), context: .nativeCook(cookId: nil))

        XCTAssertThrowsError(
            try repo.clear(input: SickReportClearInput(id: id, clearanceSource: "health_dept"), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertEqual(error as? SickWorkerWriteError, .alreadyCleared)
        }
        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_worker_reports' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)   // only the first clear
            // first clearance stands
            let src = try String.fetchOne(db, sql: "SELECT clearance_source FROM sick_worker_reports WHERE id=?", arguments: [id])
            XCTAssertEqual(src, "asymptomatic_24h")
        }
    }

    // ── PATCH clear — 400 missing clearance_source ─────────────────────

    func testClearRejectsMissingClearanceSource() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.file(
            input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart),
            context: .nativeCook(cookId: nil)
        ).id
        XCTAssertThrowsError(
            try repo.clear(input: SickReportClearInput(id: id, clearanceSource: "   "), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertTrue((error as? SickWorkerWriteError).map { if case .validationFailed = $0 { return true } else { return false } } ?? false)
        }
    }

    // ── PATCH clear — 404 unknown id ───────────────────────────────────

    func testClearUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.clear(input: SickReportClearInput(id: 9999, clearanceSource: "health_dept"), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertEqual(error as? SickWorkerWriteError, .notFound)
        }
    }

    // ── PATCH clear — cross-location IDOR guard → notFound, no mutation ─

    func testCrossLocationClearRejectedAsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.file(
            input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart),
            context: .nativeCook(cookId: nil, locationId: "site-b")
        ).id

        XCTAssertThrowsError(
            try repo.clear(input: SickReportClearInput(id: id, clearanceSource: "health_dept"), context: .nativeCook(cookId: nil, locationId: "site-a"))
        ) { error in
            XCTAssertEqual(error as? SickWorkerWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            let ret = try String.fetchOne(db, sql: "SELECT return_at FROM sick_worker_reports WHERE id=?", arguments: [id])
            XCTAssertNil(ret)
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_worker_reports' AND action='update'") ?? 0
            XCTAssertEqual(updates, 0)
        }
    }

    // ── GET load — active vs history split ─────────────────────────────

    func testLoadListsActiveOpenExclusions() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.file(input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil))
        _ = try repo.file(input: SickReportFileInput(cookId: "bob", symptoms: ["sore_throat_with_fever"], action: "restricted", startedAt: tStart), context: .nativeCook(cookId: nil))

        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.active.count, 2)
        XCTAssertTrue(snap.history.isEmpty)
    }

    func testLoadHistoryHoldsClearedReports() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.file(input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil)).id
        _ = try repo.clear(input: SickReportClearInput(id: id, clearanceSource: "asymptomatic_24h"), context: .nativeCook(cookId: nil))

        let snap = try await repo.load(locationId: "default", includeHistory: true)
        XCTAssertTrue(snap.active.isEmpty)
        XCTAssertEqual(snap.history.count, 1)
        XCTAssertEqual(snap.history.first?.clearanceSource, "asymptomatic_24h")
    }

    func testLoadScopesByLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.file(input: SickReportFileInput(cookId: "alice", symptoms: ["vomiting"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil, locationId: "site-a"))
        _ = try repo.file(input: SickReportFileInput(cookId: "bob", symptoms: ["vomiting"], action: "excluded", startedAt: tStart), context: .nativeCook(cookId: nil, locationId: "site-b"))

        let snapA = try await repo.load(locationId: "site-a")
        XCTAssertEqual(snapA.active.count, 1)
        XCTAssertEqual(snapA.active.first?.cookId, "alice")
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedSickWorkerDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedSickWorkerDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-sickworker-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE sick_worker_reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              reported_by_pic_id TEXT,
              symptoms TEXT NOT NULL,
              diagnosed_illness TEXT,
              action TEXT NOT NULL
                CHECK(action IN ('excluded','restricted','monitor','none')),
              started_at TEXT NOT NULL,
              return_at TEXT,
              clearance_source TEXT,
              note TEXT,
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
