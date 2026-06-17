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
            // ── P0 tables ──────────────────────────────────────────────────────
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

            // ── P1a tables ─────────────────────────────────────────────────────
            //
            // Source files consulted for table + column names:
            //   app/analytics/page.jsx     → toast_sales_daily, toast_sales_dow,
            //                                toast_sales_hour, spend_monthly, sales_lines
            //   lib/commandCenter.ts       → eighty_six, staff_certifications,
            //                                cleaning_schedule (plus toast_sales_daily reuse)
            //   lib/vendorPricesRepo.ts    → vendor_prices_history (listPriceShocks)
            //   lib/costingBenchmarks.mjs  → ingest_runs (readLastCostingIngest)
            //   lib/depletionExceptions.ts → sales_lines (listDepletionExceptions)
            //
            // Known fixture values (parity tests T6–T10 reference these):
            //   toast_sales_daily:
            //     comparison_group=1  shift_date='2026-06-15'  net_sales=4200.0  orders=180  guests=230
            //     comparison_group=1  shift_date='2026-06-14'  net_sales=3900.0  orders=165  guests=205
            //     comparison_group=2  (prior period)           net_sales=3800.0  orders=160  guests=198
            //   toast_sales_dow:
            //     comparison_group=1  day_of_week=0  net_sales=4200.0  orders=180  guests=230
            //     comparison_group=2  day_of_week=0  net_sales=3800.0  orders=160  guests=198
            //   toast_sales_hour:
            //     comparison_group=1  hour_24=18  label='6 PM'  net_sales=1200.0  orders=52  guests=68
            //     comparison_group=2  hour_24=18  label='6 PM'  net_sales=1100.0  orders=48  guests=62
            //   spend_monthly:
            //     month='2026-05'  shamrock_total_spend=14200.0
            //     month='2026-04'  shamrock_total_spend=13500.0
            //   sales_lines:
            //     item_name='Burger'   quantity_sold=40  net_sales=600.0  period_label='2026-W24'
            //     item_name='Tacos'    quantity_sold=25  net_sales=375.0  period_label='2026-W24'
            //     item_name='MysteryX' quantity_sold=5   net_sales=75.0   period_label='2026-W24'
            //       (MysteryX has no dish_components mapping → triggers depletion exception)
            //   eighty_six:
            //     shift_date='2026-06-16'  item='Lobster Bisque'  resolved_at=NULL  (unresolved → count=1)
            //     shift_date='2026-06-16'  item='Mahi'            resolved_at='2026-06-16 14:00:00' (resolved → not counted)
            //   staff_certifications:
            //     expires_on='2026-05-01'  active=1  (already expired → cert_expired=1)
            //     expires_on='2026-07-01'  active=1  (within 30 days of 2026-06-16 → cert_expiring_30d=1)
            //     expires_on='2027-01-01'  active=1  (far future → not counted)
            //   cleaning_schedule:
            //     next_due='2026-06-15'  active=1  archived_at=NULL  (past → overdue=1)
            //     next_due='2026-06-16'  active=1  archived_at=NULL  (today → due_today=1)
            //     next_due='2026-06-20'  active=1  archived_at=NULL  (future → neither)
            //   vendor_prices_history:
            //     vendor='Sysco' sku='F001' ingredient='Chicken Breast' unit_price=3.50
            //       snapshot_at=datetime('now','-5 days')  (baseline; exact ISO string is runtime-determined)
            //     vendor='Sysco' sku='F001' ingredient='Chicken Breast' unit_price=3.85
            //       snapshot_at=datetime('now','-1 day')   (latest; delta≈+10% and direction remain fixed)
            //     Both rows stay permanently inside the 7-day listPriceShocks window.
            //   ingest_runs:
            //     kind='costing'  started_at=datetime('now','-2 hours')  status='ok'  rows_in=200  rows_out=195
            //     age_minutes is runtime-relative; downstream parity tests should assert age_minutes >= 0

            try db.execute(sql: """
                -- analytics/page.jsx: daily revenue trend
                CREATE TABLE toast_sales_daily (
                  id               INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id      TEXT NOT NULL DEFAULT 'default',
                  shift_date       TEXT NOT NULL,
                  net_sales        REAL,
                  orders           INTEGER,
                  guests           INTEGER,
                  comparison_group INTEGER NOT NULL DEFAULT 1,
                  date_range       TEXT);

                INSERT INTO toast_sales_daily
                  (location_id, shift_date, net_sales, orders, guests, comparison_group, date_range)
                VALUES
                  -- current period (comparison_group=1), two rows for avg7 and yesterday lookups
                  ('default', '2026-06-15', 4200.0, 180, 230, 1, '2026-06-09 to 2026-06-15'),
                  ('default', '2026-06-14', 3900.0, 165, 205, 1, '2026-06-09 to 2026-06-15'),
                  -- prior period (comparison_group=2) for YoY delta
                  ('default', '2026-06-15', 3800.0, 160, 198, 2, '2025-06-09 to 2025-06-15');

                -- analytics/page.jsx: day-of-week comparison
                CREATE TABLE toast_sales_dow (
                  id               INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id      TEXT NOT NULL DEFAULT 'default',
                  day_of_week      INTEGER NOT NULL,
                  net_sales        REAL,
                  orders           INTEGER,
                  guests           INTEGER,
                  comparison_group INTEGER NOT NULL DEFAULT 1);

                INSERT INTO toast_sales_dow
                  (location_id, day_of_week, net_sales, orders, guests, comparison_group)
                VALUES
                  ('default', 0, 4200.0, 180, 230, 1),
                  ('default', 0, 3800.0, 160, 198, 2);

                -- analytics/page.jsx: hourly revenue curve
                CREATE TABLE toast_sales_hour (
                  id               INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id      TEXT NOT NULL DEFAULT 'default',
                  hour_24          INTEGER NOT NULL,
                  label            TEXT,
                  net_sales        REAL,
                  orders           INTEGER,
                  guests           INTEGER,
                  comparison_group INTEGER NOT NULL DEFAULT 1);

                INSERT INTO toast_sales_hour
                  (location_id, hour_24, label, net_sales, orders, guests, comparison_group)
                VALUES
                  ('default', 18, '6 PM', 1200.0, 52, 68, 1),
                  ('default', 18, '6 PM', 1100.0, 48, 62, 2);

                -- analytics/page.jsx: monthly Shamrock spend
                CREATE TABLE spend_monthly (
                  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id          TEXT NOT NULL DEFAULT 'default',
                  month                TEXT NOT NULL,
                  shamrock_total_spend REAL);

                INSERT INTO spend_monthly (location_id, month, shamrock_total_spend)
                VALUES
                  ('default', '2026-05', 14200.0),
                  ('default', '2026-04', 13500.0);

                -- analytics/page.jsx + depletionExceptions.ts: sales lines
                -- MysteryX has no dish_components mapping and is used to seed a depletion exception.
                CREATE TABLE sales_lines (
                  id            INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id   TEXT NOT NULL DEFAULT 'default',
                  item_name     TEXT,
                  quantity_sold REAL,
                  net_sales     REAL,
                  period_label  TEXT,
                  imported_at   TEXT);

                INSERT INTO sales_lines
                  (location_id, item_name, quantity_sold, net_sales, period_label, imported_at)
                VALUES
                  ('default', 'Burger',   40, 600.0, '2026-W24', '2026-06-16 08:00:00'),
                  ('default', 'Tacos',    25, 375.0, '2026-W24', '2026-06-16 08:00:00'),
                  -- MysteryX: no dish_components row → depletion exception expected
                  ('default', 'MysteryX',  5,  75.0, '2026-W24', '2026-06-16 08:00:00');

                -- commandCenter.ts: 86'd items
                -- Lobster Bisque is unresolved on 2026-06-16 → eighty_six count = 1
                CREATE TABLE eighty_six (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  item        TEXT,
                  resolved_at TEXT);

                INSERT INTO eighty_six (location_id, shift_date, item, resolved_at)
                VALUES
                  ('default', '2026-06-16', 'Lobster Bisque', NULL),
                  ('default', '2026-06-16', 'Mahi',           '2026-06-16 14:00:00');

                -- commandCenter.ts: staff certifications
                -- Row 1 expires 2026-05-01 → already expired as of 2026-06-16 (cert_expired=1)
                -- Row 2 expires 2026-07-01 → within 30 days of 2026-06-16 (cert_expiring_30d=1)
                -- Row 3 expires 2027-01-01 → far future, not counted
                CREATE TABLE staff_certifications (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  staff_name  TEXT,
                  cert_type   TEXT,
                  expires_on  TEXT,
                  active      INTEGER NOT NULL DEFAULT 1);

                INSERT INTO staff_certifications
                  (location_id, staff_name, cert_type, expires_on, active)
                VALUES
                  ('default', 'Alice',   'ServSafe', '2026-05-01', 1),
                  ('default', 'Bob',     'ServSafe', '2026-07-01', 1),
                  ('default', 'Charlie', 'ServSafe', '2027-01-01', 1);

                -- commandCenter.ts: cleaning schedule
                -- Row 1 next_due='2026-06-15' → past as of 2026-06-16 → overdue=1
                -- Row 2 next_due='2026-06-16' → today → due_today=1
                -- Row 3 next_due='2026-06-20' → future → neither
                CREATE TABLE cleaning_schedule (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  task        TEXT,
                  next_due    TEXT,
                  active      INTEGER NOT NULL DEFAULT 1,
                  archived_at TEXT);

                INSERT INTO cleaning_schedule
                  (location_id, task, next_due, active, archived_at)
                VALUES
                  ('default', 'Deep-clean fryer',   '2026-06-15', 1, NULL),
                  ('default', 'Sanitize ice machine','2026-06-16', 1, NULL),
                  ('default', 'Hood exhaust check',  '2026-06-20', 1, NULL);

                -- vendorPricesRepo.ts (listPriceShocks): vendor price history
                -- Two snapshots for Sysco/F001; both permanently within the 7-day window via relative offsets.
                -- baseline_unit_price=3.50 @ now-5d, latest_unit_price=3.85 @ now-1d → delta ≈ +10% (up shock)
                CREATE TABLE vendor_prices_history (
                  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                  source_vendor_price_id INTEGER,
                  ingredient             TEXT,
                  vendor                 TEXT,
                  sku                    TEXT,
                  pack_size              REAL,
                  pack_unit              TEXT,
                  pack_price             REAL,
                  unit_price             REAL,
                  category               TEXT,
                  yield_pct              REAL,
                  actual_received_lb     REAL,
                  reconciled_unit_price  REAL,
                  master_id              TEXT,
                  location_id            TEXT NOT NULL DEFAULT 'default',
                  imported_at            TEXT,
                  snapshot_at            TEXT,
                  snapshot_reason        TEXT,
                  run_id                 INTEGER);

                INSERT INTO vendor_prices_history
                  (location_id, vendor, sku, ingredient, pack_size, pack_unit,
                   pack_price, unit_price, category, snapshot_at, snapshot_reason)
                VALUES
                  -- baseline snapshot: now-5 days, unit_price=3.50
                  ('default', 'Sysco', 'F001', 'Chicken Breast',
                   40.0, 'lb', 140.0, 3.50, 'protein', datetime('now', '-5 days'), 'ingest'),
                  -- latest snapshot: now-1 day, unit_price=3.85 → delta ≈ +10%
                  ('default', 'Sysco', 'F001', 'Chicken Breast',
                   40.0, 'lb', 154.0, 3.85, 'protein', datetime('now', '-1 day'), 'ingest');

                -- costingBenchmarks.mjs (readLastCostingIngest): ingest run log
                -- One 'costing' run completed successfully; started_at is runtime-relative (now-2h).
                -- ingest_runs has no location_id column; scoped at application layer
                CREATE TABLE ingest_runs (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  kind        TEXT NOT NULL,
                  started_at  TEXT NOT NULL,
                  finished_at TEXT,
                  rows_in     INTEGER,
                  rows_out    INTEGER,
                  status      TEXT);

                -- ingest_runs has no location_id column; scoped at application layer
                INSERT INTO ingest_runs (kind, started_at, finished_at, rows_in, rows_out, status)
                VALUES ('costing', datetime('now', '-2 hours'), datetime('now', '-118 minutes'), 200, 195, 'ok');
                """)
        }
        // writer deinits here, closing the pool; WAL mode persists in the file.
    }
    return path
}
