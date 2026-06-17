import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class CleaningRepositoryTests: XCTestCase {
    func testPostTickWritesAuditEvent() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = CleaningRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")
        let row = try repo.postTick(
            input: CleaningTickInput(task: "Sanitize prep table", area: "Line", cookId: "alice"),
            context: context
        )
        XCTAssertEqual(row.task, "Sanitize prep table")
        XCTAssertEqual(row.area, "Line")

        try writeDB.pool.read { db in
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='cleaning_log'") ?? 0
            XCTAssertEqual(count, 1)
        }
    }

    func testMissingTaskRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = CleaningRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.postTick(
                input: CleaningTickInput(task: "  ", item: nil),
                context: RegulatedWriteContext.nativeCook(cookId: "alice")
            )
        ) { error in
            if case .validationFailed = error as? CleaningWriteError { } else {
                XCTFail("expected validation failure")
            }
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-clean-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("lariat.db").path
        let pool = try DatabaseQueue(path: path)
        try pool.write { db in
            try db.execute(sql: """
                CREATE TABLE cleaning_log (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  schedule_id INTEGER,
                  area TEXT NOT NULL,
                  task TEXT NOT NULL,
                  completed_at TEXT NOT NULL,
                  cook_id TEXT,
                  verified_by_cook_id TEXT,
                  notes TEXT,
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
