import Foundation
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Shared fixture for the A6.5 BEO tests. Creates a temp WAL SQLite file with
/// the REAL web DDL (post-migration shape) for every table the BEO boards
/// touch:
///   beo_events       (lib/db.ts:1619 + the ALTER-added min_spend/share_* cols)
///   beo_courses      (lib/db.ts:2980 + ALTER-added station_id)
///   beo_line_items   (lib/db.ts:1638 + ALTER-added prep-sheet cols and the
///                     course_id FK, ON DELETE SET NULL)
///   beo_prep_tasks   (lib/db.ts:1651)
///   beo_prep_history (lib/db.ts:1668)
///   audit_events     (lib/db.ts audit table)
/// Schema is read as-is — no native migrations; the fixture only mirrors DDL.
/// The web's real `beo_events` uses `title` (NOT the Command-Center rollup
/// fixture's `name`), hence a dedicated fixture DB per suite.
func seedBeoDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-beo-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let pool = try DatabasePool(path: path)   // DatabasePool establishes WAL mode
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE beo_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              event_date TEXT,
              event_time TEXT,
              contact_name TEXT,
              guest_count INTEGER,
              notes TEXT,
              status TEXT DEFAULT 'planned',
              tax_rate REAL DEFAULT 0.0675,
              service_fee_pct REAL DEFAULT 20,
              min_spend REAL,
              share_token TEXT,
              share_expires_at TEXT,
              share_revoked_at TEXT,
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX idx_beo_events_share_token
              ON beo_events(share_token) WHERE share_token IS NOT NULL;

            CREATE TABLE beo_courses (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              location_id TEXT NOT NULL DEFAULT 'default',
              course_label TEXT NOT NULL,
              fire_at TEXT NOT NULL,
              notes TEXT,
              sort_order INTEGER DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              station_id TEXT,
              FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_beo_courses_loc_fire ON beo_courses(location_id, fire_at);
            CREATE INDEX idx_beo_courses_event ON beo_courses(event_id, sort_order);

            CREATE TABLE beo_line_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              sort_order INTEGER DEFAULT 0,
              item_name TEXT NOT NULL,
              category TEXT,
              unit_cost REAL NOT NULL DEFAULT 0,
              quantity REAL NOT NULL DEFAULT 1,
              created_at TEXT DEFAULT (datetime('now')),
              prep_notes TEXT,
              secondary_prep_notes TEXT,
              order_items_notes TEXT,
              order_time TEXT,
              group_note TEXT,
              course_id INTEGER REFERENCES beo_courses(id) ON DELETE SET NULL,
              FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_beo_line_ev ON beo_line_items(event_id);

            CREATE TABLE beo_prep_tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              task TEXT NOT NULL,
              due_date TEXT,
              done INTEGER DEFAULT 0,
              sort_order INTEGER DEFAULT 0,
              location_id TEXT DEFAULT 'default',
              FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_beo_prep_ev ON beo_prep_tasks(event_id);

            CREATE TABLE beo_prep_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              client TEXT,
              event_date TEXT,
              event_file TEXT,
              type TEXT,
              item TEXT NOT NULL,
              amount_qty TEXT,
              prep_day TEXT,
              pre_prep_notes TEXT,
              plating_notes TEXT,
              source TEXT NOT NULL,
              imported_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_beo_prep_hist_loc_date ON beo_prep_history(location_id, event_date);
            CREATE INDEX idx_beo_prep_hist_loc_item ON beo_prep_history(location_id, item);
            CREATE INDEX idx_beo_prep_hist_loc_source ON beo_prep_history(location_id, source);

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

/// Bundles the read/write handles the BEO tests need, plus seed helpers.
struct BeoFixture {
    let path: String
    let readDB: LariatDatabase
    let writeDB: LariatWriteDatabase

    static func make() throws -> BeoFixture {
        let path = try seedBeoDatabase()
        return BeoFixture(
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

    // ── seed helpers (mirror the JS fixtures) ────────────────────────────

    @discardableResult
    func seedEvent(
        title: String = "Hendricks Wedding",
        date: String? = "2026-05-04",
        location: String = "default"
    ) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO beo_events (title, event_date, location_id) VALUES (?, ?, ?)",
                arguments: [title, date, location]
            )
            return db.lastInsertedRowID
        }
    }

    @discardableResult
    func seedLineItem(
        eventId: Int64,
        item: String = "Smoked Brisket",
        qty: Double = 80,
        courseId: Int64? = nil
    ) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO beo_line_items (event_id, item_name, quantity, course_id) VALUES (?, ?, ?, ?)",
                arguments: [eventId, item, qty, courseId]
            )
            return db.lastInsertedRowID
        }
    }

    @discardableResult
    func seedCourse(
        eventId: Int64,
        label: String = "Entree",
        fireAt: String,
        station: String? = nil,
        location: String = "default"
    ) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_courses (event_id, location_id, course_label, fire_at, station_id)
                  VALUES (?, ?, ?, ?, ?)
                  """,
                arguments: [eventId, location, label, fireAt, station]
            )
            return db.lastInsertedRowID
        }
    }

    func seedPrepHistory(
        client: String? = "Acme",
        eventDate: String? = "2026-03-15",
        type: String? = "Main Item",
        item: String,
        amountQty: String? = "50",
        prepDay: String? = nil,
        prePrepNotes: String? = nil,
        platingNotes: String? = nil,
        source: String = "test_seed",
        location: String = "default"
    ) throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_prep_history
                    (location_id, client, event_date, type, item, amount_qty,
                     prep_day, pre_prep_notes, plating_notes, source)
                  VALUES (?,?,?,?,?,?,?,?,?,?)
                  """,
                arguments: [location, client, eventDate, type, item, amountQty,
                            prepDay, prePrepNotes, platingNotes, source]
            )
        }
    }

    // ── assertion helpers ────────────────────────────────────────────────

    func row(_ sql: String, _ arguments: StatementArguments = StatementArguments()) throws -> Row? {
        try writeDB.pool.read { db in try Row.fetchOne(db, sql: sql, arguments: arguments) }
    }

    func count(_ sql: String, _ arguments: StatementArguments = StatementArguments()) throws -> Int {
        try writeDB.pool.read { db in try Int.fetchOne(db, sql: sql, arguments: arguments) ?? 0 }
    }
}
