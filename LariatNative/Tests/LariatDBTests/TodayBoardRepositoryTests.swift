import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class TodayBoardRepositoryTests: XCTestCase {
    private func todayISO() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date())
    }

    private func testCatalog() -> StationCatalog {
        StationCatalog(
            stations: [
                KitchenStation(id: "grill_saute", name: "Grill / Sauté", line: "hot", lineCheckKey: "grille_saute"),
                KitchenStation(id: "runner", name: "Runner", line: "foh", lineCheckKey: nil),
            ],
            lineCheckTemplates: [
                "grille_saute": ["Cornbread", "Mayo", "Bacon Jam"],
            ],
            recipes: [
                RecipeCatalogEntry(slug: "bisque", name: "Lobster Bisque", subRecipes: []),
            ]
        )
    }

    func testTodayBoardFetches86MovesAndLineChecks() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        try appendTodayBoardFixture(path: path)
        let today = todayISO()
        let repo = TodayBoardRepository(
            database: try LariatDatabase(path: path),
            catalog: testCatalog(),
            locationId: "default"
        )
        let snap = try await repo.load(shiftDate: today)

        XCTAssertEqual(snap.openEightySixItems, ["Lobster Bisque"])
        XCTAssertEqual(snap.activeStations.count, 1)
        XCTAssertEqual(snap.activeStations.first?.station.id, "grill_saute")
        XCTAssertEqual(snap.activeStations.first?.progress?.done, 2)
        XCTAssertEqual(snap.activeStations.first?.progress?.flagged, 1)
        XCTAssertEqual(snap.flaggedCount, 1)
        XCTAssertFalse(snap.recentMoves.isEmpty)
        XCTAssertEqual(snap.recentMoves.first?.item, "Chicken")
    }
}

func appendTodayBoardFixture(path: String) throws {
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE IF NOT EXISTS line_check_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              item TEXT NOT NULL,
              status TEXT NOT NULL,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS station_signoffs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
        try db.execute(sql: "ALTER TABLE inventory_updates ADD COLUMN item TEXT")
        try db.execute(sql: "ALTER TABLE inventory_updates ADD COLUMN delta TEXT")
        try db.execute(sql: "UPDATE inventory_updates SET item = ingredient WHERE item IS NULL")
        try db.execute(sql: "UPDATE inventory_updates SET delta = CAST(qty AS TEXT) || ' ' || unit WHERE delta IS NULL")

        let today = try String.fetchOne(db, sql: "SELECT date('now')")!
        try db.execute(
            sql: """
                INSERT INTO line_check_entries (shift_date, station_id, item, status, location_id)
                VALUES (?, 'grill_saute', 'Cornbread', 'pass', 'default'),
                       (?, 'grill_saute', 'Mayo', 'fail', 'default');
                """,
            arguments: [today, today]
        )
        try db.execute(
            sql: """
                INSERT INTO inventory_updates (location_id, shift_date, item, direction, delta, ingredient, qty, unit)
                VALUES ('default', ?, 'Chicken', 'waste', '1.5 lb', 'Chicken', 1.5, 'lb');
                """,
            arguments: [today]
        )
    }
}
