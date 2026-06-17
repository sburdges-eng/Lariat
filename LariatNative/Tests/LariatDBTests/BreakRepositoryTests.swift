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
