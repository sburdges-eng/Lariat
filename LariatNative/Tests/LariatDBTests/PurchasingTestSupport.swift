import Foundation
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Shared fixture for the A4.4 purchasing tests. Creates a temp WAL SQLite
/// file with the REAL web DDL for every table the purchasing boards touch:
///   vendor_prices        (lib/db.ts:1278 + the ALTER-added yield_pct /
///                         actual_received_lb / reconciled_unit_price /
///                         map_status / master_id columns, db.ts:3743-3747)
///   ingredient_maps      (lib/db.ts:1427)
///   ingredient_masters   (lib/db.ts:1445 — GLOBAL, no location_id)
///   ingredient_densities (lib/db.ts:1455)
///   order_guide_items    (lib/db.ts:1548)
///   audit_events         (lib/db.ts:2910)
/// Schema is read as-is — no native migrations; the fixture only mirrors DDL.
func seedPurchasingDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-purchasing-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let pool = try DatabasePool(path: path)   // DatabasePool establishes WAL mode
    try pool.write { db in
        try db.execute(sql: """
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
              imported_at TEXT DEFAULT (datetime('now')),
              yield_pct REAL,
              actual_received_lb REAL,
              reconciled_unit_price REAL,
              map_status TEXT,
              master_id TEXT
            );
            CREATE TABLE ingredient_maps (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipe_ingredient TEXT NOT NULL,
              vendor_ingredient TEXT,
              status TEXT,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE ingredient_masters (
              master_id           TEXT PRIMARY KEY,
              canonical_name      TEXT NOT NULL,
              category            TEXT,
              preferred_vendor    TEXT,
              quality_locked      INTEGER NOT NULL DEFAULT 0,
              quality_lock_reason TEXT,
              last_reviewed       TEXT
            );
            CREATE TABLE ingredient_densities (
              ingredient_key TEXT PRIMARY KEY,
              g_per_ml REAL NOT NULL,
              source TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
              updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE order_guide_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ingredient TEXT NOT NULL,
              base_qty REAL,
              unit TEXT,
              vendor TEXT,
              unit_price REAL,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now')),
              is_placeholder INTEGER DEFAULT 0
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

/// Bundles the read/write handles the purchasing tests need, plus a seed hook.
struct PurchasingFixture {
    let path: String
    let readDB: LariatDatabase
    let writeDB: LariatWriteDatabase

    static func make() throws -> PurchasingFixture {
        let path = try seedPurchasingDatabase()
        return PurchasingFixture(
            path: path,
            readDB: try LariatDatabase(path: path),
            writeDB: try LariatWriteDatabase(path: path)
        )
    }

    func seed(_ block: @escaping (Database) throws -> Void) throws {
        try writeDB.pool.write { db in try block(db) }
    }

    func cleanup() {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}
