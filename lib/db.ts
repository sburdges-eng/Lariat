import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'lariat.db');

let _db: DB | null = null;
let _dbPathOverride: string | null = null;

/**
 * Test-only hook: point {@link getDb} at an arbitrary SQLite path (or
 * ':memory:') so a test can run against a scratch database without
 * poisoning `data/lariat.db`. Closes the current cached connection so
 * the next `getDb()` call reopens against the new path.
 *
 * Production code never calls this. Pass `null` to revert.
 */
export function setDbPathForTest(p: string | null): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
  _dbPathOverride = p;
}

// ── Row types ──────────────────────────────────────────────────────

export interface LineCheckEntry {
  id: number;
  shift_date: string;
  station_id: string;
  item: string;
  status: 'pass' | 'fail' | 'na';
  par: string | null;
  have: string | null;
  need: string | null;
  note: string | null;
  cook_id: string | null;
  created_at: string;
  location_id: string;
}

export interface StationSignoff {
  id: number;
  shift_date: string;
  station_id: string;
  cook_id: string;
  signoff_type: string;
  created_at: string;
  location_id: string;
}

export interface EightySix {
  id: number;
  shift_date: string;
  station_id: string | null;
  item: string;
  kind: string;
  reason: string | null;
  quantity: string | null;
  cook_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  location_id: string;
}

export interface InventoryUpdate {
  id: number;
  shift_date: string;
  station_id: string | null;
  item: string;
  delta: string | null;
  direction: string | null;
  note: string | null;
  cook_id: string | null;
  created_at: string;
  location_id: string;
}

export interface Location {
  id: string;
  name: string;
  created_at: string;
}

export interface VendorPrice {
  id: number;
  ingredient: string;
  vendor: string | null;
  sku: string | null;
  pack_size: number | null;
  pack_unit: string | null;
  pack_price: number | null;
  unit_price: number | null;
  category: string | null;
  yield_pct: number | null;  // fraction 0..1 (e.g. 0.85 for 85% trim yield)
  /**
   * Run-scoped signal. Set to 'PACK_CHANGED' when T6 detects a pack
   * substitution for this (vendor, sku) against the latest prior row
   * during the CURRENT ingest. Does NOT persist across a quiet
   * re-ingest of the post-swap state: the DELETE+INSERT sweep wipes
   * vendor_prices and, with no new diff to emit, map_status lands as
   * NULL on the next run. For the durable "surface until acknowledged"
   * attention queue, read `pack_size_changes WHERE acknowledged=0`
   * instead — that table is never cleared by the ingest.
   */
  map_status: string | null;
  /**
   * T7: FK to ingredient_masters.master_id. Collapses Sysco + Shamrock
   * rows for the same underlying ingredient so the costing join sees a
   * single merged cost instead of fragmented per-vendor duplicates.
   * NULL when no confirmed ingredient_maps row has been seeded yet —
   * downstream joins fall back to the ingredient string in that case
   * (graceful degradation during partial backfill).
   */
  master_id: string | null;
  location_id: string;
  imported_at: string;
}

export interface PackSizeChange {
  id: number;
  vendor: string;
  sku: string;
  prev_pack: string | null;
  new_pack: string | null;
  prev_price: number | null;
  new_price: number | null;
  detected_at: string;
  acknowledged: number;
}

export interface RecipeCost {
  recipe_id: string;
  recipe_name: string | null;
  category: string | null;
  yield: number | null;
  yield_unit: string | null;
  batch_cost: number | null;
  cost_per_yield_unit: number | null;
  costed_lines: number | null;
  total_lines: number | null;
  interpretations: number | null;
  location_id: string;
  imported_at: string;
}

