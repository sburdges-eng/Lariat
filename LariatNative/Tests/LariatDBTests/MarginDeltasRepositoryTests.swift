import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// SQL-layer parity with the web oracle `tests/js/test-margin-deltas.mjs`.
/// Covers the cases that depend on the two SQL reads (`dish_components` +
/// `vendor_prices_history`): location scoping and the runtime-relative
/// windowDays clamp. The algorithm cases are covered by
/// `MarginDeltasComputeTests`.
final class MarginDeltasRepositoryTests: XCTestCase {

    // Build a temp WAL SQLite file with just the two tables the repo reads,
    // seeded via a writer DatabasePool, then reopened read-only through
    // LariatDatabase (mirrors seedFixtureDatabase()). Returns (db, dir); the
    // caller deletes dir. NO native migration — these are web-owned tables the
    // harness recreates only for the test.
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-margin-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)  // establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
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

                CREATE TABLE vendor_prices_history (
                  id              INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient      TEXT,
                  vendor          TEXT,
                  sku             TEXT,
                  pack_size       REAL,
                  pack_unit       TEXT,
                  pack_price      REAL,
                  unit_price      REAL,
                  category        TEXT,
                  location_id     TEXT NOT NULL DEFAULT 'default',
                  snapshot_at     TEXT,
                  snapshot_reason TEXT,
                  run_id          INTEGER);
                """)
            try seed(db)
        }
        // writer deinits, closing the pool; WAL persists so a read-only pool can open it.
        return (try LariatDatabase(path: path), dir)
    }

    // ── seed helpers mirroring the oracle's inserts ─────────────────────────

    private func insertSnapshot(_ db: Database, vendor: String, sku: String, ingredient: String,
                                unitPrice: Double, daysAgo: Int, locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices_history
              (location_id, vendor, sku, ingredient, pack_size, pack_unit, pack_price,
               unit_price, category, snapshot_at, snapshot_reason)
            VALUES (?, ?, ?, ?, 1, 'lb', ?, ?, NULL, datetime('now', ?), 'test')
            """, arguments: [locationId, vendor, sku, ingredient, unitPrice, unitPrice, "-\(daysAgo) days"])
    }

    private func insertVendorComponent(_ db: Database, dish: String, ingredient: String,
                                       qty: Double, locationId: String = "default") throws {
        try db.execute(sql: """
            INSERT INTO dish_components
              (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit)
            VALUES (?, ?, 'vendor_item', ?, ?, 'lb')
            """, arguments: [locationId, dish, ingredient, qty])
    }

    // ── tests ───────────────────────────────────────────────────────────────

    /// Oracle: "scopes dish_components and snapshots by location_id".
    /// kitchen-a moves 100 → 200 (+100%); kitchen-b barely moves (100 → 100.5,
    /// +0.5%, below 5% gate) → a:1 row, b:0 rows.
    func testLocationScoping() async throws {
        let (db, dir) = try makeDB { db in
            // kitchen-a: 100 → 200
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100, daysAgo: 5, locationId: "kitchen-a")
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 200, daysAgo: 0, locationId: "kitchen-a")
            try self.insertVendorComponent(db, dish: "Dish A", ingredient: "X", qty: 1, locationId: "kitchen-a")
            // kitchen-b: 100 → 100.5
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100, daysAgo: 5, locationId: "kitchen-b")
            try self.insertSnapshot(db, vendor: "v", sku: "X", ingredient: "X", unitPrice: 100.5, daysAgo: 0, locationId: "kitchen-b")
            try self.insertVendorComponent(db, dish: "Dish A", ingredient: "X", qty: 1, locationId: "kitchen-b")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repoA = MarginDeltasRepository(database: db, locationId: "kitchen-a")
        let repoB = MarginDeltasRepository(database: db, locationId: "kitchen-b")
        let a = try await repoA.load(options: MarginDeltaOptions(locationId: "kitchen-a", windowDays: 7, minPctMove: 5))
        let b = try await repoB.load(options: MarginDeltaOptions(locationId: "kitchen-b", windowDays: 7, minPctMove: 5))
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(b.count, 0)
    }

    /// Oracle: "clamps windowDays to [1, 90]".
    /// Snapshot 40 days ago; only a 90-day window can see it.
    ///  windowDays:0 → default 7 → 40-day snapshot invisible → 0 rows.
    ///  windowDays:9999 → clamp 90 → baseline visible → 1 row, baseline_cost 100.
    func testWindowDaysClamp() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 100, daysAgo: 40)
            try self.insertSnapshot(db, vendor: "v", sku: "A", ingredient: "A", unitPrice: 200, daysAgo: 0)
            try self.insertVendorComponent(db, dish: "Dish A", ingredient: "A", qty: 1)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MarginDeltasRepository(database: db, locationId: "default")
        let zero = try await repo.load(options: MarginDeltaOptions(locationId: "default", windowDays: 0, minPctMove: 5))
        XCTAssertEqual(zero.count, 0)

        let huge = try await repo.load(options: MarginDeltaOptions(locationId: "default", windowDays: 9999, minPctMove: 5))
        XCTAssertEqual(huge.count, 1)
        XCTAssertEqual(huge[0].baselineCost, 100, accuracy: 1e-9)
    }

    /// End-to-end happy path through the Command-tile convenience:
    /// one up-mover (0.50 → 0.60, +20%) → MoveSummary(total:1, up:1, down:0).
    /// Uses the summary() defaults (7 / 5 / 100) that Command passes.
    func testSummaryCountsUpDownTotal() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertSnapshot(db, vendor: "sysco", sku: "BUN-1", ingredient: "Brioche Bun", unitPrice: 0.50, daysAgo: 6)
            try self.insertSnapshot(db, vendor: "sysco", sku: "BUN-1", ingredient: "Brioche Bun", unitPrice: 0.60, daysAgo: 0)
            try self.insertVendorComponent(db, dish: "Cheeseburger", ingredient: "Brioche Bun", qty: 1)
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let repo = MarginDeltasRepository(database: db, locationId: "default")
        let summary = try await repo.summary()
        XCTAssertEqual(summary.total, 1)
        XCTAssertEqual(summary.up, 1)
        XCTAssertEqual(summary.down, 0)
    }
}
