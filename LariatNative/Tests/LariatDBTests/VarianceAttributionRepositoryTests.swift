import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer parity with `lib/varianceAttribution.ts#buildVarianceAttribution`,
/// exercised via `tests/js/test-variance-attribution.mjs` where an oracle exists.
/// Mirrors the temp-WAL-then-reopen fixture pattern from
/// `MarginDeltasRepositoryTests.swift` / `PriceShockRepositoryTests.swift`. NO native
/// migration — the fixture recreates the web-owned tables only for the test.
final class VarianceAttributionRepositoryTests: XCTestCase {

    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-vattr-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE accounting_variance (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  period_start TEXT, period_end TEXT, theoretical_cogs REAL, actual_cogs REAL,
                  variance_amount REAL, variance_pct REAL,
                  snapshot_at TEXT DEFAULT (datetime('now')), location_id TEXT DEFAULT 'default');
                CREATE TABLE vendor_prices_history (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT, vendor TEXT, sku TEXT, pack_size REAL, pack_unit TEXT,
                  pack_price REAL, unit_price REAL, category TEXT,
                  location_id TEXT NOT NULL DEFAULT 'default', snapshot_at TEXT,
                  snapshot_reason TEXT, run_id INTEGER);
                CREATE TABLE dish_components (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default', dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe','vendor_item')),
                  recipe_slug TEXT, vendor_ingredient TEXT, qty_per_serving REAL NOT NULL,
                  unit TEXT NOT NULL, notes TEXT,
                  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL, location_id TEXT DEFAULT 'default', actor_cook_id TEXT,
                  actor_source TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
                  action TEXT NOT NULL CHECK(action IN ('insert','update','delete','correction','view')),
                  replaces_id INTEGER, payload_json TEXT, note TEXT,
                  created_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE inventory_counts (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  count_date TEXT NOT NULL, label TEXT, opened_at TEXT DEFAULT (datetime('now')),
                  closed_at TEXT, cook_id TEXT, location_id TEXT NOT NULL DEFAULT 'default');
                CREATE TABLE inventory_count_lines (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  count_id INTEGER NOT NULL, vendor TEXT, ingredient TEXT NOT NULL,
                  sku TEXT NOT NULL DEFAULT '', on_hand_qty REAL, unit TEXT, par_qty REAL,
                  par_unit TEXT, note TEXT, counted_by TEXT,
                  counted_at TEXT DEFAULT (datetime('now')), location_id TEXT NOT NULL DEFAULT 'default');
                CREATE TABLE sales_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, period_label TEXT,
                  item_name TEXT NOT NULL, quantity_sold REAL, net_sales REAL, source TEXT,
                  location_id TEXT DEFAULT 'default', imported_at TEXT DEFAULT (datetime('now')));
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    private func seedTwoPeriods(_ db: Database, loc: String = "default") throws {
        try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,theoretical_cogs,actual_cogs,variance_amount,variance_pct,location_id) VALUES ('2026-04-18','2026-05-01',1000,1020,20,2,?)", arguments: [loc])
        try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,theoretical_cogs,actual_cogs,variance_amount,variance_pct,location_id) VALUES ('2026-05-02','2026-05-15',1000,1055,55,5.5,?)", arguments: [loc])
    }

    // Oracle GET happy path: Avocado 10→12 in-window → price_moves.count == 1, window (05-01,05-15].
    func testDefaultWindowWithPriceMove() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db)
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('default','sysco','AVO-1','Avocado',10,'2026-05-03 08:00:00')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('default','sysco','AVO-1','Avocado',12,'2026-05-10 12:00:00')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(r.priceMoves.count, 1)
        XCTAssertEqual(r.priceMoves[0].ingredient, "Avocado")
        XCTAssertEqual(r.variance.deltaPct, 3.5)
        XCTAssertFalse(r.caveat.isEmpty)
    }

    // Oracle: explicit missing period → ok:false, reason mentions the date, sections empty.
    func testExplicitMissingPeriodFails() async throws {
        let (db, dir) = try makeDB { db in try self.seedTwoPeriods(db) }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load(from: "2026-01-01", to: "2026-05-15")
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason!.contains("2026-01-01"))
        XCTAssertEqual(r.priceMoves.count, 0)
        XCTAssertTrue(r.unattributed)
    }

    // Oracle: "honors explicit from/to period_end overrides" happy path.
    func testExplicitWindowOverrideOk() async throws {
        let (db, dir) = try makeDB { db in
            try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,theoretical_cogs,actual_cogs,variance_amount,variance_pct,location_id) VALUES ('2026-04-04','2026-04-17',1000,1010,10,1,'default')")
            try self.seedTwoPeriods(db)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load(from: "2026-04-17", to: "2026-05-01")
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.window, VarianceAttrWindow(from: "2026-04-17", to: "2026-05-01"))
        XCTAssertEqual(r.variance.baseline?.periodEnd, "2026-04-17")
        XCTAssertEqual(r.variance.current?.periodEnd, "2026-05-01")
    }

    // Oracle: empty DB → ok:false, "two variance periods" reason.
    func testEmptyDbFails() async throws {
        let (db, dir) = try makeDB { _ in }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason!.contains("two variance periods"))
        XCTAssertEqual(r.window, VarianceAttrWindow(from: nil, to: nil))
        XCTAssertEqual(r.compositionChanges.count, 0)
        XCTAssertEqual(r.countCorrections.count, 0)
        XCTAssertFalse(r.caveat.isEmpty)
    }

    // Oracle count_corrections: closed count + 2 in-window audits (reopen + line update),
    // out-of-window close excluded, unrelated entity excluded.
    func testCountCorrectionsSection() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db)
            try db.execute(sql: "INSERT INTO audit_events (shift_date,location_id,actor_cook_id,actor_source,entity,entity_id,action,payload_json,created_at) VALUES ('2026-05-10','default','cook-1','api','inventory_counts',1,'update','{\"transition\":\"reopen\"}','2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO audit_events (shift_date,location_id,actor_cook_id,actor_source,entity,entity_id,action,payload_json,created_at) VALUES ('2026-05-10','default','cook-2','api','inventory_count_lines',1,'update',NULL,'2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO audit_events (shift_date,location_id,actor_cook_id,actor_source,entity,entity_id,action,payload_json,created_at) VALUES ('2026-04-20','default','cook-1','api','inventory_counts',1,'update','{\"transition\":\"close\"}','2026-04-20 12:00:00')")
            // Unrelated entity — never a count correction.
            try db.execute(sql: "INSERT INTO audit_events (shift_date,location_id,actor_cook_id,actor_source,entity,entity_id,action,created_at) VALUES ('2026-05-10','default','cook-1','api','eighty_six',1,'update','2026-05-10 12:00:00')")
            // Gap-fix: action filter — 'insert'/'view' rows must be excluded even for the
            // right entity + in-window (lib SQL `action IN ('update','correction','delete')`).
            try db.execute(sql: "INSERT INTO audit_events (shift_date,location_id,actor_cook_id,actor_source,entity,entity_id,action,created_at) VALUES ('2026-05-10','default','cook-1','api','inventory_counts',1,'insert','2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO inventory_counts (count_date,label,closed_at,location_id) VALUES ('2026-05-09','Weekly walk-in','2026-05-10 12:00:00','default')")
            let countId = try Int64.fetchOne(db, sql: "SELECT last_insert_rowid()")!
            for i in 0..<3 {
                try db.execute(sql: "INSERT INTO inventory_count_lines (count_id,vendor,ingredient,sku,on_hand_qty,unit,location_id) VALUES (?, 'sysco', ?, '', 1, 'lb', 'default')", arguments: [countId, "ing-\(i)"])
            }
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.countCorrections.count, 3)
        XCTAssertEqual(r.countCorrections[0].kind, "count_closed")
        XCTAssertEqual(r.countCorrections[0].label, "Weekly walk-in")
        XCTAssertEqual(r.countCorrections[0].lines, 3)
        let kinds = r.countCorrections.map(\.kind).sorted()
        XCTAssertEqual(kinds, ["audit", "audit", "count_closed"])
        let reopen = r.countCorrections.first { $0.transition == "reopen" }
        XCTAssertEqual(reopen?.entity, "inventory_counts")
    }

    // Oracle composition_changes + unresolved_depletions together.
    func testCompositionAndUnresolvedSections() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db)
            try db.execute(sql: "INSERT INTO dish_components (location_id,dish_name,component_type,vendor_ingredient,qty_per_serving,unit,created_at,updated_at) VALUES ('default','New Dish','vendor_item','Halibut',1,'ea','2026-05-10 12:00:00','2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO dish_components (location_id,dish_name,component_type,recipe_slug,qty_per_serving,unit,created_at,updated_at) VALUES ('default','Edited Dish','recipe','salsa-verde',1,'ea','2026-01-01 00:00:00','2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO dish_components (location_id,dish_name,component_type,vendor_ingredient,qty_per_serving,unit,created_at,updated_at) VALUES ('default','Old Dish','vendor_item','Flour',1,'ea','2026-04-20 12:00:00','2026-04-20 12:00:00')")
            try db.execute(sql: "INSERT INTO dish_components (location_id,dish_name,component_type,vendor_ingredient,qty_per_serving,unit,created_at,updated_at) VALUES ('default','Guac Bowl','vendor_item','Avocado',1,'ea','2026-01-01 00:00:00','2026-01-01 00:00:00')")
            try db.execute(sql: "INSERT INTO sales_lines (period_label,item_name,quantity_sold,net_sales,location_id) VALUES ('2026-05-08','Mystery Burger',4,60,'default')")
            try db.execute(sql: "INSERT INTO sales_lines (period_label,item_name,quantity_sold,net_sales,location_id) VALUES ('2026-04-15','Mystery Burger',9,135,'default')")
            try db.execute(sql: "INSERT INTO sales_lines (period_label,item_name,quantity_sold,net_sales,location_id) VALUES ('2026-05-08','Guac Bowl',2,24,'default')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.compositionChanges.count, 2)
        let byDish = Dictionary(uniqueKeysWithValues: r.compositionChanges.map { ($0.dishName, $0) })
        XCTAssertEqual(byDish["New Dish"]?.changeKind, "created")
        XCTAssertEqual(byDish["Edited Dish"]?.changeKind, "updated")
        XCTAssertNil(byDish["Old Dish"])

        XCTAssertEqual(r.unresolvedDepletions.count, 1)
        XCTAssertEqual(r.unresolvedDepletions[0].itemName, "Mystery Burger")
        XCTAssertEqual(r.unresolvedDepletions[0].periodLabel, "2026-05-08")
        XCTAssertNil(r.unresolvedNote)
    }

    // Oracle: falls back to all-time with honest note when period_labels are not date-like.
    func testUnresolvedAllTimeFallbackNote() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db)
            try db.execute(sql: "INSERT INTO sales_lines (period_label,item_name,quantity_sold,net_sales,location_id) VALUES ('Lunch FY26','Legacy Item',7,70,'default')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.unresolvedDepletions.count, 1)
        XCTAssertEqual(r.unresolvedDepletions[0].itemName, "Legacy Item")
        XCTAssertTrue(r.unresolvedNote!.contains("not date-like"))
    }

    // Oracle cross-location isolation (kitchen-a) — window and every section scoped.
    func testCrossLocationIsolation() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db, loc: "kitchen-a")
            try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,variance_amount,variance_pct,location_id) VALUES ('2026-05-02','2026-05-20',90,9,'kitchen-b')")
            try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,variance_amount,variance_pct,location_id) VALUES ('2026-04-18','2026-05-01',10,1,'kitchen-b')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('kitchen-a','sysco','AVO-1','Avocado',10,'2026-05-03 08:00:00')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('kitchen-a','sysco','AVO-1','Avocado',12,'2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO sales_lines (item_name,period_label,quantity_sold,net_sales,location_id) VALUES ('A Burger','2026-05-08',2,20,'kitchen-a')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let r = try await VarianceAttributionRepository(database: db, locationId: "kitchen-a").load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(r.priceMoves.count, 1)
        XCTAssertEqual(r.unresolvedDepletions.count, 1)
        XCTAssertEqual(r.unresolvedDepletions[0].itemName, "A Burger")
    }
}
