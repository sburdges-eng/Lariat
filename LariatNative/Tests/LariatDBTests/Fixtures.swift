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
            //     shift_date=date('now')  item='Lobster Bisque'  resolved_at=NULL  (unresolved → count=1)
            //     shift_date=date('now')  item='Mahi'            resolved_at=datetime('now','-2 hours') (resolved → not counted)
            //   staff_certifications:
            //     expires_on='2026-05-01'  active=1  (already expired → cert_expired=1)
            //     expires_on='2026-07-01'  active=1  (within 30 days of 2026-06-16 → cert_expiring_30d=1)
            //     expires_on='2027-01-01'  active=1  (far future → not counted)
            //   cleaning_schedule:
            //     next_due=date('now','-1 day')  active=1  archived_at=NULL  (past → overdue=1)
            //     next_due=date('now')           active=1  archived_at=NULL  (today → due_today=1)
            //     next_due=date('now','+7 days') active=1  archived_at=NULL  (future → neither)
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
                -- Lobster Bisque is unresolved today (date('now')) → eighty_six count = 1
                -- Mahi is resolved today → not counted
                CREATE TABLE eighty_six (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  item        TEXT,
                  resolved_at TEXT);

                INSERT INTO eighty_six (location_id, shift_date, item, resolved_at)
                VALUES
                  ('default', date('now'), 'Lobster Bisque', NULL),
                  ('default', date('now'), 'Mahi',           datetime('now', '-2 hours'));

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
                -- Row 1 next_due=date('now','-1 day') → yesterday → overdue=1
                -- Row 2 next_due=date('now')          → today → due_today=1
                -- Row 3 next_due=date('now','+7 days') → future → neither
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
                  ('default', 'Deep-clean fryer',   date('now', '-1 day'), 1, NULL),
                  ('default', 'Sanitize ice machine', date('now'),          1, NULL),
                  ('default', 'Hood exhaust check',  date('now', '+7 days'), 1, NULL);

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

                -- vendorPricesRepo.ts (listPriceShocks): live vendor_prices table.
                -- listPriceShocks unions vendor_prices_history with vendor_prices (live overlay).
                -- Seeded empty so the UNION ALL in listPriceShocks does not fail; the two
                -- vendor_prices_history rows (baseline + latest) are sufficient to produce 1 shock.
                -- Known values: no live override → price shock comes entirely from history rows.
                CREATE TABLE vendor_prices (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient  TEXT NOT NULL,
                  vendor      TEXT,
                  sku         TEXT,
                  pack_size   REAL,
                  pack_unit   TEXT,
                  pack_price  REAL,
                  unit_price  REAL,
                  category    TEXT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                -- depletionExceptions.ts (listDepletionExceptions): dish_components table.
                -- Burger and Tacos each have one vendor_item component so resolveDepletionsForSale
                -- returns non-empty depletions and they are NOT counted as exceptions.
                -- MysteryX has no row here → its resolver returns unresolved[0].reason='no_dish_components'
                -- → depletion_exception_count = 1.
                --
                -- Known values added in T6:
                --   Burger   → vendor_item 'Ground Beef'   qty_per_serving=0.25 unit='lb'
                --   Tacos    → vendor_item 'Taco Shell'    qty_per_serving=2    unit='each'
                --   MysteryX → (no row)
                CREATE TABLE dish_components (
                  id               INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id      TEXT NOT NULL DEFAULT 'default',
                  dish_name        TEXT NOT NULL,
                  component_type   TEXT NOT NULL DEFAULT 'recipe'
                                     CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug      TEXT,
                  vendor_ingredient TEXT,
                  qty_per_serving  REAL NOT NULL,
                  unit             TEXT NOT NULL,
                  notes            TEXT,
                  created_at       TEXT DEFAULT (datetime('now')),
                  updated_at       TEXT DEFAULT (datetime('now')));

                INSERT INTO dish_components
                  (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit)
                VALUES
                  ('default', 'Burger', 'vendor_item', 'Ground Beef',  0.25, 'lb'),
                  ('default', 'Tacos',  'vendor_item', 'Taco Shell',   2.0,  'each');
                """)

            // ── Command Center tables (Task 7) ─────────────────────────────────
            //
            // All new tables use location_id='default' and runtime-relative dates
            // (date('now'), datetime('now', ...)) for shift_date-based queries so
            // tests work on any calendar day.
            //
            // Known fixture values referenced by CommandRepositoryTests:
            //   inventory_par: 3 items; 2 with par_qty set; 1 below par
            //   inventory_count_lines: Flour below par (on_hand=2 < par=5), Butter at par (on_hand=10 >= par=10)
            //   inventory_counts: 1 open (closed_at IS NULL), 1 closed
            //   shift_breaks: 2 rows for date('now') — 1 open break (ended_at NULL), 1 ended
            //   performance_reviews: 2 for date('now'), 1 for date('now','-1 day') → total=3
            //   temp_log: 2 rows for date('now') — 1 within range (38°F, 33–41), 1 out of range (55°F, 33–41)
            //   date_marks: 2 active — 1 expired (discard_on=date('now','-1 day')), 1 due today;
            //                1 discarded (should NOT appear in fetch)
            //   thermometer_calibrations: 2 rows with runtime-relative calibrated_at
            //   preshift_notes: 2 rows for date('now')
            //   beo_events: 1 active (guest_count=50), 1 cancelled — both for date('now')
            //   reservations: 5 status rows for date('now') — booked (c=2), seated, completed, no_show, cancelled
            //   prep_tasks: 5 rows for date('now') — 2 todo (priority 1 rush + priority 3), 1 in_progress, 1 done, 1 skipped
            //   inventory_updates: 2 waste rows for date('now'), 3 waste rows for date('now','-3 days'),
            //                       1 non-waste row for date('now') → wasteTodayCount=2, waste7dCount=5
            //   dining_tables: 4 tables — open (cap=4), seated (cap=6), dirty (cap=2), closed (cap=4)

            try db.execute(sql: """
                -- commandCenter.ts: inventory par levels
                CREATE TABLE inventory_par (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  ingredient  TEXT NOT NULL,
                  sku         TEXT,
                  par_qty     REAL,
                  unit        TEXT);

                -- 3 items: Flour (par=5), Butter (par=10), Salt (par_qty NULL — no par set)
                INSERT INTO inventory_par (location_id, ingredient, sku, par_qty, unit)
                VALUES
                  ('default', 'Flour',  'SKU-FLOUR',  5.0,  'lb'),
                  ('default', 'Butter', 'SKU-BUTTER', 10.0, 'lb'),
                  ('default', 'Salt',   'SKU-SALT',   NULL, 'lb');

                -- commandCenter.ts: inventory count lines (latest on-hand quantities)
                CREATE TABLE inventory_count_lines (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  ingredient  TEXT NOT NULL,
                  sku         TEXT,
                  on_hand_qty REAL,
                  counted_at  TEXT NOT NULL);

                -- Flour: on_hand=2 < par=5 → below par (counted today)
                -- Butter: on_hand=10 >= par=10 → at par (counted today)
                INSERT INTO inventory_count_lines (location_id, ingredient, sku, on_hand_qty, counted_at)
                VALUES
                  ('default', 'Flour',  'SKU-FLOUR',  2.0,  datetime('now')),
                  ('default', 'Butter', 'SKU-BUTTER', 10.0, datetime('now'));

                -- commandCenter.ts: inventory counts (open sessions)
                CREATE TABLE inventory_counts (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  started_at  TEXT,
                  closed_at   TEXT);

                -- 1 open count (closed_at IS NULL), 1 closed count
                INSERT INTO inventory_counts (location_id, started_at, closed_at)
                VALUES
                  ('default', datetime('now', '-1 hour'), NULL),
                  ('default', datetime('now', '-2 days'), datetime('now', '-1 day'));

                -- commandCenter.ts: shift break tracking
                CREATE TABLE shift_breaks (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  started_at  TEXT,
                  ended_at    TEXT,
                  waived      INTEGER NOT NULL DEFAULT 0);

                -- 2 rows for date('now'): 1 open break (ended_at NULL), 1 ended
                INSERT INTO shift_breaks (location_id, shift_date, started_at, ended_at, waived)
                VALUES
                  ('default', date('now'), datetime('now', '-30 minutes'), NULL, 0),
                  ('default', date('now'), datetime('now', '-2 hours'),    datetime('now', '-90 minutes'), 0);

                -- commandCenter.ts: performance reviews (web schema)
                CREATE TABLE performance_reviews (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  cook_name TEXT NOT NULL,
                  cook_uuid TEXT,
                  review_date TEXT NOT NULL,
                  punctuality_score INTEGER,
                  technique_score INTEGER,
                  speed_score INTEGER,
                  notes TEXT,
                  reviewer_name TEXT NOT NULL,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  created_at TEXT NOT NULL DEFAULT (datetime('now')));

                -- 2 for today, 1 for yesterday → total=3, today_count=2
                INSERT INTO performance_reviews (
                  location_id, cook_name, review_date,
                  punctuality_score, technique_score, speed_score, reviewer_name
                )
                VALUES
                  ('default', 'Alice', date('now'), 5, 4, 5, 'Chef'),
                  ('default', 'Bob',   date('now'), 4, 4, 4, 'Chef'),
                  ('default', 'Carol', date('now', '-1 day'), 3, 3, 3, 'Chef');

                -- commandCenter.ts: HACCP temperature log
                CREATE TABLE temp_log (
                  id                INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id       TEXT NOT NULL DEFAULT 'default',
                  shift_date        TEXT NOT NULL,
                  point_id          TEXT,
                  reading_f         REAL,
                  required_min_f    REAL,
                  required_max_f    REAL,
                  corrective_action TEXT,
                  created_at        TEXT DEFAULT (datetime('now')));

                -- 2 rows for date('now'): 1 within range, 1 out of range
                -- Row 1: reading_f=38, required_min_f=33, required_max_f=41 → within range
                -- Row 2: reading_f=55, required_min_f=33, required_max_f=41 → out of range
                INSERT INTO temp_log (location_id, shift_date, point_id, reading_f, required_min_f, required_max_f, corrective_action, created_at)
                VALUES
                  ('default', date('now'), 'WALK-IN-COOLER', 38.0, 33.0, 41.0, NULL,              datetime('now', '-3 hours')),
                  ('default', date('now'), 'REACH-IN-COOLER', 55.0, 33.0, 41.0, 'Adjusted cooler', datetime('now', '-1 hour'));

                -- commandCenter.ts: date marks / FIFO labels
                CREATE TABLE date_marks (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id  TEXT NOT NULL DEFAULT 'default',
                  item         TEXT,
                  prepared_on  TEXT,
                  discard_on   TEXT,
                  discarded_at TEXT);

                -- 2 active marks (discarded_at IS NULL): 1 expired, 1 due today
                -- 1 discarded mark (should NOT appear in fetch)
                INSERT INTO date_marks (location_id, item, prepared_on, discard_on, discarded_at)
                VALUES
                  ('default', 'Chicken Stock', date('now', '-4 days'), date('now', '-1 day'), NULL),
                  ('default', 'Hollandaise',   date('now'),             date('now'),           NULL),
                  ('default', 'Old Sauce',     date('now', '-7 days'), date('now', '-3 days'), datetime('now', '-2 days'));

                -- commandCenter.ts: thermometer calibration log
                CREATE TABLE thermometer_calibrations (
                  id               INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id      TEXT NOT NULL DEFAULT 'default',
                  thermometer_id   TEXT,
                  method           TEXT,
                  before_reading_f REAL,
                  passed           INTEGER NOT NULL DEFAULT 0,
                  calibrated_at    TEXT DEFAULT (datetime('now')),
                  frequency_days   INTEGER);

                -- 2 rows with runtime-relative calibrated_at
                INSERT INTO thermometer_calibrations (location_id, thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days)
                VALUES
                  ('default', 'THERM-001', 'ice_point', 32.2, 1, datetime('now', '-7 days'),  30),
                  ('default', 'THERM-002', 'ice_point', 31.8, 1, datetime('now', '-14 days'), 30);

                -- commandCenter.ts: pre-shift manager notes
                CREATE TABLE preshift_notes (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  author      TEXT,
                  body        TEXT,
                  created_at  TEXT DEFAULT (datetime('now')));

                -- 2 notes for date('now')
                INSERT INTO preshift_notes (location_id, shift_date, author, body)
                VALUES
                  ('default', date('now'), 'Manager A', 'VIP table 12 tonight'),
                  ('default', date('now'), 'Manager B', 'Health inspection tomorrow');

                -- commandCenter.ts: BEO (Banquet Event Orders) for today
                CREATE TABLE beo_events (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  event_date  TEXT NOT NULL,
                  name        TEXT,
                  guest_count INTEGER,
                  status      TEXT);

                -- 1 active event (guest_count=50), 1 cancelled event
                INSERT INTO beo_events (location_id, event_date, name, guest_count, status)
                VALUES
                  ('default', date('now'), 'Wedding Reception', 50, 'confirmed'),
                  ('default', date('now'), 'Corporate Lunch',   20, 'cancelled');

                -- commandCenter.ts: dining reservations
                CREATE TABLE reservations (
                  id             INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id    TEXT NOT NULL DEFAULT 'default',
                  reservation_at TEXT NOT NULL,
                  guest_name     TEXT,
                  party_size     INTEGER,
                  status         TEXT);

                -- 5 rows for date('now') with 5 known statuses (matches summarize() GROUP BY):
                --   booked (c=2), seated (c=1), completed (c=1), no_show (c=1), cancelled (c=1)
                -- summarize() only tracks booked/seated/completed/no_show/cancelled — 'confirmed'
                -- would be silently dropped, so it is not seeded here.
                INSERT INTO reservations (location_id, reservation_at, guest_name, party_size, status)
                VALUES
                  ('default', date('now') || 'T18:00:00', 'Smith',   4, 'booked'),
                  ('default', date('now') || 'T19:00:00', 'Jones',   2, 'booked'),
                  ('default', date('now') || 'T17:30:00', 'Garcia',  3, 'seated'),
                  ('default', date('now') || 'T12:00:00', 'Lee',     2, 'completed'),
                  ('default', date('now') || 'T13:00:00', 'Brown',   4, 'no_show'),
                  ('default', date('now') || 'T20:00:00', 'Wilson',  6, 'cancelled');

                -- commandCenter.ts: prep task list
                CREATE TABLE prep_tasks (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  task        TEXT,
                  status      TEXT NOT NULL DEFAULT 'todo',
                  priority    INTEGER);

                -- 5 rows for date('now'): 2 todo (priority 1 rush, priority 3), 1 in_progress (priority 2), 1 done, 1 skipped
                INSERT INTO prep_tasks (location_id, shift_date, task, status, priority)
                VALUES
                  ('default', date('now'), 'Butcher chicken',    'todo',        1),
                  ('default', date('now'), 'Peel potatoes',      'todo',        3),
                  ('default', date('now'), 'Make demi-glace',    'in_progress', 2),
                  ('default', date('now'), 'Slice bread',        'done',        2),
                  ('default', date('now'), 'Prep amuse bouche',  'skipped',     1);

                -- commandCenter.ts: inventory waste / usage log
                CREATE TABLE inventory_updates (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  shift_date  TEXT NOT NULL,
                  ingredient  TEXT,
                  direction   TEXT NOT NULL,
                  qty         REAL,
                  unit        TEXT);

                -- 2 waste rows for today, 3 waste rows from 3 days ago (within 7d window)
                -- 1 non-waste row today (should NOT appear in waste counts)
                INSERT INTO inventory_updates (location_id, shift_date, ingredient, direction, qty, unit)
                VALUES
                  ('default', date('now'),          'Chicken',  'waste',   1.5, 'lb'),
                  ('default', date('now'),          'Beef',     'waste',   0.5, 'lb'),
                  ('default', date('now', '-3 days'), 'Salmon', 'waste',   2.0, 'lb'),
                  ('default', date('now', '-3 days'), 'Butter', 'waste',   0.25,'lb'),
                  ('default', date('now', '-3 days'), 'Cream',  'waste',   1.0, 'lb'),
                  ('default', date('now'),          'Chicken',  'received', 10.0,'lb');

                -- commandCenter.ts: front-of-house table status
                CREATE TABLE dining_tables (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  table_name  TEXT,
                  status      TEXT NOT NULL DEFAULT 'open',
                  capacity    INTEGER);

                -- 4 tables: open (cap=4), seated (cap=6), dirty (cap=2), closed (cap=4)
                INSERT INTO dining_tables (location_id, table_name, status, capacity)
                VALUES
                  ('default', 'Table 1', 'open',   4),
                  ('default', 'Table 2', 'seated', 6),
                  ('default', 'Table 3', 'dirty',  2),
                  ('default', 'Table 4', 'closed', 4);
                """)

            // ── T10: Costing surface extensions ───────────────────────────────
            //
            // 1. sales_lines: add cost_per_unit column (pre-computed per-dish cost,
            //    simplifying the native port of computeMenuEngineering vs web's
            //    dishCostBridge multi-table JOIN).
            //
            //    Known values:
            //      Burger   cost_per_unit=4.0  → margin_pct=(15-4)/15*100=73.333%
            //      Tacos    cost_per_unit=5.0  → margin_pct=(15-5)/15*100=66.667%
            //      MysteryX cost_per_unit=NULL → margin_pct=nil → quadrant=unknown
            //
            // 2. accounting_variance: add period_start / period_end columns for the
            //    getVarianceTrend() 28-day window query (lib/varianceTrend.ts).
            //    Two new trend rows are added with runtime-relative dates so the test
            //    always falls within the window regardless of when it runs.
            //
            //    Known values:
            //      Row A: period_end=date('now','-7 days')  variance_pct=8.0  → red  (abs>=5)
            //      Row B: period_end=date('now')            variance_pct=5.5  → red  (abs>=5)
            //      MAX(period_end) = date('now')
            //      28-day cutoff  = date('now','-28 days')
            //      Both rows satisfy period_end >= cutoff → rowsFound=2
            //      pCurrent=5.5  pAverage=(8.0+5.5)/2=6.75
            try db.execute(sql: """
                -- T10: Add cost_per_unit to sales_lines (nullable; NULL = no dish cost mapped)
                ALTER TABLE sales_lines ADD COLUMN cost_per_unit REAL;

                UPDATE sales_lines SET cost_per_unit = 4.0 WHERE item_name = 'Burger'   AND location_id = 'default';
                UPDATE sales_lines SET cost_per_unit = 5.0 WHERE item_name = 'Tacos'    AND location_id = 'default';
                -- MysteryX intentionally left NULL

                -- T10: Add period_start / period_end to accounting_variance for trend queries
                ALTER TABLE accounting_variance ADD COLUMN period_start TEXT;
                ALTER TABLE accounting_variance ADD COLUMN period_end   TEXT;

                -- Two trend rows within the 28-day window (runtime-relative dates).
                -- Existing P0 rows (ids 1 and 2) keep their snapshot_at; period_start/period_end
                -- remain NULL on them — the trend query uses WHERE period_end IS NOT NULL.
                --
                -- snapshot_at is fixed to 2026-01 (before any P0 row) so ManagementRollupRepository
                -- still resolves its "latest by snapshot_at" to the P0 row (2026-06-16 10:00:00,
                -- actual_cogs=950.0). Only the period_start/period_end columns need runtime-relative
                -- dates so they remain inside the 28-day variance trend window.
                --
                --   Row A: snapshot_at fixed early  period_end = 7 days ago  variance_pct=8.0 → red
                --   Row B: snapshot_at fixed early  period_end = today        variance_pct=5.5 → red
                -- Both period_end values fall within the 28-day window of MAX(period_end)=date('now').
                INSERT INTO accounting_variance
                  (location_id, theoretical_cogs, actual_cogs, variance_amount, variance_pct,
                   snapshot_at, period_start, period_end)
                VALUES
                  ('default', 920.0, 993.6, 73.6, 8.0,
                   '2026-01-15 10:00:00', date('now', '-14 days'), date('now', '-7 days')),
                  ('default', 900.0, 949.5, 49.5, 5.5,
                   '2026-01-22 10:00:00', date('now', '-7 days'),  date('now'));
                """)
        }
        // writer deinits here, closing the pool; WAL mode persists in the file.
    }
    return path
}
