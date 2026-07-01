import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Route-level parity tests for `PestRepository`, mirroring
/// tests/js/test-pest-api.mjs:
///   - POST happy path: pest_control_log row + one audit_events row (in-tx)
///   - POST validation: rejects missing/unknown entry_type, sighting w/o pest,
///     unknown pest, unknown severity (web 400) — no row written
///   - GET: rows scoped by location, newest first
///   - transactional rollback: audit write failure rolls back the source INSERT
///
/// In-memory GRDB fixture over the EXISTING web schema — never the real DB.
final class PestRepositoryTests: XCTestCase {

    // ── POST — happy path ─────────────────────────────────────────────

    func testServiceVisitWritesRowAndAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.log(
            input: PestControlInput(
                entryType: "service_visit",
                vendor: "Acme Pest",
                technician: "Jorge",
                findings: "No activity in any traps. All bait stations refreshed.",
                cookId: "alice"
            ),
            context: RegulatedWriteContext.nativeCook(cookId: "alice")
        )
        XCTAssertEqual(row.entryType, "service_visit")
        XCTAssertEqual(row.vendor, "Acme Pest")

        try writeDB.pool.read { db in
            let logs = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM pest_control_log") ?? 0
            XCTAssertEqual(logs, 1)
            let audits = try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='pest_control_log'") ?? 0
            XCTAssertEqual(audits, 1)

            let action = try String.fetchOne(
                db, sql: "SELECT action FROM audit_events WHERE entity='pest_control_log'")
            XCTAssertEqual(action, "insert")
            let actorCook = try String.fetchOne(
                db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='pest_control_log'")
            XCTAssertEqual(actorCook, "alice")
            let actorSource = try String.fetchOne(
                db, sql: "SELECT actor_source FROM audit_events WHERE entity='pest_control_log'")
            XCTAssertEqual(actorSource, "native_cook", "regulated native writes tag native_cook")
        }
    }

