import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class DepletionExceptionsRepositoryTests: XCTestCase {
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-depl-exc-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE sales_lines (
                  id INTEGER PRIMARY KEY, period_label TEXT, item_name TEXT, quantity_sold REAL,
                  net_sales REAL, source TEXT, location_id TEXT, imported_at TEXT);
                CREATE TABLE dish_components (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug TEXT, vendor_ingredient TEXT,
                  qty_per_serving REAL NOT NULL, unit TEXT NOT NULL,
                  CHECK ((component_type='recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL)
                      OR (component_type='vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)));
                CREATE TABLE entities_recipes (
                  uuid TEXT PRIMARY KEY, slug TEXT NOT NULL, display_name TEXT NOT NULL,
                  yield_qty REAL, yield_unit TEXT, category TEXT,
                  active INTEGER NOT NULL DEFAULT 1, location_id TEXT NOT NULL DEFAULT 'default',
                  UNIQUE(slug, location_id));
                CREATE TABLE bom_lines (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL,
                  ingredient TEXT, qty REAL, unit TEXT, loss_factor REAL,
                  location_id TEXT DEFAULT 'default');
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }
    private func sale(_ db: Database, _ item: String, _ qty: Double, _ net: Double?, _ period: String = "2026-W17", loc: String = "default") throws {
        try db.execute(sql: "INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id) VALUES (?,?,?,?, 'toast', ?)",
                       arguments: [period, item, qty, net, loc])
    }
    private func mappedVendorDish(_ db: Database, _ dish: String, _ ing: String) throws {
        try db.execute(sql: "INSERT INTO dish_components (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit) VALUES ('default', ?, 'vendor_item', ?, 2, 'oz')",
                       arguments: [dish, ing])
    }

    func testEmptyWhenNoSales() async throws {
        let (db, dir) = try makeDB { _ in }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out, [])
    }
    func testNoDishComponents() async throws {   // test-depletion-exceptions.mjs "flags a sold dish with no mapping"
        let (db, dir) = try makeDB { try self.sale($0, "Mystery Plate", 3, 27) }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].dishName, "Mystery Plate")
        XCTAssertEqual(out[0].reason, .noDishComponents)
        XCTAssertEqual(out[0].affectedSalesCount, 1)
        XCTAssertEqual(out[0].totalQuantitySold, 3)
        XCTAssertEqual(out[0].totalNetSales, 27)
        XCTAssertEqual(out[0].samplePeriodLabels, ["2026-W17"])
    }
    func testMappedDishOmitted() async throws {
        let (db, dir) = try makeDB { try self.mappedVendorDish($0, "Baja Taco", "cabbage slaw mix"); try self.sale($0, "Baja Taco", 4, 56) }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 0)
    }
    func testAggregatesRows() async throws {   // "aggregates multiple sales rows"
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery Plate", 2, 18, "2026-W17")
            try self.sale($0, "Mystery Plate", 5, 45, "2026-W18")
            try self.sale($0, "Mystery Plate", 1, 9, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].affectedSalesCount, 3)
        XCTAssertEqual(out[0].totalQuantitySold, 8)
        XCTAssertEqual(out[0].totalNetSales, 72)
        XCTAssertEqual(out[0].samplePeriodLabels.sorted(), ["2026-W17", "2026-W18"])
    }
    func testCasingDedupeKeepsHighestVolumeDisplay() async throws {   // "aggregates casing variants"
        let (db, dir) = try makeDB {
            try self.sale($0, "Baja Taco", 5, 50, "2026-W17")
            try self.sale($0, "BAJA TACO", 2, 20, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].dishName, "Baja Taco")   // higher quantity_sold wins display
        XCTAssertEqual(out[0].affectedSalesCount, 2)
        XCTAssertEqual(out[0].totalQuantitySold, 7)
        XCTAssertEqual(out[0].totalNetSales, 70)
    }
    func testOrderByNetThenQty() async throws {   // "orders by net_sales DESC then quantity DESC"
        let (db, dir) = try makeDB {
            try self.sale($0, "Cheap Item", 100, 50)
            try self.sale($0, "Expensive Item", 5, 500)
            try self.sale($0, "Mid Item", 10, 200)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.map(\.dishName), ["Expensive Item", "Mid Item", "Cheap Item"])
    }
    func testLocationScoping() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery Plate", 3, 27)
            try self.sale($0, "Other Mystery", 9, 99, "2026-W17", loc: "satellite")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let def = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(def.map(\.dishName), ["Mystery Plate"])
        let sat = try await DepletionExceptionsRepository(database: db, locationId: "satellite").list()
        XCTAssertEqual(sat.map(\.dishName), ["Other Mystery"])
    }
    func testPeriodFilter() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery A", 1, 10, "2026-W17")
            try self.sale($0, "Mystery B", 1, 12, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list(periodLabel: "2026-W17")
        XCTAssertEqual(out.map(\.dishName), ["Mystery A"])
    }
    func testIgnoresZeroNegQty() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Refund Plate", 0, 0)
            try self.sale($0, "Voided Plate", -1, -10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 0)
    }
    func testLimitCap() async throws {   // "honors limit cap" (test-depletion-exceptions.mjs:153-159)
        let (db, dir) = try makeDB {
            for i in 0..<5 {
                try self.sale($0, "Mystery \(i)", 1, 10 - Double(i))
            }
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list(limit: 2)
        XCTAssertEqual(out.count, 2)
    }
    func testLimitAfterFiltering() async throws {   // "applies limit after filtering out clean dishes"
        let (db, dir) = try makeDB {
            try self.mappedVendorDish($0, "Mapped Top Seller A", "cabbage slaw mix")
            try self.mappedVendorDish($0, "Mapped Top Seller B", "pickled onion")
            try self.sale($0, "Mapped Top Seller A", 50, 1000)
            try self.sale($0, "Mapped Top Seller B", 40, 900)
            try self.sale($0, "Mystery Low Seller A", 2, 20)
            try self.sale($0, "Mystery Low Seller B", 1, 10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list(limit: 2)
        XCTAssertEqual(out.map(\.dishName), ["Mystery Low Seller A", "Mystery Low Seller B"])
    }
    func testRecipeMissingYieldViaSQL() async throws {   // "flags recipe_missing_yield"
        let (db, dir) = try makeDB {
            try $0.execute(sql: "INSERT INTO dish_components (location_id, dish_name, component_type, recipe_slug, qty_per_serving, unit) VALUES ('default', 'Aioli Plate', 'recipe', 'mystery_aioli', 1, 'tsp')")
            try self.sale($0, "Aioli Plate", 1, 10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].reason, .recipeMissingYield)
    }
    func testNetSalesAllNullSurfacesNil() async throws {
        // SUM over an all-NULL net_sales group is SQL NULL, not 0 — must surface nil.
        let (db, dir) = try makeDB { try self.sale($0, "Mystery Plate", 3, nil) }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertNil(out[0].totalNetSales)
        XCTAssertEqual(out[0].totalQuantitySold, 3)
    }
}
