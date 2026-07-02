import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity tests for the read-only /bar surface against an on-disk
/// temp GRDB fixture seeded with the REAL `recipe_costs` + `inventory_par` +
/// `inventory_count_lines` schemas (lib/db.ts ~L1329 / ~L1064 / ~L1087).
///
/// No web test file exists for /bar — cases are authored against
/// `app/bar/page.jsx` (cost query L129-135) and `app/bar/par/page.jsx`
/// (join + category scope L57-84, low filter L86-93). Both pages are
/// server-rendered reads: NO writes, NO audit events, NO PIN.
final class BarRepositoryTests: XCTestCase {

    // ── /bar: recipe_costs pull (page.jsx L129-135) ─────────────────────

    func testCostRowsAreLocationScoped() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO recipe_costs (recipe_id, cost_per_yield_unit, batch_cost, yield, yield_unit, location_id)
                VALUES ('cocktail_marg', 2.0, 3.0, 1.5, 'oz', 'default'),
                       ('cocktail_marg', 9.0, 9.0, 1.5, 'oz', 'south'),
                       ('cocktail_paloma', 1.5, 1.5, 1.0, 'each', 'default')
                """)
        }
        let rows = try await repo.loadCostRows(locationId: "default")
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(
            rows.first { $0.recipeId == "cocktail_marg" }?.costPerYieldUnit, 2.0,
            "must read the default-location row, not south's"
        )

        let south = try await repo.loadCostRows(locationId: "south")
        XCTAssertEqual(south.map(\.costPerYieldUnit), [9.0])
    }

    func testCostRowsFeedPourCostCompute() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO recipe_costs (recipe_id, cost_per_yield_unit, batch_cost, yield, yield_unit, location_id)
                VALUES ('cocktail_marg', 2.0, 3.0, 1.5, 'oz', 'default')
                """)
        }
        let recipes = [BarRecipe(
            slug: "cocktail_marg", name: "Margarita", category: "cocktail",
            yieldQty: 1.5, yieldUnit: "oz",
            menuItems: [BarMenuItemRef(name: "Marg", price: 15, sizeOz: nil)]
        )]
        let rows = BarCompute.buildRows(
            recipes: recipes,
            costRows: try await repo.loadCostRows(locationId: "default")
        )
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].costPerPour, 3.0)           // 2.0 × 1.5 oz
        XCTAssertEqual(rows[0].pourCostPct, 20.0)          // 3 / 15 × 100
        XCTAssertEqual(rows[0].tone, .yellow)
    }

    // ── /bar/par: category-scoped par join (bar/par/page.jsx L57-84) ────

    func testBarParFiltersToBeverageCategoriesCaseInsensitive() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO inventory_par (ingredient, sku, par_qty, par_unit, category, location_id) VALUES
                  ('TEQUILA BLANCO', 'TEQ', 6, 'btl', 'Liquor', 'default'),
                  ('IPA KEG', '', 2, 'keg', 'BEER', 'default'),
                  ('LIME JUICE', '', 4, 'qt', 'cocktail', 'default'),
                  ('FLOUR', '', 50, 'lb', 'Dry Goods', 'default'),
                  ('MYSTERY', '', 1, 'ea', NULL, 'default')
                """)
        }
        let rows = try await repo.loadParRows(locationId: "default")
        // category IS NOT NULL AND lower(category) IN (bar list) — FLOUR and
        // the NULL-category row are excluded.
        XCTAssertEqual(rows.map(\.ingredient).sorted(), ["IPA KEG", "LIME JUICE", "TEQUILA BLANCO"])
        // ORDER BY p.category, p.ingredient.
        XCTAssertEqual(rows.map(\.ingredient), ["IPA KEG", "TEQUILA BLANCO", "LIME JUICE"])
    }

    func testBarParJoinsLatestCountAndFlagsLow() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO inventory_par (ingredient, sku, par_qty, par_unit, category, location_id) VALUES
                  ('TEQUILA BLANCO', 'TEQ', 6, 'btl', 'liquor', 'default'),
                  ('MEZCAL', '', 3, 'btl', 'liquor', 'default');
                INSERT INTO inventory_counts (id, count_date, location_id) VALUES
                  (1, '2026-06-30', 'default'), (2, '2026-07-01', 'default');
                -- TEQUILA counted in two sessions: the later line (4 btl) must win
                INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, unit, counted_by, counted_at, location_id) VALUES
                  (1, 'TEQUILA BLANCO', 'TEQ', 9, 'btl', 'alice', '2026-06-30 09:00:00', 'default'),
                  (2, 'TEQUILA BLANCO', 'TEQ', 4, 'btl', 'bob',   '2026-07-01 09:00:00', 'default')
                """)
        }
        let rows = try await repo.loadParRows(locationId: "default")
        let teq = rows.first { $0.ingredient == "TEQUILA BLANCO" }
        XCTAssertEqual(teq?.onHandQty, 4)                  // latest count line
        XCTAssertEqual(teq?.countedBy, "bob")
        XCTAssertEqual(teq?.isLow, true)                   // 4 < 6
        let mezcal = rows.first { $0.ingredient == "MEZCAL" }
        XCTAssertNil(mezcal?.onHandQty)                    // never counted
        XCTAssertEqual(mezcal?.isLow, false)               // never counted ≠ low
    }

    func testBarParLocationScoped() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO inventory_par (ingredient, sku, par_qty, category, location_id) VALUES
                  ('GIN', '', 4, 'liquor', 'default'),
                  ('RUM', '', 4, 'liquor', 'south')
                """)
        }
        let defaultRows = try await repo.loadParRows(locationId: "default")
        XCTAssertEqual(defaultRows.map(\.ingredient), ["GIN"])
        let southRows = try await repo.loadParRows(locationId: "south")
        XCTAssertEqual(southRows.map(\.ingredient), ["RUM"])
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepo() throws -> (BarRepository, LariatWriteDatabase, String) {
        let path = try seedBarDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (BarRepository(readDB: readDB), writeDB, path)
    }

    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }
}

/// Real web schemas for the tables /bar reads (lib/db.ts L1329, L1064, L1087).
private func seedBarDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-bar-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabasePool(path: path)      // WAL for the read-only pool
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE recipe_costs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipe_id TEXT NOT NULL, recipe_name TEXT, category TEXT,
              yield REAL, yield_unit TEXT, batch_cost REAL, cost_per_yield_unit REAL,
              costed_lines INTEGER, total_lines INTEGER, interpretations INTEGER,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now')),
              UNIQUE(location_id, recipe_id)
            );
            CREATE TABLE inventory_par (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vendor TEXT, ingredient TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '',
              par_qty REAL, par_unit TEXT, pack_size TEXT, pack_unit TEXT,
              category TEXT, note TEXT, location_id TEXT NOT NULL DEFAULT 'default',
              updated_at TEXT DEFAULT (datetime('now')),
              UNIQUE(location_id, ingredient, sku)
            );
            CREATE TABLE inventory_counts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_date TEXT NOT NULL, label TEXT, opened_at TEXT DEFAULT (datetime('now')),
              closed_at TEXT, cook_id TEXT, location_id TEXT NOT NULL DEFAULT 'default'
            );
            CREATE TABLE inventory_count_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_id INTEGER NOT NULL, vendor TEXT, ingredient TEXT NOT NULL,
              sku TEXT NOT NULL DEFAULT '', on_hand_qty REAL, unit TEXT, par_qty REAL, par_unit TEXT,
              note TEXT, counted_by TEXT, counted_at TEXT DEFAULT (datetime('now')),
              location_id TEXT NOT NULL DEFAULT 'default',
              UNIQUE(count_id, ingredient, sku)
            );
            """)
    }
    return path
}