    func testSightingWithPestPersistsPestAndSeverity() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.log(
            input: PestControlInput(
                entryType: "sighting",
                findings: "One adult on dock floor near recycling.",
                pest: "roach",
                severity: "low",
                correctiveAction: "Swept, traps reset, vendor notified."
            ),
            context: RegulatedWriteContext.nativeCook(cookId: "bob")
        )
        XCTAssertEqual(row.entryType, "sighting")
        XCTAssertEqual(row.pest, "roach")
        XCTAssertEqual(row.severity, "low")
        XCTAssertEqual(row.correctiveAction, "Swept, traps reset, vendor notified.")
    }

    // ── POST — validation (web 400) ───────────────────────────────────

    func testMissingEntryTypeRejectedNoRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        assertValidationFailure {
            try repo.log(
                input: PestControlInput(findings: "something"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        }
        try assertNoRows(writeDB)
    }

    func testUnknownEntryTypeRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        assertValidationFailure {
            try repo.log(
                input: PestControlInput(entryType: "tornado"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        }
        try assertNoRows(writeDB)
    }

    func testSightingWithoutPestRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.log(
                input: PestControlInput(entryType: "sighting"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        ) { error in
            guard case .validationFailed(let msg) = error as? PestWriteError else {
                return XCTFail("expected validationFailed")
            }
            XCTAssertTrue(msg.contains("pest must be specified"))
        }
        try assertNoRows(writeDB)
    }

    func testUnknownPestRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        assertValidationFailure {
            try repo.log(
                input: PestControlInput(entryType: "sighting", pest: "dragon"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        }
        try assertNoRows(writeDB)
    }

    func testUnknownSeverityRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        assertValidationFailure {
            try repo.log(
                input: PestControlInput(entryType: "sighting", pest: "roach", severity: "apocalyptic"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        }
        try assertNoRows(writeDB)
    }

    // ── GET — board snapshot ──────────────────────────────────────────

    func testLoadReturnsLocationScopedRows() throws {
        // Parity with tests/js/test-pest-api.mjs GET: rows scoped by location.
        // The web SQL orders by `created_at DESC` (which the repo mirrors), but
        // created_at is whole-second resolution, so same-second inserts tie —
        // the web test asserts only count + location scoping, not intra-second
        // ordering. We match that contract here.
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "alice", locationId: "loc-1")

        _ = try repo.log(
            input: PestControlInput(entryType: "service_visit", vendor: "Acme", technician: "Jorge"),
            context: ctx)
        _ = try repo.log(
            input: PestControlInput(entryType: "trap_check", findings: "all clear"),
            context: ctx)
        // A row at a different location must not appear.
        _ = try repo.log(
            input: PestControlInput(entryType: "trap_check", findings: "other site"),
            context: RegulatedWriteContext.nativeCook(cookId: "zed", locationId: "loc-2"))

        let snap = try awaitLoad(repo, locationId: "loc-1")
        XCTAssertEqual(snap.locationId, "loc-1")
        XCTAssertEqual(snap.rows.count, 2, "only loc-1 rows are returned")
        XCTAssertTrue(snap.rows.allSatisfy { $0.locationId == "loc-1" })
        XCTAssertEqual(
            Set(snap.rows.map(\.entryType)), Set(["service_visit", "trap_check"]))
    }

    func testLoadOrdersNewestFirstAcrossSeconds() throws {
        // Explicit ordering pin: with distinct created_at values the newest row
        // is returned first — proves the repo's `ORDER BY created_at DESC`.
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "alice", locationId: "loc-1")

        _ = try repo.log(
            input: PestControlInput(entryType: "service_visit", vendor: "Acme"), context: ctx)
        _ = try repo.log(
            input: PestControlInput(entryType: "trap_check", findings: "later"), context: ctx)

        // Force distinct timestamps (real DB uses datetime('now') per insert).
        try writeDB.pool.write { db in
            try db.execute(sql: """
                UPDATE pest_control_log SET created_at='2026-01-01 09:00:00'
                 WHERE entry_type='service_visit';
                UPDATE pest_control_log SET created_at='2026-01-01 10:00:00'
                 WHERE entry_type='trap_check';
                """)
        }

        let snap = try awaitLoad(repo, locationId: "loc-1")
        XCTAssertEqual(snap.rows.first?.entryType, "trap_check", "newest created_at first")
        XCTAssertEqual(snap.rows.last?.entryType, "service_visit")
    }

    // ── POST — transactional rollback ─────────────────────────────────
    //
    // The audit write runs in the SAME transaction as the source INSERT. If the
    // audit insert throws, the pest_control_log row MUST roll back — no stranded
    // rows without an audit trail. We drop audit_events out of the way so the
    // audit insert fails.

    func testAuditFailureRollsBackSourceInsert() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)

        try writeDB.pool.write { db in
            try db.execute(sql: "ALTER TABLE audit_events RENAME TO audit_events_stash")
        }

        XCTAssertThrowsError(
            try repo.log(
                input: PestControlInput(
                    entryType: "service_visit", vendor: "Acme Pest",
                    technician: "Jorge", findings: "No activity.", cookId: "alice"),
                context: RegulatedWriteContext.nativeCook(cookId: "alice"))
        )

        try writeDB.pool.write { db in
            try db.execute(sql: "ALTER TABLE audit_events_stash RENAME TO audit_events")
        }
        try assertNoRows(writeDB)
    }

    // ── Fixtures / helpers ────────────────────────────────────────────

    private func awaitLoad(_ repo: PestRepository, locationId: String) throws -> PestBoardSnapshot {
        let exp = expectation(description: "load")
        var result: Result<PestBoardSnapshot, Error>!
        Task {
            do { result = .success(try await repo.load(locationId: locationId)) }
            catch { result = .failure(error) }
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
        return try result.get()
    }

    private func assertValidationFailure(
        _ block: () throws -> PestRow, file: StaticString = #filePath, line: UInt = #line
    ) {
        XCTAssertThrowsError(try block(), file: file, line: line) { error in
            guard case .validationFailed = error as? PestWriteError else {
                return XCTFail("expected PestWriteError.validationFailed, got \(error)", file: file, line: line)
            }
        }
    }

    private func assertNoRows(_ writeDB: LariatWriteDatabase) throws {
        try writeDB.pool.read { db in
            let logs = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM pest_control_log") ?? -1
            XCTAssertEqual(logs, 0, "no pest_control_log row should be written on rejection")
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-pest-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("lariat.db").path
        let queue = try DatabaseQueue(path: path)
        try queue.write { db in
            // EXACT columns/CHECKs from lib/db.ts pest_control_log (no migration).
            try db.execute(sql: """
                CREATE TABLE pest_control_log (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  entry_type TEXT NOT NULL
                    CHECK(entry_type IN ('service_visit','sighting','trap_check')),
                  vendor TEXT,
                  technician TEXT,
                  findings TEXT,
                  pest TEXT,
                  severity TEXT CHECK(severity IS NULL OR severity IN ('low','medium','high')),
                  corrective_action TEXT,
                  report_path TEXT,
                  cook_id TEXT,
                  created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT,
                  location_id TEXT DEFAULT 'default',
                  actor_cook_id TEXT,
                  actor_source TEXT NOT NULL,
                  entity TEXT NOT NULL,
                  entity_id INTEGER,
                  action TEXT NOT NULL,
                  replaces_id INTEGER,
                  payload_json TEXT,
                  note TEXT,
                  created_at TEXT DEFAULT (datetime('now'))
                );
                """)
        }
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}
