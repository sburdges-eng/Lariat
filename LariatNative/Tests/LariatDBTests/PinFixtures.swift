import Foundation
import GRDB
@testable import LariatDB

/// Temp on-disk fixture with the EXISTING web schema for the A5 pin boards —
/// `manager_pin_users`, `temp_pins`, `audit_events` verbatim from `lib/db.ts`
/// (schema is read as-is; no migrations). Never touches data/lariat.db.
func seedPinDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-pin-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE manager_pin_users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              name TEXT NOT NULL,
              pin_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'manager'
                CHECK(role IN ('manager','owner')),
              is_active INTEGER NOT NULL DEFAULT 1
                CHECK(is_active IN (0,1)),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              disabled_at TEXT
            );
            CREATE UNIQUE INDEX idx_manager_pin_users_active_pin
              ON manager_pin_users(location_id, pin_hash)
              WHERE is_active = 1;
            CREATE TABLE temp_pins (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              pin_hash TEXT NOT NULL UNIQUE,
              label TEXT NOT NULL,
              scopes_json TEXT NOT NULL,
              issued_by TEXT,
              issued_at TEXT NOT NULL DEFAULT (datetime('now')),
              expires_at TEXT NOT NULL,
              revoked_at TEXT
            );
            CREATE INDEX idx_temp_pins_active
              ON temp_pins(location_id, expires_at)
              WHERE revoked_at IS NULL;
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              shift_date TEXT,
              location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}

func makePinRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
    let path = try seedPinDatabase()
    let readDB = try LariatDatabase(path: path)
    let writeDB = try LariatWriteDatabase(path: path)
    return (readDB, writeDB, path)
}

func cleanupPinFixture(_ path: String) {
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.removeItem(atPath: dir)
}
