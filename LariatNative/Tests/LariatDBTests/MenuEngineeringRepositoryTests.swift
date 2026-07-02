import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer tests for `MenuEngineeringRepository` — the fetch half of the
/// `app/menu-engineering/page.tsx` hub board. The web page has no dedicated
/// route test; these are authored against its code path (documented in the
/// A4.3 plan): raw sales aggregation WITHOUT a qty>0 filter (TOTAL noise is
/// dropped later by `cleanedSalesRows`, exactly like the web), the
/// margin_snapshots "Compute Engine Last Ran" lookup, and location scoping.
final class MenuEngineeringRepositoryTests: XCTestCase {

    private func makeDB(includeMarginSnapshots: Bool = true,
                        seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-menueng-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)   // establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE sales_lines (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  period_label TEXT,
                  item_name TEXT NOT NULL,
                  quantity_sold REAL,
                  net_sales REAL,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE dish_components (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug TEXT,
                  vendor_ingredient TEXT,
                  qty_per_serving REAL NOT NULL,
                  unit TEXT NOT NULL);

                CREATE TABLE recipe_costs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  recipe_name TEXT,
                  cost_per_yield_unit REAL,
                  yield_unit TEXT,
                  location_id TEXT DEFAULT 'default',
                  UNIQUE(location_id, recipe_id));

                CREATE TABLE vendor_prices (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  vendor TEXT,
                  pack_unit TEXT,
                  unit_price REAL,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE order_guide_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  unit TEXT,
                  unit_price REAL,
                  location_id TEXT DEFAULT 'default',
                  is_placeholder INTEGER DEFAULT 0);
                """)
            if includeMarginSnapshots {
                try db.execute(sql: """
                    CREATE TABLE margin_snapshots (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      item_name TEXT NOT NULL,
                      net_sales REAL,
                      cost_per_unit REAL,
                      margin_pct REAL,
                      popularity REAL,
                      quadrant TEXT,
                      snapshot_at TEXT DEFAULT (datetime('now')),
                      location_id TEXT DEFAULT 'default');
                    """)
            }
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    private func seedSale(_ db: Database, _ item: String, _ qty: Double, _ rev: Double,
                          locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
            VALUES (?, ?, ?, ?)
            """, arguments: [item, qty, rev, locationId])
    }

    /// Web SQL parity: GROUP BY item_name with SUM aggregates and NO
    /// quantity_sold filter — TOTAL rows are returned raw and dropped later
    /// by cleanedSalesRows (lib/menuEngineering.ts L60-68).
    func testSalesAggregationIncludesFooterNoiseRaw() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedSale(db, "Burger", 30, 450)
            try self.seedSale(db, "Burger", 10, 150)     // second period → summed
            try self.seedSale(db, "TOTAL", 9999, 99999)  // Toast CSV footer
            try self.seedSale(db, "Freebie", 0, 0)       // zero-qty stays (no qty>0 filter)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MenuEngineeringRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()

        let burger = try XCTUnwrap(bundle.sales.first { $0.itemName == "Burger" })
        XCTAssertEqual(burger.qty, 40, accuracy: 1e-9)
        XCTAssertEqual(burger.rev, 600, accuracy: 1e-9)
        XCTAssertNotNil(bundle.sales.first { $0.itemName == "TOTAL" },
                        "raw fetch must include footer rows; the compute filters them")
        XCTAssertNotNil(bundle.sales.first { $0.itemName == "Freebie" })
    }

    /// "Compute Engine Last Ran" comes from the latest margin_snapshots row
    /// (page.tsx L85-95: ORDER BY id DESC LIMIT 1, location-scoped).
    func testLastComputeRunReturnsLatestSnapshot() async throws {
        let (db, dir) = try makeDB { db in
            try db.execute(sql: """
                INSERT INTO margin_snapshots (item_name, snapshot_at, location_id) VALUES
                  ('Burger', '2026-06-01 10:00:00', 'default'),
                  ('Burger', '2026-06-15 10:00:00', 'default'),
                  ('Burger', '2026-06-30 10:00:00', 'kitchen-b');
                """)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MenuEngineeringRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertEqual(bundle.lastComputeRun, "2026-06-15 10:00:00")
    }

    /// A DB without margin_snapshots (pre-compute-engine copy) must not
    /// break the fetch — lastComputeRun degrades to nil.
    func testMissingMarginSnapshotsTableTolerated() async throws {
        let (db, dir) = try makeDB(includeMarginSnapshots: false) { db in
            try self.seedSale(db, "Burger", 10, 150)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MenuEngineeringRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertNil(bundle.lastComputeRun)
        XCTAssertEqual(bundle.sales.count, 1)
    }

    /// Sales + bridge inputs are location-scoped.
    func testFetchIsLocationScoped() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedSale(db, "Burger", 10, 150)
            try self.seedSale(db, "Tacos", 5, 75, locationId: "kitchen-b")
            try db.execute(sql: """
                INSERT INTO dish_components
                  (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit)
                VALUES ('kitchen-b', 'burger', 'vendor_item', 'Bun', 1, 'each');
                """)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MenuEngineeringRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertEqual(bundle.sales.map(\.itemName), ["Burger"])
        XCTAssertTrue(bundle.bridgeInputs.dishComponents.isEmpty,
                      "kitchen-b dish_components must not leak into default")
    }
}
