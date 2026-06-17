import Foundation
import GRDB

/// Creates a temp WAL SQLite file seeded with the P0 rollup tables + rows.
/// WAL is required so a read-only DatabasePool can open it (matches production).
/// Returns the file path; caller deletes the containing dir.
func seedFixtureDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-fixture-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    do {
        let writer = try DatabasePool(path: path)   // DatabasePool establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE accounting_variance (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL,
                  snapshot_at TEXT);
                CREATE TABLE dish_coverage_snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
                  total_dishes INTEGER, covered_dishes INTEGER, coverage_pct REAL,
                  uncovered_dishes TEXT, created_by TEXT, snapshot_at TEXT);
                CREATE TABLE pack_size_changes (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT NOT NULL, sku TEXT NOT NULL,
                  prev_pack TEXT, new_pack TEXT, prev_price REAL, new_price REAL,
                  detected_at TEXT, acknowledged INTEGER DEFAULT 0);
                INSERT INTO accounting_variance (location_id, theoretical_cogs, actual_cogs, variance_amount, variance_pct, snapshot_at)
                  VALUES ('default', 1000.0, 1120.0, 120.0, 12.0, '2026-06-15 10:00:00'),
                         ('default', 900.0, 950.0, 50.0, 5.5, '2026-06-16 10:00:00');
                INSERT INTO dish_coverage_snapshots (location_id, total_dishes, covered_dishes, coverage_pct, uncovered_dishes, created_by, snapshot_at)
                  VALUES ('default', 73, 70, 95.9, '["soup","amuse"]', 'compute_engine', '2026-06-16 10:00:00');
                INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, prev_price, new_price, detected_at, acknowledged)
                  VALUES ('Sysco','A1','6x#10','4x#10',40,38,'2026-06-16',0),
                         ('Sysco','A2','1cs','1cs',20,21,'2026-06-16',1);
                """)
        }
        // writer deinits here, closing the pool; WAL mode persists in the file.
    }
    return path
}
