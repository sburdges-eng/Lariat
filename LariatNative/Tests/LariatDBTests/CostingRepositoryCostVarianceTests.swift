import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer parity for the recipe cost-variance read that rides
/// `CostingRepository.fetch()` → `CostingBundle.recipeCostVariance` (A4 card).
///
/// Oracle: `computeCostVariance` in `lib/costingBenchmarks.mjs` — specifically
/// the SQL the web function embeds (location scoping, the vendor_prices
/// `ORDER BY imported_at DESC, id DESC` latest pick, ingredient_masters
/// preferred_vendor lookup, the seed-table reads). The pure algorithm cases
/// live in `CostVarianceComputeTests` (LariatModelTests).
final class CostingRepositoryCostVarianceTests: XCTestCase {

    /// Full costing schema mirroring lib/db.ts DDL for the tables
    /// `computeCostVariance` reads, plus the tables `CostingRepository.fetch()`
    /// touches on the way (accounting_variance, dish_coverage_snapshots,
    /// sales_lines). NO native migration — web-owned tables recreated for the
    /// test only.
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-costvar-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)   // establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE accounting_variance (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL,
                  snapshot_at TEXT, period_start TEXT, period_end TEXT);
                CREATE TABLE dish_coverage_snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  total_dishes INTEGER, covered_dishes INTEGER, coverage_pct REAL,
                  uncovered_dishes TEXT, created_by TEXT, snapshot_at TEXT);
                CREATE TABLE sales_lines (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  period_label TEXT, item_name TEXT NOT NULL,
                  quantity_sold REAL, net_sales REAL, source TEXT,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE recipe_costs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  recipe_name TEXT,
                  category TEXT,
                  yield REAL,
                  yield_unit TEXT,
                  batch_cost REAL,
                  cost_per_yield_unit REAL,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')),
                  UNIQUE(location_id, recipe_id));

                CREATE TABLE bom_lines (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  ingredient TEXT,
                  master_id TEXT,
                  qty REAL,
                  unit TEXT,
                  pack_price REAL,
                  pack_size REAL,
                  yield_pct REAL,
                  loss_factor REAL,
                  map_status TEXT,
                  location_id TEXT DEFAULT 'default');

                CREATE TABLE vendor_prices (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  master_id TEXT,
                  vendor TEXT,
                  sku TEXT,
                  pack_size REAL,
                  pack_unit TEXT,
                  pack_price REAL,
                  unit_price REAL,
                  category TEXT,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE ingredient_masters (
                  master_id TEXT PRIMARY KEY,
                  canonical_name TEXT,
                  category TEXT,
                  preferred_vendor TEXT);

                CREATE TABLE ingredient_densities (
                  ingredient_key TEXT PRIMARY KEY,
                  g_per_ml REAL NOT NULL,
                  source TEXT);

                CREATE TABLE ingredient_unit_weights (
                  ingredient_key TEXT NOT NULL,
                  unit TEXT NOT NULL,
                  g_per_unit REAL,
                  source TEXT,
                  PRIMARY KEY (ingredient_key, unit));
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    private func seedRecipe(
        _ db: Database, _ id: String, cost: Double, yield: Double = 1.0,
        batchCost: Double? = nil, yieldUnit: String = "each", locationId: String = "default"
    ) throws {
        try db.execute(sql: """
            INSERT INTO recipe_costs (recipe_id, recipe_name, batch_cost, cost_per_yield_unit,
                                      yield, yield_unit, location_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, arguments: [id, id, batchCost ?? cost * yield, cost, yield, yieldUnit, locationId])
    }

    private func seedBom(
        _ db: Database, _ recipeId: String, _ ingredient: String, qty: Double = 1.0,
        unit: String = "lb", masterId: String? = nil, locationId: String = "default"
    ) throws {
        try db.execute(sql: """
            INSERT INTO bom_lines (recipe_id, ingredient, master_id, qty, unit,
                                   pack_price, pack_size, location_id)
            VALUES (?, ?, ?, ?, ?, 50, 50, ?)
            """, arguments: [recipeId, ingredient, masterId, qty, unit, locationId])
    }

    private func seedVendor(
        _ db: Database, _ ingredient: String, packPrice: Double, packSize: Double = 50.0,
        packUnit: String = "lb", vendor: String = "sysco", masterId: String? = nil,
        importedAt: String = "2026-06-01 00:00:00", locationId: String = "default"
    ) throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices (ingredient, master_id, vendor, pack_size, pack_unit,
                                       pack_price, unit_price, location_id, imported_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, arguments: [ingredient, masterId, vendor, packSize, packUnit,
                             packPrice, packPrice / packSize, locationId, importedAt])
    }

    // ── Golden fixture through the SQL layer (location-scoped) ──────────────

    func testBundleCarriesGoldenAggregatesAndIgnoresOtherLocations() async throws {
        // Same golden fixture as CostVarianceComputeTests (web t9 aggregates):
        // 0% / 3% / 10% drift → max=10, mean=4.33, over5=1. Plus one recipe at
        // 100% drift in ANOTHER location that must be invisible (location scope).
        let (db, dir) = try makeDB { db in
            try self.seedRecipe(db, "r_zero", cost: 1.0)
            try self.seedRecipe(db, "r_mid", cost: 1.0)
            try self.seedRecipe(db, "r_hi", cost: 1.0)
            try self.seedBom(db, "r_zero", "ing_r_zero")
            try self.seedBom(db, "r_mid", "ing_r_mid")
            try self.seedBom(db, "r_hi", "ing_r_hi")
            try self.seedVendor(db, "ing_r_zero", packPrice: 50.0)
            try self.seedVendor(db, "ing_r_mid", packPrice: 51.5)
            try self.seedVendor(db, "ing_r_hi", packPrice: 55.0)
            // Other location — must not leak into 'default'.
            try self.seedRecipe(db, "r_other", cost: 1.0, locationId: "elsewhere")
            try self.seedBom(db, "r_other", "ing_other", locationId: "elsewhere")
            try self.seedVendor(db, "ing_other", packPrice: 100.0, locationId: "elsewhere")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let v = try await repo.fetch().recipeCostVariance

        XCTAssertEqual(v.max, 10.0, accuracy: 1e-6)
        XCTAssertEqual(v.mean, 4.33, accuracy: 1e-6)
        XCTAssertEqual(v.over5pctCount, 1)
        XCTAssertEqual(v.eligibleCount, 3)
        XCTAssertEqual(v.candidateCount, 3, "the 'elsewhere' recipe must be scoped out")
        XCTAssertEqual(v.excludedHighUnmatchedCount, 0)
        XCTAssertEqual(v.topOffenders.first?.name, "r_hi")
        XCTAssertEqual(v.topOffenders.first?.variancePct ?? -1, 10.0, accuracy: 1e-6)
    }

    // ── Latest-imported_at pick (web ORDER BY imported_at DESC, id DESC) ────

    func testLatestImportedVendorRowWinsPerIngredient() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedRecipe(db, "r1", cost: 1.0)
            try self.seedBom(db, "r1", "onion")
            // Stale price first (older imported_at), fresh price second —
            // the fresh $55 row must drive the variance (10%), not the $50 one.
            try self.seedVendor(db, "onion", packPrice: 50.0, importedAt: "2026-01-01 00:00:00")
            try self.seedVendor(db, "onion", packPrice: 55.0, importedAt: "2026-06-01 00:00:00")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let v = try await repo.fetch().recipeCostVariance

        XCTAssertEqual(v.eligibleCount, 1)
        XCTAssertEqual(v.max, 10.0, accuracy: 1e-6, "newest imported_at row must win")
    }

    // ── T7 master merge with ingredient_masters.preferred_vendor ────────────

    func testMasterMergeUsesPreferredVendorFromIngredientMasters() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedRecipe(db, "burger", cost: 11.0)
            try self.seedBom(db, "burger", "heinz ketchup 1gal", unit: "gal",
                             masterId: "heinz_ketchup_1gal")
            try self.seedVendor(db, "heinz ketchup 1gal", packPrice: 12.0, packSize: 1.0,
                                packUnit: "gal", vendor: "sysco", masterId: "heinz_ketchup_1gal")
            try self.seedVendor(db, "heinz ketchup 1gal", packPrice: 11.0, packSize: 1.0,
                                packUnit: "gal", vendor: "shamrock", masterId: "heinz_ketchup_1gal")
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor)
                VALUES ('heinz_ketchup_1gal', 'Heinz Ketchup 1gal', 'shamrock')
                """)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let v = try await repo.fetch().recipeCostVariance

        // preferred shamrock @ $11/gal vs theoretical $11 → variance 0.
        XCTAssertEqual(v.eligibleCount, 1)
        XCTAssertEqual(v.max, 0.0, accuracy: 1e-6)
    }

    // ── Density seed feeds the cross-dim pack conversion ────────────────────

    func testDensitySeedEnablesCrossDimConversion() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedRecipe(db, "r1", cost: 1.0)
            try self.seedBom(db, "r1", "diced onion", unit: "cup")
            try self.seedVendor(db, "diced onion", packPrice: 50.0)   // 50-lb pack
            try db.execute(sql: """
                INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source)
                VALUES ('diced onion', 0.56, 'seed')
                """)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = CostingRepository(database: db, locationId: "default")
        let v = try await repo.fetch().recipeCostVariance

        XCTAssertEqual(v.eligibleCount, 1, "density seed must reach the converter")
        // Same expected math as the web t9 cross-dim test.
        let packCup = 50.0 * 453.59237 / 0.56 / 236.5882365
        let expectedActual = 50.0 / packCup
        let expectedVariance = (((abs(expectedActual - 1.0) / 1.0 * 100.0) * 100) + 0.5)
            .rounded(.down) / 100
        XCTAssertEqual(v.max, expectedVariance, accuracy: 1e-6)
    }

    // ── Degrade: legacy fixture DB without the costing tables ───────────────

    func testLegacyFixtureWithoutCostingTablesYieldsEmptyCard() async throws {
        // The shared P0/P1a fixture has NO recipe_costs / bom_lines and a
        // vendor_prices table without master_id — the bundle must still load,
        // carrying an empty (all-zero) card rather than crashing.
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }

        let db = try LariatDatabase(path: path)
        let repo = CostingRepository(database: db, locationId: "default")
        let v = try await repo.fetch().recipeCostVariance

        XCTAssertEqual(v, RecipeCostVariance.empty)
    }
}
