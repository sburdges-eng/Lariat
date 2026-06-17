import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class EightySixRepositoryTests: XCTestCase {

    func testAddAndResolveWithAudit() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")

        let id = try repo.add(
            input: EightySixAddInput(
                item: "salmon",
                stationId: nil,
                reason: "out",
                quantity: nil,
                cookId: "alice",
                shiftDate: ShiftDate.todayISO()
            ),
            context: context
        )

        let resolved = try repo.resolve(id: id, context: context)
        XCTAssertNotNil(resolved.resolvedAt)
        XCTAssertEqual(resolved.resolvedBy, "alice")

        try writeDB.pool.read { db in
            let inserts = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='eighty_six' AND action='insert'"
            )
            let updates = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='eighty_six' AND action='update'"
            )
            XCTAssertEqual(inserts, 1)
            XCTAssertEqual(updates, 1)
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE actor_source='native_cook'"),
                2
            )
        }
    }

    func testResolveCrossLocationReturnsNotFound() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let id = try repo.add(
            input: EightySixAddInput(
                item: "mahi",
                stationId: nil,
                reason: "out",
                quantity: nil,
                cookId: nil,
                shiftDate: ShiftDate.todayISO()
            ),
            context: RegulatedWriteContext.nativeCook(cookId: nil, locationId: "default")
        )

        XCTAssertThrowsError(
            try repo.resolve(
                id: id,
                context: RegulatedWriteContext.nativeCook(cookId: nil, locationId: "other-site")
            )
        ) { error in
            XCTAssertEqual(error as? EightySixWriteError, .notFound)
        }
    }

    func testDoubleResolve409() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: "bob")
        let id = try repo.add(
            input: EightySixAddInput(
                item: "tuna",
                stationId: nil,
                reason: "out",
                quantity: nil,
                cookId: "bob",
                shiftDate: ShiftDate.todayISO()
            ),
            context: context
        )
        _ = try repo.resolve(id: id, context: context)
        XCTAssertThrowsError(try repo.resolve(id: id, context: context)) { error in
            XCTAssertEqual(error as? EightySixWriteError, .alreadyResolved)
        }

        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='eighty_six' AND action='update'"
            )
            XCTAssertEqual(updates, 1)
        }
    }

    func testEmptyItemRejected() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        XCTAssertThrowsError(
            try repo.add(
                input: EightySixAddInput(
                    item: "   ",
                    stationId: nil,
                    reason: nil,
                    quantity: nil,
                    cookId: nil,
                    shiftDate: ShiftDate.todayISO()
                ),
                context: RegulatedWriteContext.nativeCook(cookId: nil)
            )
        ) { error in
            XCTAssertEqual(error as? EightySixWriteError, .itemRequired)
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, StationCatalog, String) {
        let path = try seedEightySixDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let catalog = StationCatalog(stations: [], lineCheckTemplates: [:], recipes: [])
        return (readDB, writeDB, catalog, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedEightySixDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-e86-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE eighty_six (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT,
              item TEXT NOT NULL,
              kind TEXT DEFAULT 'item',
              reason TEXT,
              quantity TEXT,
              cook_id TEXT,
              resolved_at TEXT,
              resolved_by TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default'
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
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
    return path
}
