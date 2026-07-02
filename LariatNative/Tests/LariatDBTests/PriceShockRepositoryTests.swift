import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer parity with `lib/vendorPricesRepo.ts#listPriceShocks` /
/// `#listPriceSeries` and `lib/priceShockImpact.js`, exercised via
/// `tests/js/test-price-shocks.mjs` + `tests/js/test-price-shock-impact.mjs`
/// where a JS oracle exists. Mirrors the temp-WAL-then-reopen fixture pattern
/// from `MarginDeltasRepositoryTests.swift`. NO native migration — the
/// fixture recreates the web-owned tables only for the test.
final class PriceShockRepositoryTests: XCTestCase {

    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-priceshock-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)  // establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE vendor_prices (
                  id            INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient    TEXT NOT NULL,
                  vendor        TEXT,
                  sku           TEXT,
                  pack_size     REAL,
                  pack_unit     TEXT,
                  pack_price    REAL,
                  unit_price    REAL,
                  category      TEXT,
                  location_id   TEXT DEFAULT 'default',
                  imported_at   TEXT DEFAULT (datetime('now')));

                CREATE TABLE vendor_prices_history (
                  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                  run_id                  INTEGER,
                  source_vendor_price_id  INTEGER,
                  ingredient              TEXT NOT NULL,
                  vendor                  TEXT,
                  sku                     TEXT,
                  pack_size               REAL,
                  pack_unit               TEXT,
                  pack_price              REAL,
                  unit_price              REAL,
                  category                TEXT,
                  yield_pct               REAL,
                  actual_received_lb      REAL,
                  reconciled_unit_price   REAL,
                  master_id               TEXT,
                  location_id             TEXT DEFAULT 'default',
                  imported_at             TEXT,
                  snapshot_at             TEXT DEFAULT (datetime('now','subsec')),
                  snapshot_reason         TEXT);

                CREATE TABLE dish_components (
                  id                INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id       TEXT NOT NULL DEFAULT 'default',
                  dish_name         TEXT NOT NULL,
                  component_type    TEXT NOT NULL DEFAULT 'recipe'
                                      CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug       TEXT,
                  vendor_ingredient TEXT,
                  qty_per_serving   REAL NOT NULL,
                  unit              TEXT NOT NULL);

                CREATE TABLE bom_lines (
                  id                INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id         TEXT NOT NULL,
                  ingredient        TEXT,
                  qty               REAL,
                  unit              TEXT,
                  sub_recipe        TEXT,
                  vendor_ingredient TEXT,
                  map_status        TEXT,
                  vendor            TEXT,
                  pack_price        REAL,
                  pack_size         REAL,
                  location_id       TEXT DEFAULT 'default',
                  imported_at       TEXT DEFAULT (datetime('now')));
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    // ── seed helpers ─────────────────────────────────────────────────────

    private func insertSnapshot(_ db: Database, vendor: String, sku: String, ingredient: String,
                                unitPrice: Double, daysAgo: Int, category: String? = nil, locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices_history
              (location_id, vendor, sku, ingredient, pack_size, pack_unit, pack_price,
               unit_price, category, snapshot_at, snapshot_reason)
            VALUES (?, ?, ?, ?, 1, 'lb', ?, ?, ?, datetime('now', ?), 'test')
            """, arguments: [locationId, vendor, sku, ingredient, unitPrice, unitPrice, category, "-\(daysAgo) days"])
    }

    private func insertLive(_ db: Database, vendor: String, sku: String, ingredient: String,
                            unitPrice: Double, category: String? = nil, locationId: String = "default", importedAt: String? = nil) throws {
        if let importedAt {
            try db.execute(sql: """
                INSERT INTO vendor_prices
                  (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id, imported_at)
                VALUES (?, ?, ?, 1, 'lb', ?, ?, ?, ?, ?)
                """, arguments: [ingredient, vendor, sku, unitPrice, unitPrice, category, locationId, importedAt])
        } else {
            try db.execute(sql: """
                INSERT INTO vendor_prices
                  (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id)
                VALUES (?, ?, ?, 1, 'lb', ?, ?, ?, ?)
                """, arguments: [ingredient, vendor, sku, unitPrice, unitPrice, category, locationId])
        }
    }

    private func insertDishComponent(_ db: Database, dish: String, ingredient: String, locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO dish_components
              (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit)
            VALUES (?, ?, 'vendor_item', ?, 1, 'lb')
            """, arguments: [locationId, dish, ingredient])
    }

    private func insertBomLine(_ db: Database, recipeId: String, vendorIngredient: String, locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO bom_lines
              (recipe_id, ingredient, vendor_ingredient, qty, unit, location_id)
            VALUES (?, ?, ?, 1, 'lb', ?)
            """, arguments: [recipeId, vendorIngredient, vendorIngredient, locationId])
    }

    // ── tests ────────────────────────────────────────────────────────────

    /// Oracle: "scopes to location_id" — kitchen-a moves +100%, kitchen-b +0.1% (below gate).
    func testLocationScoping() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100, daysAgo: 5, locationId: "kitchen-a")
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 200, daysAgo: 0, locationId: "kitchen-a")
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100, daysAgo: 5, locationId: "kitchen-b")
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100.1, daysAgo: 0, locationId: "kitchen-b")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repoA = PriceShockRepository(database: db, locationId: "kitchen-a")
        let repoB = PriceShockRepository(database: db, locationId: "kitchen-b")
        let a = try await repoA.load(options: PriceShockOptions(locationId: "kitchen-a", windowDays: 7, minPctMove: 5))
        let b = try await repoB.load(options: PriceShockOptions(locationId: "kitchen-b", windowDays: 7, minPctMove: 5))
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(b.count, 0)
    }

    /// Oracle: "honours windowDays — older snapshots fall outside".
    func testWindowDaysClamp() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 100, daysAgo: 40)
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 200, daysAgo: 0)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let week = try await repo.load(options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(week.count, 0)
        let quarter = try await repo.load(options: PriceShockOptions(windowDays: 90, minPctMove: 5))
        XCTAssertEqual(quarter.count, 1)
        XCTAssertEqual(quarter[0].baselineUnitPrice, 100, accuracy: 1e-9)
    }

    /// Live overlay end-to-end through SQL: fresh-ingest TOM-1, history 10 @3d + live 12 -> +20%.
    func testLiveOverlaySql() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "sysco", sku: "TOM-1", ingredient: "Tomatoes", unitPrice: 10, daysAgo: 3)
            try self.insertLive(db, vendor: "sysco", sku: "TOM-1", ingredient: "Tomatoes", unitPrice: 12)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let rows = try await repo.load(options: PriceShockOptions(windowDays: 30, minPctMove: 5))
        let hit = rows.first { $0.sku == "TOM-1" }
        XCTAssertNotNil(hit)
        XCTAssertEqual(hit?.latestUnitPrice ?? 0, 12, accuracy: 1e-9)
        XCTAssertEqual(hit?.deltaPct ?? 0, 20, accuracy: 1e-6)
    }

    /// Oracle: affectedDishes — priceShockImpact.js component_type='vendor_item' exact match,
    /// duplicate row -> distinct + sorted.
    func testImpactDishes() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertDishComponent(db, dish: "Guacamole", ingredient: "Avocado")
            try self.insertDishComponent(db, dish: "Guacamole", ingredient: "Avocado")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let m = try await repo.impact(ingredients: ["Avocado"])
        XCTAssertEqual(m["Avocado"]?.dishes, ["Guacamole"])
    }

    /// Oracle: test-price-shock-impact.mjs "scopes fallback recipe impact to the selected location".
    func testImpactRecipesLocationScoped() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertBomLine(db, recipeId: "guac_a", vendorIngredient: "Avocado", locationId: "kitchen-a")
            try self.insertBomLine(db, recipeId: "guac_b", vendorIngredient: "Avocado", locationId: "kitchen-b")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repoA = PriceShockRepository(database: db, locationId: "kitchen-a")
        let m = try await repoA.impact(ingredients: ["Avocado"])
        XCTAssertEqual(m["Avocado"]?.recipes, ["guac_a"])
    }

    func testImpactEmptyIngredientsShortCircuits() async throws {
        let (db, dir) = try makeDB { _ in }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let m = try await repo.impact(ingredients: [])
        XCTAssertTrue(m.isEmpty)
    }

    /// series drill-down — ordered snapshot_at ASC, id ASC.
    func testSeriesOrderedAndDelta() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "v", sku: "SKU", ingredient: "Ing", unitPrice: 10, daysAgo: 5)
            try self.insertSnapshot(db, vendor: "v", sku: "SKU", ingredient: "Ing", unitPrice: 12, daysAgo: 0)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let r = try await repo.series(options: PriceSeriesOptions(vendor: "v", sku: "SKU"))
        XCTAssertEqual(r.points.count, 2)
        XCTAssertEqual(r.points.first?.unitPrice ?? 0, 10, accuracy: 1e-9)
        XCTAssertEqual(r.deltaPct ?? 0, 20, accuracy: 1e-6)
    }

    func testSeriesBlankReturnsEmpty() async throws {
        let (db, dir) = try makeDB { _ in }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let r = try await repo.series(options: PriceSeriesOptions(vendor: "", sku: "SKU"))
        XCTAssertTrue(r.points.isEmpty)
        XCTAssertNil(r.deltaPct)
    }

    /// zero-state discriminator: no rows seeded -> historyCount 0, load [].
    func testHistoryCountAndEmptyLoad() async throws {
        let (db, dir) = try makeDB { _ in }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = PriceShockRepository(database: db, locationId: "default")
        let count = try await repo.historyCount()
        XCTAssertEqual(count, 0)
        let rows = try await repo.load(options: PriceShockOptions())
        XCTAssertTrue(rows.isEmpty)
    }

    /// historyCount scopes by location_id and counts raw history rows (not shock rows).
    func testHistoryCountScopedByLocation() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 100, daysAgo: 5, locationId: "kitchen-a")
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 105, daysAgo: 0, locationId: "kitchen-a")
            try self.insertSnapshot(db, vendor: "v", sku: "B", ingredient: "B", unitPrice: 50, daysAgo: 0, locationId: "kitchen-b")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repoA = PriceShockRepository(database: db, locationId: "kitchen-a")
        let repoB = PriceShockRepository(database: db, locationId: "kitchen-b")
        let countA = try await repoA.historyCount()
        let countB = try await repoB.historyCount()
        XCTAssertEqual(countA, 2)
        XCTAssertEqual(countB, 1)
    }
}
