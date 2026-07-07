import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class BreakRepositoryTests: XCTestCase {
    func testStartAndEndWithAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let started = try repo.start(
            input: BreakStartInput(
                kind: .rest,
                cookId: "alice",
                startedAt: "2026-06-17T14:00:00.000Z"
            ),
            context: context
        )
        let ended = try repo.end(
            id: started.id,
            endedAt: "2026-06-17T14:12:00.000Z",
            context: context
        )
        XCTAssertNotNil(ended.endedAt)
        XCTAssertEqual(ended.durationMin ?? 0, 12, accuracy: 0.1)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='shift_breaks'") ?? 0, 2)
        }
    }

    func testOpenBreak409() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "bob")
        let first = try repo.start(input: BreakStartInput(kind: .rest, cookId: "bob"), context: context)
        XCTAssertThrowsError(
            try repo.start(input: BreakStartInput(kind: .meal, cookId: "bob"), context: context)
        ) { error in
            XCTAssertEqual(error as? BreakWriteError, .openBreakExists(first.id))
        }
    }

    func testEndCrossLocationNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let createCtx = RegulatedWriteContext.nativeCook(cookId: "carol", locationId: "default")
        let row = try repo.start(input: BreakStartInput(kind: .rest, cookId: "carol"), context: createCtx)
        let otherCtx = RegulatedWriteContext.nativeCook(cookId: "carol", locationId: "other-site")
        XCTAssertThrowsError(try repo.end(id: row.id, context: otherCtx)) { error in
            XCTAssertEqual(error as? BreakWriteError, .notFound)
        }
    }

    // C1 parity: web (app/api/breaks/route.js:88-96) runs the open-break 409
    // guard for EVERY start, waived or not — a waived meal cannot be entered
    // while a prior break is still open. Native previously skipped the guard for
    // waived rows; this is the red→green driver for restoring parity.
    func testWaivedMealWhileOpenBreakThrows409() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "dana")
        let open = try repo.start(input: BreakStartInput(kind: .rest, cookId: "dana"), context: context)

        XCTAssertThrowsError(
            try repo.start(
                input: BreakStartInput(kind: .meal, cookId: "dana", waived: true, waiverRef: "signed-waiver-1"),
                context: context
            )
        ) { error in
            XCTAssertEqual(error as? BreakWriteError, .openBreakExists(open.id))
        }
        // The waived meal must NOT have leaked in past the guard.
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM shift_breaks WHERE waived = 1") ?? -1, 0)
        }
    }

    // Coverage the C1 ledger flagged as missing: the waived-meal branch was
    // entirely untested. These lock existing behavior (they pass as-is).
    func testWaivedMealStoredAsSingleCompletedRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "erin")
        let row = try repo.start(
            input: BreakStartInput(
                kind: .meal, cookId: "erin",
                startedAt: "2026-06-17T12:00:00.000Z",
                waived: true, waiverRef: "signed-waiver-2"
            ),
            context: context
        )
        // Recorded as one completed row on entry: ended_at == started_at, 0 min, waived.
        try writeDB.pool.read { db in
            let r = try XCTUnwrap(try Row.fetchOne(
                db, sql: "SELECT started_at, ended_at, duration_min, waived FROM shift_breaks WHERE id = ?",
                arguments: [row.id]))
            let started: String = r["started_at"]
            let ended: String? = r["ended_at"]
            let duration: Double? = r["duration_min"]
            let waivedVal: Int = r["waived"]
            XCTAssertEqual(ended, started)
            XCTAssertEqual(duration ?? -1, 0.0, accuracy: 0.001)
            XCTAssertEqual(waivedVal, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM shift_breaks") ?? -1, 1)
        }
    }

    func testWaivedNonMealBreakThrows400() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "finn")
        // Only meal breaks can be waived under COMPS #39.
        XCTAssertThrowsError(
            try repo.start(input: BreakStartInput(kind: .rest, cookId: "finn", waived: true, waiverRef: "x"),
                           context: context)
        ) { error in
            guard case .validationFailed = (error as? BreakWriteError) else {
                return XCTFail("expected validationFailed, got \(error)")
            }
        }
    }

    func testWaivedMealWithoutWaiverRefThrows400() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "gwen")
        // A waived meal must reference a signed waiver document.
        XCTAssertThrowsError(
            try repo.start(input: BreakStartInput(kind: .meal, cookId: "gwen", waived: true),
                           context: context)
        ) { error in
            guard case .validationFailed = (error as? BreakWriteError) else {
                return XCTFail("expected validationFailed, got \(error)")
            }
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-break-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("lariat.db").path
        let pool = try DatabaseQueue(path: path)
        try pool.write { db in
            try db.execute(sql: """
                CREATE TABLE shift_breaks (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  cook_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  ended_at TEXT,
                  duration_min REAL,
                  waived INTEGER DEFAULT 0,
                  waiver_ref TEXT,
                  note TEXT,
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
