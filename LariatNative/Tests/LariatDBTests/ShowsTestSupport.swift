import Foundation
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Shared fixture for the A6.4 shows tests. Creates a temp WAL SQLite file
/// with the REAL web DDL for every table the shows boards touch:
///   locations            (lib/db.ts:1243 + the ALTER-added capacity column, db.ts:3686)
///   ingest_runs          (lib/db.ts — shows FK parent)
///   shows, shows_archive (lib/db.ts:1907/1922)
///   stage_setups         (lib/db.ts:1955)
///   sound_scenes         (lib/db.ts:1971)
///   spl_readings         (lib/db.ts:1991)
///   box_office_lines     (lib/db.ts:2004 + source CHECK + the partial
///                         UNIQUE index on (source, external_ref))
///   show_deals           (lib/db.ts:2039 + UNIQUE(show_id, location_id))
///   toast_sales_daily    (settlement Toast join)
///   audit_events         (lib/db.ts:2910)
/// Schema is read as-is — no native migrations; the fixture only mirrors DDL.
func seedShowsDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-shows-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let pool = try DatabasePool(path: path)   // DatabasePool establishes WAL mode
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE locations (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now')),
              capacity INTEGER
            );
            CREATE TABLE ingest_runs (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              kind        TEXT NOT NULL,
              started_at  TEXT NOT NULL,
              finished_at TEXT,
              rows_in     INTEGER,
              rows_out    INTEGER,
              status      TEXT
            );
            CREATE TABLE shows (
              id              INTEGER PRIMARY KEY,
              location_id     TEXT NOT NULL DEFAULT 'default',
              band_name       TEXT NOT NULL,
              show_date       TEXT NOT NULL,
              price           REAL,
              door_tix        TEXT,
              status_json     TEXT NOT NULL DEFAULT '{}',
              source_row      INTEGER NOT NULL,
              ingested_at     TEXT NOT NULL,
              ingest_run_id   INTEGER NOT NULL REFERENCES ingest_runs(id)
            );
            CREATE INDEX idx_shows_date ON shows(location_id, show_date);
            CREATE TABLE shows_archive (
              id            INTEGER PRIMARY KEY,
              location_id   TEXT NOT NULL DEFAULT 'default',
              band_name     TEXT NOT NULL,
              show_date     TEXT NOT NULL,
              era_year      INTEGER,
              source_row    INTEGER NOT NULL,
              ingested_at   TEXT NOT NULL,
              ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
            );
            CREATE TABLE stage_setups (
              id                     INTEGER PRIMARY KEY AUTOINCREMENT,
              show_id                INTEGER NOT NULL REFERENCES shows(id),
              location_id            TEXT NOT NULL DEFAULT 'default',
              room_config            TEXT NOT NULL,
              run_of_show_json       TEXT NOT NULL DEFAULT '[]',
              hospitality_rider_json TEXT NOT NULL DEFAULT '{}',
              tech_rider_json        TEXT NOT NULL DEFAULT '{}',
              notes                  TEXT,
              created_at             TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE (show_id, location_id)
            );
            CREATE TABLE sound_scenes (
              id               INTEGER PRIMARY KEY AUTOINCREMENT,
              show_id          INTEGER NOT NULL REFERENCES shows(id),
              location_id      TEXT NOT NULL DEFAULT 'default',
              scene_name       TEXT NOT NULL,
              plot_json        TEXT NOT NULL,
              spl_limit_db     REAL,
              notes            TEXT,
              saved_by_cook_id TEXT,
              saved_at         TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE spl_readings (
              id               INTEGER PRIMARY KEY AUTOINCREMENT,
              show_id          INTEGER NOT NULL REFERENCES shows(id),
              location_id      TEXT NOT NULL DEFAULT 'default',
              scene_id         INTEGER REFERENCES sound_scenes(id),
              db_value         REAL NOT NULL,
              taken_at         TEXT NOT NULL DEFAULT (datetime('now')),
              taken_by_cook_id TEXT,
              notes            TEXT
            );
            CREATE TABLE box_office_lines (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              show_id       INTEGER NOT NULL REFERENCES shows(id),
              location_id   TEXT NOT NULL DEFAULT 'default',
              source        TEXT NOT NULL CHECK (source IN ('dice','walkup','comp','will_call','guestlist')),
              ticket_class  TEXT,
              qty           INTEGER NOT NULL DEFAULT 1,
              face_price    REAL,
              fees          REAL,
              external_ref  TEXT,
              scanned_at    TEXT,
              notes         TEXT,
              created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX idx_box_office_external_ref_unique
              ON box_office_lines(source, external_ref)
              WHERE external_ref IS NOT NULL;
            CREATE TABLE show_deals (
              id                 INTEGER PRIMARY KEY AUTOINCREMENT,
              show_id            INTEGER NOT NULL REFERENCES shows(id),
              location_id        TEXT NOT NULL DEFAULT 'default',
              guarantee_cents    INTEGER NOT NULL DEFAULT 0,
              vs_pct_after_costs REAL,
              costs_off_top_json TEXT NOT NULL DEFAULT '[]',
              buyout_cents       INTEGER NOT NULL DEFAULT 0,
              notes              TEXT,
              updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
              updated_by_cook_id TEXT,
              UNIQUE (show_id, location_id)
            );
            CREATE TABLE toast_sales_daily (
              id               INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id      TEXT NOT NULL DEFAULT 'default',
              shift_date       TEXT NOT NULL,
              net_sales        REAL,
              orders           INTEGER,
              guests           INTEGER,
              comparison_group INTEGER NOT NULL DEFAULT 1,
              source           TEXT,
              date_range       TEXT
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
            INSERT INTO locations (id, name) VALUES ('default', 'Lariat'), ('satellite', 'Satellite');
            INSERT INTO ingest_runs (id, kind, started_at, status)
              VALUES (1, 'test', datetime('now'), 'ok');
            """)
    }
    return path
}

/// Bundles the read/write handles the shows tests need, a JSONL audit path,
/// and seed/read helpers.
struct ShowsFixture {
    let path: String
    let readDB: LariatDatabase
    let writeDB: LariatWriteDatabase
    let auditPath: String

    static func make() throws -> ShowsFixture {
        let path = try seedShowsDatabase()
        let auditPath = (path as NSString).deletingLastPathComponent + "/management-actions.jsonl"
        return ShowsFixture(
            path: path,
            readDB: try LariatDatabase(path: path),
            writeDB: try LariatWriteDatabase(path: path),
            auditPath: auditPath
        )
    }

    var auditLogger: ShowsAuditLogger { ShowsAuditLogger(auditPath: auditPath) }

    func seed(_ block: @escaping (Database) throws -> Void) throws {
        try writeDB.pool.write { db in try block(db) }
    }

    /// Insert one shows row (parents already seeded); returns its id.
    @discardableResult
    func insertShow(
        id: Int64? = nil, locationId: String = "default", band: String,
        date: String, price: Double? = nil, statusJson: String = "{}",
        sourceRow: Int = 1
    ) throws -> Int64 {
        var newId: Int64 = 0
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO shows
                    (id, location_id, band_name, show_date, price, status_json,
                     source_row, ingested_at, ingest_run_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
                  """,
                arguments: [id, locationId, band, date, price, statusJson, sourceRow]
            )
            newId = db.lastInsertedRowID
        }
        return newId
    }

    /// Parsed JSONL audit entries (file stream), oldest first.
    func fileAuditEntries() -> [[String: Any]] {
        guard let content = try? String(contentsOfFile: auditPath, encoding: .utf8) else { return [] }
        return content.split(separator: "\n").compactMap { line in
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }
            return obj
        }
    }

    func removeFileAudit() {
        try? FileManager.default.removeItem(atPath: auditPath)
    }

    func cleanup() {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}
