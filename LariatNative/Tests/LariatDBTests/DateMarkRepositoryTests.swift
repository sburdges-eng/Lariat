import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class DateMarkRepositoryTests: XCTestCase {
    func testCreateComputesDiscardOnAndAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let row = try repo.create(
            input: DateMarkCreateInput(item: "Hollandaise", preparedOn: "2026-04-20", cookId: "alice"),
            context: context
        )
        XCTAssertEqual(row.discardOn, "2026-04-26")

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='date_marks'") ?? 0, 1)
        }
    }

    func testDoubleDiscard409() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let row = try repo.create(
            input: DateMarkCreateInput(item: "Stock", preparedOn: "2026-04-20"),
            context: context
        )
        _ = try repo.discard(id: row.id, reason: .expired, context: context)
        XCTAssertThrowsError(try repo.discard(id: row.id, reason: .quality, context: context)) { error in
            XCTAssertEqual(error as? DateMarkWriteError, .alreadyDiscarded)
        }
    }

    func testDiscardCrossLocationNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        let createCtx = RegulatedWriteContext.nativeCook(cookId: "alice", locationId: "default")
        let row = try repo.create(
            input: DateMarkCreateInput(item: "Stock", preparedOn: "2026-04-20"),
            context: createCtx
        )
        let otherCtx = RegulatedWriteContext.nativeCook(cookId: "alice", locationId: "other-site")
        XCTAssertThrowsError(try repo.discard(id: row.id, reason: .expired, context: otherCtx)) { error in
            XCTAssertEqual(error as? DateMarkWriteError, .notFound)
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedDateMarkDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedDateMarkDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-date-mark-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE date_marks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              item TEXT NOT NULL,
              batch_ref TEXT,
              prepared_on TEXT NOT NULL,
              discard_on TEXT NOT NULL,
              discarded_at TEXT,
              discarded_by_cook_id TEXT,
              discard_reason TEXT,
              cook_id TEXT,
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
