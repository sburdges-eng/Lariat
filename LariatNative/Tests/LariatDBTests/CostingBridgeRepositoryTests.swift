import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer parity for the dish-cost bridge fetch in `CostingRepository`
/// (the T1 fix for the `CAST(NULL AS REAL)` cost_per_unit staging gap).
///
/// Oracle: `tests/js/test-dish-cost-bridge.mjs` — the cases that depend on
/// the SQL the web module embeds (latest-imported_at vendor join, the
/// `is_placeholder` order-guide skip, location scoping). The pure algorithm
/// cases live in `DishCostBridgeComputeTests`.
final class CostingBridgeRepositoryTests: XCTestCase {

    // Full bridge schema (sales_lines + dish_components + recipe_costs +
    // vendor_prices + order_guide_items) mirroring lib/db.ts DDL, incl. the
    // partial unique indexes on dish_components. NO native migration — the
    // harness recreates web-owned tables only for the test.
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-bridge-" + UUID().uuidString
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
                  source TEXT,
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
                  unit TEXT NOT NULL,
                  notes TEXT,
                  created_at TEXT DEFAULT (datetime('now')),
                  updated_at TEXT DEFAULT (datetime('now')));
                CREATE UNIQUE INDEX idx_dish_components_recipe_unique
                  ON dish_components(location_id, dish_name, recipe_slug)
                  WHERE component_type = 'recipe';
                CREATE UNIQUE INDEX idx_dish_components_vendor_unique
                  ON dish_components(location_id, dish_name, vendor_ingredient)
                  WHERE component_type = 'vendor_item';

                CREATE TABLE recipe_costs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  recipe_name TEXT,
                  category TEXT,
                  yield REAL,
                  yield_unit TEXT,
                  batch_cost REAL,
                  cost_per_yield_unit REAL,
                  costed_lines INTEGER,
                  total_lines INTEGER,
                  interpretations INTEGER,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')),
                  UNIQUE(location_id, recipe_id));

                CREATE TABLE vendor_prices (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  vendor TEXT,
                  sku TEXT,
                  pack_size REAL,
                  pack_unit TEXT,
                  pack_price REAL,
                  unit_price REAL,
                  category TEXT,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE order_guide_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  base_qty REAL,
                  unit TEXT,
                  vendor TEXT,
                  unit_price REAL,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')),
                  is_placeholder INTEGER DEFAULT 0);

                -- CostingRepository.fetch() also reads these two P0 tables.
                CREATE TABLE accounting_variance (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL,
                  snapshot_at TEXT, period_start TEXT, period_end TEXT);
                CREATE TABLE dish_coverage_snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  total_dishes INTEGER, covered_dishes INTEGER, coverage_pct REAL,
                  uncovered_dishes TEXT, created_by TEXT, snapshot_at TEXT);
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    // ── seed helpers mirroring the oracle's inserts ─────────────────────────

    private func seedSale(_ db: Database, _ item: String, _ qty: Double, _ rev: Double,
                          locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
            VALUES (?, ?, ?, ?)
            """, arguments: [item, qty, rev, locationId])
    }

    private func seedRecipeCost(_ db: Database, _ slug: String, _ name: String,
                                _ costPerYieldUnit: Double, _ yieldUnit: String,
                                locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
            VALUES (?, ?, ?, ?, ?)
            """, arguments: [slug, name, costPerYieldUnit, yieldUnit, locationId])
    }

    private func seedDishComponent(_ db: Database, _ dish: String, recipeSlug: String,
                                   _ qty: Double, _ unit: String,
                                   locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO dish_components
              (location_id, dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit)
            VALUES (?, ?, 'recipe', ?, NULL, ?, ?)
            """, arguments: [locationId, dish, recipeSlug, qty, unit])
    }

    private func seedVendorDishComponent(_ db: Database, _ dish: String, ingredient: String,
                                         _ qty: Double, _ unit: String,
                                         locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO dish_components
              (location_id, dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit)
            VALUES (?, ?, 'vendor_item', NULL, ?, ?, ?)
            """, arguments: [locationId, dish, ingredient, qty, unit])
    }

    private func seedVendorPrice(_ db: Database, _ ingredient: String, _ unitPrice: Double,
                                 _ packUnit: String, importedAt: String = "2026-06-01 00:00:00",
                                 locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit, unit_price, location_id, imported_at)
            VALUES (?, 'sysco', 1, ?, ?, ?, ?)
            """, arguments: [ingredient, packUnit, unitPrice, locationId, importedAt])
    }

    private func seedOrderGuide(_ db: Database, _ ingredient: String, _ unitPrice: Double,
                                _ unit: String, isPlaceholder: Bool = false,
                                locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO order_guide_items (ingredient, unit_price, unit, location_id, is_placeholder)
            VALUES (?, ?, ?, ?, ?)
            """, arguments: [ingredient, unitPrice, unit, locationId, isPlaceholder ? 1 : 0])
    }

    private func cpu(_ bundle: CostingBundle, _ item: String) -> Double? {
        bundle.salesLines.first { $0.itemName == item }?.costPerUnit
    }

    // ── tests ───────────────────────────────────────────────────────────────

    /// Recipe path end-to-end: dish_components + recipe_costs + recipes.json
    /// declaration → real cost_per_unit on the sales line (oracle "fully
    /// linked" case: $4/qt × 0.5 cup = $0.50). The unlinked dish stays nil.
    func testRecipePathPopulatesCostPerUnit() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedRecipeCost(db, "bacon_jam", "Bacon Jam", 4.0, "qt")
            try self.seedDishComponent(db, "the rope burger", recipeSlug: "bacon_jam", 0.5, "cup")
            try self.seedSale(db, "ROPE BURGER", 100, 1000)   // normalizes to same key? NO — see below
            try self.seedSale(db, "THE ROPE BURGER", 50, 500)
            try self.seedSale(db, "Bourbon Well", 50, 250)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(
            database: db, locationId: "default",
            recipes: [BridgeRecipe(slug: "bacon_jam", name: "Bacon Jam", menuItems: ["The Rope Burger"])])
        let bundle = try await repo.fetch()

        XCTAssertEqual(try XCTUnwrap(cpu(bundle, "THE ROPE BURGER")), 0.5, accuracy: 0.001)
        // 'ROPE BURGER' normalizes to 'rope burger' ≠ 'the rope burger' → unlinked.
        XCTAssertNil(cpu(bundle, "ROPE BURGER"))
        XCTAssertNil(cpu(bundle, "Bourbon Well"))
    }

    /// Latest-imported_at vendor join: the newest vendor_prices row per
    /// ingredient wins (web bridge L158-178 join on MAX(imported_at)).
    func testVendorLatestImportedAtWins() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedVendorPrice(db, "Brioche Bun", 0.99, "each", importedAt: "2026-05-01 00:00:00")
            try self.seedVendorPrice(db, "Brioche Bun", 0.40, "each", importedAt: "2026-06-01 00:00:00")
            try self.seedVendorDishComponent(db, "rope burger", ingredient: "Brioche Bun", 1, "each")
            try self.seedSale(db, "Rope Burger", 10, 100)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertEqual(try XCTUnwrap(cpu(bundle, "Rope Burger")), 0.40, accuracy: 0.001)
    }

    /// Oracle: "skips order_guide rows marked is_placeholder=1 when resolving
    /// vendor_item cost" — the real row must win regardless of insertion order.
    func testOrderGuidePlaceholderSkipped() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedOrderGuide(db, "rye whiskey", 0.000502325771845, "cup", isPlaceholder: true)
            try self.seedOrderGuide(db, "rye whiskey", 0.50, "oz")
            try self.seedVendorDishComponent(db, "old fashioned", ingredient: "rye whiskey", 2, "oz")
            try self.seedSale(db, "Old Fashioned", 10, 120)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertEqual(try XCTUnwrap(cpu(bundle, "Old Fashioned")), 1.0, accuracy: 0.001)
    }

    /// Oracle: "treats the placeholder row as absent: no_vendor_price when it
    /// is the only row" — the bogus unit_price must not leak into costing.
    func testPlaceholderOnlyTreatedAsAbsent() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedOrderGuide(db, "dry white wine", 0.000502325771845, "cup", isPlaceholder: true)
            try self.seedVendorDishComponent(db, "wine sauce plate", ingredient: "dry white wine", 0.25, "cup")
            try self.seedSale(db, "Wine Sauce Plate", 5, 100)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertNil(cpu(bundle, "Wine Sauce Plate"))
    }

    /// Oracle: "vendor_prices still wins over a real (non-placeholder)
    /// order_guide row" — regression guard on index precedence.
    func testVendorPricesWinOverRealOrderGuide() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedVendorPrice(db, "stout beer", 0.08, "oz")
            try self.seedOrderGuide(db, "stout beer", 0.20, "oz")
            try self.seedVendorDishComponent(db, "beer braise", ingredient: "stout beer", 4, "oz")
            try self.seedSale(db, "Beer Braise", 8, 96)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertEqual(try XCTUnwrap(cpu(bundle, "Beer Braise")), 0.32, accuracy: 0.001)
    }

    /// Location scoping: dish_components / vendor_prices from another
    /// location must not leak into 'default' costing.
    func testBridgeInputsAreLocationScoped() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedVendorPrice(db, "Brioche Bun", 0.50, "each", locationId: "kitchen-b")
            try self.seedVendorDishComponent(db, "rope burger", ingredient: "Brioche Bun", 1, "each",
                                             locationId: "kitchen-b")
            try self.seedSale(db, "Rope Burger", 10, 100)   // default location
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()
        XCTAssertNil(cpu(bundle, "Rope Burger"), "kitchen-b bridge rows must not leak into default")
    }

    /// The shared `seedFixtureDatabase()` has NO recipe_costs /
    /// order_guide_items tables (pre-bridge fixture shape). The bridge fetch
    /// must treat a missing table as an empty input, not throw — this also
    /// keeps `CostingRepositoryTests`' pinned expectations green.
    func testMissingBridgeTablesTolerated() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let db = try LariatDatabase(path: path)
        let repo = CostingRepository(database: db, locationId: "default")
        let bundle = try await repo.fetch()

        // Burger has a dish_components row ('Ground Beef') but vendor_prices is
        // empty and order_guide_items doesn't exist → no price → cpu stays nil.
        XCTAssertEqual(bundle.salesLines.count, 3)
        XCTAssertNil(cpu(bundle, "Burger"))
        XCTAssertNil(cpu(bundle, "Tacos"))
        XCTAssertNil(cpu(bundle, "MysteryX"))
    }
}
