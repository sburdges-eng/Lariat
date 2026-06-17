import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class LineCheckRepositoryTests: XCTestCase {

    private func testCatalog() -> StationCatalog {
        StationCatalog(
            stations: [
                KitchenStation(id: "grill_saute", name: "Grill / Sauté", line: "hot", lineCheckKey: "grille_saute"),
            ],
            lineCheckTemplates: [
                "grille_saute": ["Cornbread", "Mayo"],
            ],
            recipes: []
        )
    }

    func testPostEntryAndSignoffWithAudit() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Cornbread",
                status: .pass,
                cookId: "alice"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Mayo",
                status: .fail,
                cookId: "alice",
                note: "Remade batch"
            ),
            context: context
        )

        let checklist = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertEqual(checklist.items["Cornbread"]?.status, .pass)
        XCTAssertEqual(checklist.items["Mayo"]?.status, .fail)
        XCTAssertEqual(checklist.items["Mayo"]?.note, "Remade batch")

        _ = try repo.signoff(stationId: "grill_saute", context: context)
        let after = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertNotNil(after.signoff)

        try await writeDB.pool.read { db in
            let inserts = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='line_check_entries' AND action='insert'"
            )
            let signoffs = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='station_signoffs' AND action='insert'"
            )
            XCTAssertEqual(inserts, 2)
            XCTAssertEqual(signoffs, 1)
        }
    }

    func testSignoffBlocksUnnotedFails() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "bob")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Cornbread",
                status: .pass,
                cookId: "bob"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Mayo",
                status: .fail,
                cookId: "bob"
            ),
            context: context
        )

        XCTAssertThrowsError(try repo.signoff(stationId: "grill_saute", context: context)) { error in
            XCTAssertEqual(error as? LineCheckWriteError, .unnotedFails(items: ["Mayo"]))
        }
    }

    func testLatestRowWins() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "carol")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today, stationId: "grill_saute", item: "Mayo",
                status: .fail, cookId: "carol"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today, stationId: "grill_saute", item: "Mayo",
                status: .pass, cookId: "carol"
            ),
            context: context
        )

        let checklist = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertEqual(checklist.items["Mayo"]?.status, .pass)
        XCTAssertEqual(checklist.progress?.flagged, 0)
    }

    func testLoadStationList() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let rows = try await repo.loadStationList()
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.station.id, "grill_saute")
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, StationCatalog, String) {
        let path = try seedLineCheckDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, testCatalog(), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedLineCheckDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-linecheck-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE line_check_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              item TEXT NOT NULL,
              status TEXT NOT NULL,
              par TEXT,
              have TEXT,
              need TEXT,
              note TEXT,
              cook_id TEXT,
              glove_change_attested INTEGER,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE station_signoffs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              signoff_type TEXT NOT NULL DEFAULT 'self',
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
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