export interface BomLine {
  id: number;
  recipe_id: string;
  ingredient: string | null;
  qty: number | null;
  unit: string | null;
  sub_recipe: string | null;
  vendor_ingredient: string | null;
  map_status: string | null;
  vendor: string | null;
  pack_price: number | null;
  pack_size: number | null;
  yield_pct: number | null;  // fraction 0..1 (e.g. 0.85 for 85% trim yield)
  loss_factor: number | null;  // cooking-shrinkage fraction 0..1 (e.g. 0.25 = 25% weight loss)
  /**
   * T7: FK to ingredient_masters.master_id. Lets cost math group
   * per-master rather than per-ingredient-string across a recipe's BOM.
   * NULL when no confirmed ingredient_maps row matches this ingredient
   * — joins degrade gracefully to the normalized ingredient key.
   */
  master_id: string | null;
  location_id: string;
  imported_at: string;
}

export interface IngredientMaster {
  /**
   * Stable slug derived from the confirmed recipe_ingredient. v1 uses
   * `normalizeIngredientKey(recipe_ingredient).replace(/ /g, '_')`
   * (e.g. "tomato paste" → "tomato_paste"). The spec's ideal encoding
   * is brand+pack (e.g. "ketchup_heinz_1gal"), but we don't yet have
   * structured brand/pack metadata on ingredient_maps — switching to
   * the richer slug is a pure migration once that metadata lands.
   */
  master_id: string;
  canonical_name: string;
  category: string | null;
  preferred_vendor: string | null;
  last_reviewed: string | null;
}

export interface IngredientDensity {
  ingredient_key: string;
  g_per_ml: number;
  source: 'seed' | 'measured' | 'vendor' | null;
  updated_at: string;
}

export interface IngredientYield {
  ingredient_key: string;
  yield_pct: number;              // fraction 0..1
  loss_factor: number | null;     // fraction 0..1 or null
  source: 'book_of_yields' | 'lariat_measured' | 'seed';
  notes: string | null;
  updated_at: string;
}

export interface IngestRun {
  id: number;
  kind: string;                   // 'costing' | 'analytics' | 'unified' | 'toast' | ...
  started_at: string;             // ISO 8601, produced by datetime('now','subsec')
  finished_at: string | null;     // NULL while running
  rows_in: number | null;
  rows_out: number | null;
  status: string | null;          // 'ok' | 'partial' | 'failed' | 'running'
}

export interface SalesLine {
  id: number;
  period_label: string | null;
  item_name: string;
  quantity_sold: number | null;
  net_sales: number | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface SpendMonthly {
  id: number;
  month: string;
  shamrock_total_spend: number | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface BeoEvent {
  id: number;
  title: string;
  event_date: string | null;
  guest_count: number | null;
  notes: string | null;
  status: string;
  location_id: string;
  created_at: string;
}

export interface BeoTask {
  id: number;
  event_id: number;
  task: string;
  due_date: string | null;
  done: number;
  sort_order: number;
  location_id: string;
}

export interface Equipment {
  id: number;
  name: string;
  category: string;
  make_model: string | null;
  model_number: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_expiration: string | null;
  purchase_cost: number | null;
  vendor: string | null;
  vendor_order_ref: string | null;
  manual_path: string | null;
  notes: string | null;
  status: string;
  location_id: string;
}

export interface EquipmentMaintenance {
  id: number;
  equipment_id: number;
  service_date: string;
  type: string;
  cost: number | null;
  notes: string | null;
  receipt_reference: string | null;
  cook_id: string | null;
  location_id: string;
  created_at: string;
}

export interface EquipmentPart {
  id: number;
  equipment_id: number;
  part_number: string;
  description: string | null;
  vendor: string | null;
  unit_price: number | null;
  qty_on_hand: number | null;
  last_ordered: string | null;
  last_order_ref: string | null;
  notes: string | null;
  location_id: string;
  created_at: string;
}

export interface EquipmentMaintenanceSchedule {
  id: number;
  equipment_id: number;
  task: string;
  frequency: string;
  last_done: string | null;
  next_due: string | null;
  notes: string | null;
  location_id: string;
  created_at: string;
}

export interface GoldStar {
  id: number;
  cook_name: string;
  reason: string;
  stars: number;
  awarded_date: string;
  location_id: string;
  created_at: string;
}

export interface TempLogEntry {
  id: number;
  shift_date: string;
  location_id: string;
  point_id: string;
  reading_f: number;
  required_min_f: number | null;
  required_max_f: number | null;
  corrective_action: string | null;
  cook_id: string | null;
  created_at: string;
}

export interface ToastSalesDailyRow {
  id: number;
  shift_date: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface ToastSalesDowRow {
  id: number;
  day_of_week: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface ToastSalesHourRow {
  id: number;
  hour_24: number;
  label: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

// ── Schema ─────────────────────────────────────────────────────────

export function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS line_check_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pass','fail','na')),
      par TEXT,
      have TEXT,
      need TEXT,
      note TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_lce_shift ON line_check_entries(shift_date, station_id);

    CREATE TABLE IF NOT EXISTS station_signoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      signoff_type TEXT NOT NULL DEFAULT 'self',
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_signoff_shift ON station_signoffs(shift_date, station_id);

    CREATE TABLE IF NOT EXISTS eighty_six (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      item TEXT NOT NULL,
      kind TEXT DEFAULT 'item',
      reason TEXT,
      quantity TEXT,
      cook_id TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_86_shift ON eighty_six(shift_date, resolved_at);

    CREATE TABLE IF NOT EXISTS inventory_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      item TEXT NOT NULL,
      delta TEXT,
      direction TEXT,
      note TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_inv_shift ON inventory_updates(shift_date, station_id);

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vendor_prices (
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
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vp_loc ON vendor_prices(location_id);

    CREATE TABLE IF NOT EXISTS recipe_costs (
      recipe_id TEXT PRIMARY KEY,
      recipe_name TEXT,
      category TEXT,
      yield REAL,
      yield_unit TEXT,
      batch_cost REAL,
      cost_per_yield_unit REAL,
      costed_lines INTEGER,
      total_lines INTEGER,
      interpretations INTEGER,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      ingredient TEXT,
      qty REAL,
      unit TEXT,
      sub_recipe TEXT,
      vendor_ingredient TEXT,
      map_status TEXT,
      vendor TEXT,
      pack_price REAL,
      pack_size REAL,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bom_recipe ON bom_lines(recipe_id, location_id);

    CREATE TABLE IF NOT EXISTS ingredient_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_ingredient TEXT NOT NULL,
      vendor_ingredient TEXT,
      status TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );

    -- T7: canonical ingredient master table. One row per logical ingredient
    -- (e.g. "heinz_ketchup_1gal") regardless of which vendor carries it. A
    -- Sysco row and a Shamrock row for the same thing both point at the same
    -- master via vendor_prices.master_id / bom_lines.master_id, collapsing
    -- per-vendor fragmentation before the costing / menu-engineering joins.
    -- Populated from confirmed ingredient_maps rows — we never fuzz-match
    -- automatically (same posture as scripts/lib/ingredient_key.py
    -- _make_join_key). master_id is a slug derived from the recipe
    -- ingredient string (see IngredientMaster JSDoc for the v1 formula).
    CREATE TABLE IF NOT EXISTS ingredient_masters (
      master_id        TEXT PRIMARY KEY,  -- slug: "ketchup_heinz_1gal"
      canonical_name   TEXT NOT NULL,
      category         TEXT,
      preferred_vendor TEXT,
      last_reviewed    TEXT
    );

    CREATE TABLE IF NOT EXISTS ingredient_densities (
      ingredient_key TEXT PRIMARY KEY,
      g_per_ml REAL NOT NULL,
      source TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- T4.1: per-(ingredient, count-unit) weight bridge. Answers "how many
    -- grams is one ea / bunch / slice / sprig / clove / case of this
    -- ingredient." Used by the T4 conversion post-pass in ingest-costing.mjs
    -- to bridge count ↔ weight (and count → volume when paired with a
    -- density). Source column tracks provenance the same way as
    -- ingredient_densities; a row may be 'seed' (CSV), 'measured' (kitchen
    -- scale), or 'vendor' (declared on a spec sheet).
    CREATE TABLE IF NOT EXISTS ingredient_unit_weights (
      ingredient_key TEXT NOT NULL,
      unit           TEXT NOT NULL,        -- canonical count unit (post-normalize_unit)
      g_per_unit     REAL NOT NULL,        -- grams per 1 of the count unit above
      source         TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ingredient_key, unit)
    );

    -- T5a: per-(vendor, sku) catalog pack weight so invoice-vs-received
    -- reconciliation can catch catch-weight items that ship heavier/lighter
    -- than the catalog declares. catalog_wt_lb is REQUIRED (the reference
    -- value); tare_lb is optional (nonzero for items where the pack
    -- container is weighed with the product — chicken wings in a 2 lb
    -- bag, etc.). Source enum matches ingredient_densities posture. PK
    -- on (vendor, sku) since one SKU is unique per vendor.
    CREATE TABLE IF NOT EXISTS vendor_catch_weights (
      vendor        TEXT NOT NULL,
      sku           TEXT NOT NULL,
      catalog_wt_lb REAL NOT NULL,
      tare_lb       REAL,
      source        TEXT,
      updated_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (vendor, sku)
    );

    -- T6: pack-size substitution audit log. Each row records a detected
    -- silent vendor swap (e.g. 6×#10 → 4×#10) caught at ingest time by
    -- diffing the incoming pack_size/pack_unit against the latest prior
    -- row per (vendor, sku). prev_pack / new_pack encode the tuple
    -- "{pack_size}x{pack_unit}" for human-readable diff output; the
    -- numeric components live on vendor_prices itself. acknowledged=0
    -- means the row still surfaces in the attention queue; operator
    -- flips to 1 once the swap has been reviewed.
    --
    -- DURABILITY: this table is the authoritative, persistent source
    -- for the "pack-changed" attention queue. It is NEVER DELETEd by
    -- the ingest (unlike vendor_prices, which gets a DELETE+INSERT
    -- sweep every run). As a result, a quiet re-ingest of the post-
    -- swap state leaves this row intact and its acknowledged flag
    -- untouched. Consumers of the attention queue MUST key on
    -- acknowledged=0 here, not on vendor_prices.map_status (which
    -- is a run-scoped signal — see VendorPrice.map_status JSDoc).
    CREATE TABLE IF NOT EXISTS pack_size_changes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor       TEXT NOT NULL,
      sku          TEXT NOT NULL,
      prev_pack    TEXT,  -- e.g. "6x#10"
      new_pack     TEXT,
      prev_price   REAL,
      new_price    REAL,
      detected_at  TEXT DEFAULT (datetime('now')),
      acknowledged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ingredient_yields (
      ingredient_key TEXT PRIMARY KEY,     -- same normalized form as ingredient_densities
      yield_pct      REAL NOT NULL,        -- fraction 0..1 (e.g. 0.85 for 85% trim yield)
      loss_factor    REAL,                 -- cooking-shrinkage fraction 0..1; NULL if not applicable
      source         TEXT NOT NULL CHECK (source IN ('book_of_yields', 'lariat_measured', 'seed')),
      notes          TEXT,                 -- provenance / edge-case detail
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    -- T9 / B3: per-invocation ingest instrumentation. One row per ingest run,
    -- inserted at the start of the script with status='running' and finalized
    -- at the end with 'ok' | 'partial' | 'failed'. Drives the ingest-age tile
    -- on /costing and the "price update latency" benchmark in the gap doc.
    CREATE TABLE IF NOT EXISTS ingest_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,          -- 'costing' | 'analytics' | 'unified' | 'toast' | ...
      started_at   TEXT NOT NULL,          -- ISO 8601 via datetime('now','subsec')
      finished_at  TEXT,                   -- NULL while running
      rows_in      INTEGER,
      rows_out     INTEGER,
      status       TEXT                    -- 'ok' | 'partial' | 'failed' | 'running'
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_runs_kind_started ON ingest_runs(kind, started_at DESC);

    CREATE TABLE IF NOT EXISTS order_guide_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT NOT NULL,
      base_qty REAL,
      unit TEXT,
      vendor TEXT,
      unit_price REAL,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_label TEXT,
      item_name TEXT NOT NULL,
      quantity_sold REAL,
      net_sales REAL,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_loc ON sales_lines(location_id);

    CREATE TABLE IF NOT EXISTS spend_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      shamrock_total_spend REAL,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spend_month ON spend_monthly(month, location_id);

    CREATE TABLE IF NOT EXISTS beo_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT,
      guest_count INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'planned',
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beo_prep_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      due_date TEXT,
      done INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      location_id TEXT DEFAULT 'default',
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_prep_ev ON beo_prep_tasks(event_id);

    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      make_model TEXT,
      serial_number TEXT,
      purchase_date TEXT,
      warranty_expiration TEXT,
      purchase_cost REAL,
      status TEXT DEFAULT 'active',
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_equip_loc ON equipment(location_id);

    CREATE TABLE IF NOT EXISTS equipment_maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      type TEXT NOT NULL,
      cost REAL,
      notes TEXT,
      receipt_reference TEXT,
      cook_id TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_maint_eq ON equipment_maintenance(equipment_id);

    CREATE TABLE IF NOT EXISTS equipment_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      part_number TEXT NOT NULL,
      description TEXT,
      vendor TEXT,
      unit_price REAL,
      qty_on_hand REAL,
      last_ordered TEXT,
      last_order_ref TEXT,
      notes TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_parts_eq ON equipment_parts(equipment_id);

    CREATE TABLE IF NOT EXISTS equipment_maintenance_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      frequency TEXT NOT NULL,
      last_done TEXT,
      next_due TEXT,
      notes TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_sched_eq ON equipment_maintenance_schedule(equipment_id);

    CREATE TABLE IF NOT EXISTS gold_stars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cook_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      stars INTEGER DEFAULT 1,
      awarded_date TEXT DEFAULT (date('now')),
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS temp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      point_id TEXT NOT NULL,
      reading_f REAL NOT NULL,
      required_min_f REAL,
      required_max_f REAL,
      corrective_action TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_temp_log_shift ON temp_log(shift_date, location_id, point_id);

    CREATE TABLE IF NOT EXISTS toast_sales_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(shift_date, comparison_group, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_toast_daily_loc_date ON toast_sales_daily(location_id, shift_date);

    CREATE TABLE IF NOT EXISTS toast_sales_dow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(day_of_week, comparison_group, location_id)
    );

    CREATE TABLE IF NOT EXISTS toast_sales_hour (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour_24 INTEGER NOT NULL,
      label TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(hour_24, comparison_group, location_id)
    );
  `);

  migrateLegacyColumns(db);
  assertCriticalSchemas(db);
  seedDefaultLocation(db);
  ensureIndexes(db);
}

/**
 * Guard against `CREATE TABLE IF NOT EXISTS` silently skipping a legacy
 * table that exists but carries a mismatched schema (e.g. from a failed
 * partial deploy of an earlier T-task). If that happens, INSERTs later fail
 * at runtime with cryptic "no such column" errors — this raises a clear
 * schema-drift error at init time instead.
 */
function assertCriticalSchemas(db: DB): void {
  const requirements: Record<string, string[]> = {
    ingredient_yields: [
      'ingredient_key', 'yield_pct', 'loss_factor', 'source', 'notes', 'updated_at',
    ],
    ingredient_densities: ['ingredient_key', 'g_per_ml', 'source', 'updated_at'],
    ingredient_unit_weights: ['ingredient_key', 'unit', 'g_per_unit', 'source', 'updated_at'],
    vendor_catch_weights: ['vendor', 'sku', 'catalog_wt_lb', 'tare_lb', 'source', 'updated_at'],
    pack_size_changes: [
      'id', 'vendor', 'sku', 'prev_pack', 'new_pack',
      'prev_price', 'new_price', 'detected_at', 'acknowledged',
    ],
    ingredient_masters: [
      'master_id', 'canonical_name', 'category',
      'preferred_vendor', 'last_reviewed',
    ],
  };
  for (const [table, required] of Object.entries(requirements)) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => c.name);
    if (cols.length === 0) continue; // table not created — fine, CREATE IF NOT EXISTS handled it
    const missing = required.filter((c) => !cols.includes(c));
    if (missing.length > 0) {
      throw new Error(
        `schema drift on '${table}': missing columns ${JSON.stringify(missing)}. ` +
          `Found: ${JSON.stringify(cols)}. ` +
          `A legacy/partial-deploy table is shadowing the current schema; ` +
          `inspect the DB and either drop+recreate the table or add a migration.`,
      );
    }
  }
}

function ensureIndexes(db: DB): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lce_loc_date ON line_check_entries(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_signoff_loc ON station_signoffs(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_86_loc_date ON eighty_six(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_inv_loc_date ON inventory_updates(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_psc_vendor_sku ON pack_size_changes(vendor, sku);
    CREATE INDEX IF NOT EXISTS idx_psc_ack ON pack_size_changes(acknowledged, detected_at);
    -- T7: per-master lookup indexes. Placed in ensureIndexes (not inline in
    -- the CREATE TABLE block) so assertCriticalSchemas fires first — a
    -- partial-deploy drift on vendor_prices / bom_lines / ingredient_masters
    -- surfaces as a clean schema error instead of a silent "CREATE INDEX
    -- on a non-existent column" failure.
    CREATE INDEX IF NOT EXISTS idx_vp_master ON vendor_prices(master_id);
    CREATE INDEX IF NOT EXISTS idx_bom_master ON bom_lines(master_id);
  `);
}

function migrateLegacyColumns(db: DB): void {
  const cols86 = db.prepare('PRAGMA table_info(eighty_six)').all() as { name: string }[];
  const names86 = cols86.map((c) => c.name);
  const migrations: [string, string][] = [
    ['station_id', 'ALTER TABLE eighty_six ADD COLUMN station_id TEXT'],
    ['kind', "ALTER TABLE eighty_six ADD COLUMN kind TEXT DEFAULT 'item'"],
    ['quantity', 'ALTER TABLE eighty_six ADD COLUMN quantity TEXT'],
    ['resolved_by', 'ALTER TABLE eighty_six ADD COLUMN resolved_by TEXT'],
    ['location_id', "ALTER TABLE eighty_six ADD COLUMN location_id TEXT DEFAULT 'default'"],
  ];
  for (const [col, ddl] of migrations) {
    if (!names86.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  const addLoc = (table: string, existingCols: string[]) => {
    if (!existingCols.includes('location_id')) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN location_id TEXT DEFAULT 'default'`);
      } catch { /* ignore */ }
    }
  };
  const t = (name: string) =>
    (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
  addLoc('line_check_entries', t('line_check_entries'));
  addLoc('station_signoffs', t('station_signoffs'));
  addLoc('inventory_updates', t('inventory_updates'));

  // Extend equipment table with vendor / manual / model-number / notes columns
  const equipCols = t('equipment');
  const equipMigrations: [string, string][] = [
    ['model_number', 'ALTER TABLE equipment ADD COLUMN model_number TEXT'],
    ['vendor', 'ALTER TABLE equipment ADD COLUMN vendor TEXT'],
    ['vendor_order_ref', 'ALTER TABLE equipment ADD COLUMN vendor_order_ref TEXT'],
    ['manual_path', 'ALTER TABLE equipment ADD COLUMN manual_path TEXT'],
    ['notes', 'ALTER TABLE equipment ADD COLUMN notes TEXT'],
  ];
  for (const [col, ddl] of equipMigrations) {
    if (!equipCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Extend bom_lines with yield / cooking-loss factors used by COGS mapping.
  // T7 adds master_id as a non-indexed FK-style pointer to
  // ingredient_masters.master_id. Pre-T7 rows remain NULL until the T7
  // backfill pass in scripts/ingest-costing.mjs writes them, at which point
  // the costing-benchmark / variance joins prefer master_id when non-NULL
  // on both sides and fall back to the normalized ingredient string.
  const bomCols = t('bom_lines');
  const bomMigrations: [string, string][] = [
    ['yield_pct', 'ALTER TABLE bom_lines ADD COLUMN yield_pct REAL'],
    ['loss_factor', 'ALTER TABLE bom_lines ADD COLUMN loss_factor REAL'],
    ['master_id', 'ALTER TABLE bom_lines ADD COLUMN master_id TEXT'],
  ];
  for (const [col, ddl] of bomMigrations) {
    if (!bomCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Vendor-default trim yield attached to each priced pack.
  // T5a adds catch-weight reconciliation columns on the same table:
  //   actual_received_lb     — per-pack delivered weight from invoice
  //   reconciled_unit_price  — per-actual-lb unit price recomputed when
  //                            actual_received_lb deviates from catalog
  // Both NULLable; old rows pre-T5a stay NULL (conventional "no catch-weight
  // adjustment" sentinel).
  // T6 adds map_status on vendor_prices so the pack-size-substitution
  // detector can flag the freshly-INSERTed row as 'PACK_CHANGED' whenever
  // the incoming pack_size/pack_unit differs from the latest prior row per
  // (vendor, sku). NULL on old / non-changed rows. This column is a
  // RUN-SCOPED signal only — it does not persist across a quiet re-ingest
  // of the post-swap state (the DELETE+INSERT sweep wipes it and the next
  // run finds no diff). Attention-queue consumers should key on
  // `pack_size_changes.acknowledged=0` for durability. See the
  // pack_size_changes DDL comment and VendorPrice.map_status JSDoc above.
  // T7 adds master_id on vendor_prices so multi-vendor rows for the same
  // underlying ingredient collapse onto a single master during costing /
  // menu-engineering joins. Pre-T7 rows land NULL; the T7 backfill in
  // scripts/ingest-costing.mjs writes them from confirmed ingredient_maps.
  const vpCols = t('vendor_prices');
  const vpMigrations: [string, string][] = [
    ['yield_pct', 'ALTER TABLE vendor_prices ADD COLUMN yield_pct REAL'],
    ['actual_received_lb', 'ALTER TABLE vendor_prices ADD COLUMN actual_received_lb REAL'],
    ['reconciled_unit_price', 'ALTER TABLE vendor_prices ADD COLUMN reconciled_unit_price REAL'],
    ['map_status', 'ALTER TABLE vendor_prices ADD COLUMN map_status TEXT'],
    ['master_id', 'ALTER TABLE vendor_prices ADD COLUMN master_id TEXT'],
  ];
  for (const [col, ddl] of vpMigrations) {
    if (!vpCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }
}

function seedDefaultLocation(db: DB): void {
  const n = db.prepare(`SELECT COUNT(*) as c FROM locations WHERE id = 'default'`).get() as { c: number };
  if (n.c === 0) {
    db.prepare(`INSERT INTO locations (id, name) VALUES ('default', 'The Lariat')`).run();
  }
}

export function getDb(): DB {
  if (_db) return _db;
  const target = _dbPathOverride ?? DB_PATH;
  // Only create the default data/ dir when using the production path;
  // tests using :memory: or a tmp file manage their own directory.
  if (target === DB_PATH && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  _db = new Database(target);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const DB_FILE = DB_PATH;
