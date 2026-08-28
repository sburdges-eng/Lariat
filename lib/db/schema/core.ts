/**
 * Core table DDL plus the {@link initSchema} orchestrator.
 *
 * `initSchema` runs on every `getDb()` and must stay idempotent. The call
 * order below is load-bearing and matches the original single-function
 * version exactly — in particular `migrateLegacyColumns` runs BEFORE the
 * Phase-4 tables are created, and `clearSchemaCache()` runs last.
 */
import type { Database as DB } from 'better-sqlite3';
import { clearSchemaCache } from '../../schemaCache.ts';
import { assertCriticalSchemas } from '../assertions.ts';
import { ensureIndexes, migrateLegacyColumns, seedDefaultLocation } from '../migrations.ts';
import { initEntitySchema } from './entity.ts';
import { initFoodSafetyLaborSchema } from './safety.ts';
import { initManagementSchema } from './management.ts';

/**
 * Monotonic schema-version marker, surfaced via the `schema_migrations`
 * table by {@link initSchema}. The native macOS read-only app (P1a spec §7)
 * reads `SELECT MAX(version) FROM schema_migrations` and degrades gracefully
 * on absence/mismatch rather than crashing.
 *
 * BUMP THIS whenever initSchema's DDL changes (new table / column / index).
 * `scripts/check-schema-version-bump.mjs` enforces the bump at commit time so
 * the marker stays trustworthy.
 */
export const SCHEMA_VERSION = 6;

/**
 * Create/migrate every table in the database. Idempotent: safe to call on
 * an already-migrated DB. Step order is the original order and must not be
 * rearranged — `migrateLegacyColumns` and `assertCriticalSchemas` run
 * against the core + domain tables only, before the Phase-4 block.
 */
export function initSchema(db: DB): void {
  initCoreSchema(db);

  initFoodSafetyLaborSchema(db);
  initEntitySchema(db);
  initManagementSchema(db);

  migrateLegacyColumns(db);
  assertCriticalSchemas(db);
  seedDefaultLocation(db);
  ensureIndexes(db);

  initPhase4Schema(db);
  recordSchemaVersion(db);

  // Audit H2 (2026-05-14): clear the PRAGMA table_info cache so
  // column-add ALTERs propagate without a process restart. Lives in
  // its own module (lib/schemaCache.ts) to break the import cycle
  // db.ts → syncApply.ts → syncFeed.ts → db.ts.
  clearSchemaCache();
}

/** Line checks, inventory, costing, BEO, sync, and the cloud-bridge outbox. */
function initCoreSchema(db: DB): void {
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
      -- F15 (FDA §3-301.11): NULL = item doesn't touch RTE food;
      -- 0 = glove-change required but not yet attested;
      -- 1 = cook has attested fresh gloves for this line-check row.
      glove_change_attested INTEGER,
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
      master_id TEXT,
      delta TEXT,
      direction TEXT,
      note TEXT,
      cook_id TEXT,
      sync_source_host TEXT,
      sync_source_started_at TEXT,
      sync_source_pk TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_inv_shift ON inventory_updates(shift_date, station_id);

    -- Periodic on-hand counts. One header row per "count session" the BOH
    -- opens (e.g. weekly / EOM); count_lines holds the actual on-hand qty
    -- per ingredient. Headers are kept open until closed_at is set so a
    -- count can span a shift; lines are upserted by (count_id, ingredient).
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_date TEXT NOT NULL,
      label TEXT,
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      cook_id TEXT,
      location_id TEXT NOT NULL DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_inv_counts_loc_date
      ON inventory_counts(location_id, count_date DESC);

    CREATE TABLE IF NOT EXISTS inventory_count_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
      vendor TEXT,
      ingredient TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      on_hand_qty REAL,
      unit TEXT,
      par_qty REAL,
      par_unit TEXT,
      note TEXT,
      counted_by TEXT,
      counted_at TEXT DEFAULT (datetime('now')),
      location_id TEXT NOT NULL DEFAULT 'default',
      UNIQUE(count_id, ingredient, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_count_lines_count
      ON inventory_count_lines(count_id);

    -- Standing par list: what we keep on hand by ingredient. The par page
    -- LEFT JOINs latest count_lines against this so cooks can see what's
    -- below par at a glance. sku is stored as '' (not NULL) so the UNIQUE
    -- constraint works cleanly for ingredients with no SKU.
    CREATE TABLE IF NOT EXISTS inventory_par (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor TEXT,
      ingredient TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      par_qty REAL,
      par_unit TEXT,
      pack_size TEXT,
      pack_unit TEXT,
      category TEXT,
      note TEXT,
      location_id TEXT NOT NULL DEFAULT 'default',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, ingredient, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_par_loc_cat
      ON inventory_par(location_id, category, ingredient);

    -- Daily prep board. Shift-bound tasks owned by the kitchen, distinct
    -- from beo_prep_tasks which are event-bound. Status flows
    -- todo → in_progress → done (or → skipped for "we're not doing this
    -- today"). assigned_cook_id is whoever claimed it; done_by is whoever
    -- finished it (may differ if a shift handoff happens). source/
    -- source_ref let us track auto-suggested tasks (low_par, beo, …)
    -- without coupling to those tables.
    CREATE TABLE IF NOT EXISTS prep_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      task TEXT NOT NULL,
      qty TEXT,
      recipe_slug TEXT,
      notes TEXT,
      priority INTEGER DEFAULT 0,
      assigned_cook_id TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','in_progress','done','skipped')),
      started_at TEXT,
      done_at TEXT,
      done_by TEXT,
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      sort_order INTEGER DEFAULT 0,
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prep_tasks_loc_date
      ON prep_tasks(location_id, shift_date, status);
    CREATE INDEX IF NOT EXISTS idx_prep_tasks_station
      ON prep_tasks(location_id, shift_date, station_id);

    -- Standing prep targets (par amounts per station/recipe or ingredient).
    -- Separate from daily prep_tasks (which are shift-bound) and from
    -- beo_prep_tasks (which are event-bound). station_id/recipe_slug/ingredient
    -- are stored as '' (not NULL) so the UNIQUE constraint works cleanly —
    -- SQLite treats NULLs as distinct, which would break the UNIQUE intent.
    -- The CHECK ensures every row targets at least one of recipe or ingredient.
    CREATE TABLE IF NOT EXISTS prep_par (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      station_id TEXT NOT NULL DEFAULT '',
      recipe_slug TEXT NOT NULL DEFAULT '',
      ingredient TEXT NOT NULL DEFAULT '',
      target_qty REAL,
      unit TEXT,
      sort_order INTEGER DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, station_id, recipe_slug, ingredient),
      CHECK (recipe_slug <> '' OR ingredient <> '')
    );
    CREATE INDEX IF NOT EXISTS idx_prep_par_loc_station
      ON prep_par(location_id, station_id, sort_order);

    -- Day-plan / side-work spine. Templates are the house itinerary;
    -- ops_run_steps are shared multi-device ticks for one shift_date.
    -- Deep-links into stations / prep / cleaning / equipment — not a
    -- parallel record for regulated HACCP checks.
    CREATE TABLE IF NOT EXISTS ops_run_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      daypart TEXT NOT NULL
        CHECK(daypart IN ('open','prep','side_work','maintenance','sop')),
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ops_tpl_loc
      ON ops_run_templates(location_id, active, sort_order);

    CREATE TABLE IF NOT EXISTS ops_run_template_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL
        REFERENCES ops_run_templates(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      due_time TEXT,
      link_href TEXT,
      link_label TEXT,
      sort_order INTEGER DEFAULT 0,
      UNIQUE(template_id, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_ops_tpl_steps
      ON ops_run_template_steps(template_id, sort_order);

    CREATE TABLE IF NOT EXISTS ops_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      shift_date TEXT NOT NULL,
      daypart TEXT NOT NULL
        CHECK(daypart IN ('open','prep','side_work','maintenance','sop')),
      step_key TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      due_time TEXT,
      link_href TEXT,
      link_label TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','done','skipped')),
      done_at TEXT,
      done_by TEXT,
      sort_order INTEGER DEFAULT 0,
      source TEXT DEFAULT 'template',
      template_step_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, shift_date, daypart, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_ops_run_loc_date
      ON ops_run_steps(location_id, shift_date, status);
    CREATE INDEX IF NOT EXISTS idx_ops_run_daypart
      ON ops_run_steps(location_id, shift_date, daypart, sort_order);

    -- Front-of-house reservations. Distinct from beo_events (catering /
    -- private events with formal contracts). A reservation is a regular-
    -- service party. Status flow:
    --   booked → seated → completed | cancelled | no_show
    -- table_id is a soft FK to a tables row (M3.1 will create it); kept as
    -- a plain TEXT here so reservations can ship before floor plan exists.
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_name TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      reservation_at TEXT NOT NULL,           -- 'YYYY-MM-DD HH:MM' local
      status TEXT NOT NULL DEFAULT 'booked'
        CHECK(status IN ('booked','seated','completed','cancelled','no_show')),
      table_id TEXT,                          -- soft FK to tables.id once that exists
      phone TEXT,
      email TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',           -- 'manual', 'opentable', 'phone', etc.
      source_ref TEXT,
      seated_at TEXT,
      completed_at TEXT,
      cook_id TEXT,                           -- whoever booked or last touched it
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_loc_at
      ON reservations(location_id, reservation_at);
    CREATE INDEX IF NOT EXISTS idx_reservations_status
      ON reservations(location_id, status, reservation_at);

    -- Host-stand waitlist (V6b). Append-only-ish: status transitions
    -- waiting → seated | left, both terminal. seated_at / left_at carry
    -- the resolution timestamp. Operational data (no HACCP, no cash) —
    -- audited via auditLog.mjs (file stream), not the regulated DB
    -- stream. Party_name is host-supplied free text; quoted-pair-style
    -- "Dabaja x4" entries are normal kitchen shorthand.
    CREATE TABLE IF NOT EXISTS waitlist_parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      party_name TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting','seated','left')),
      seated_at TEXT,
      left_at TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_parties_loc_status
      ON waitlist_parties(location_id, status, joined_at);

    -- Front-of-house dining-room layout. One row per physical table or
    -- bar seat. (x, y) is the top-left corner in an arbitrary unit grid;
    -- (w, h) is the table's footprint. status is the live state — open is
    -- the default, seated when a party is at it, dirty when it needs a
    -- bus. The status drives /floor's color tiles; reservations × tables
    -- wiring (M3.4) updates it via the seat / complete verbs.
    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT NOT NULL,                     -- e.g. 'T1', 'T2', 'BAR-3'
      name TEXT NOT NULL,                   -- display label, e.g. 'Window 4'
      capacity INTEGER NOT NULL DEFAULT 2,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      w REAL NOT NULL DEFAULT 1,
      h REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','seated','dirty','closed')),
      notes TEXT,
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (location_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_dining_tables_loc_status
      ON dining_tables(location_id, status);

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      day_of_week INTEGER NOT NULL,
      opens_at TEXT,
      closes_at TEXT,
      service_label TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, day_of_week, service_label)
    );
    CREATE INDEX IF NOT EXISTS idx_service_hours_loc
      ON service_hours(location_id, day_of_week);

    CREATE TABLE IF NOT EXISTS preshift_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      shift_date TEXT NOT NULL,
      service_label TEXT,
      body TEXT NOT NULL,
      author_cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, shift_date, service_label)
    );
    CREATE INDEX IF NOT EXISTS idx_preshift_date
      ON preshift_notes(location_id, shift_date);

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

    -- Append-only snapshot of vendor_prices taken before each destructive
    -- ingest sweep. Lets operators look back at historical price trends even
    -- though the live vendor_prices table is DELETE+INSERT per run.
    -- Rows never deleted or updated; queries DISTINCT ON (vendor, sku)
    -- ORDER BY snapshot_at for per-SKU price series.
    CREATE TABLE IF NOT EXISTS vendor_prices_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      source_vendor_price_id INTEGER,
      ingredient TEXT NOT NULL,
      vendor TEXT,
      sku TEXT,
      pack_size REAL,
      pack_unit TEXT,
      pack_price REAL,
      unit_price REAL,
      category TEXT,
      yield_pct REAL,
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      master_id TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT,
      snapshot_at TEXT DEFAULT (datetime('now','subsec')),
      snapshot_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vph_loc_vendor_sku
      ON vendor_prices_history(location_id, vendor, sku);
    CREATE INDEX IF NOT EXISTS idx_vph_snapshot_at
      ON vendor_prices_history(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_vph_loc_snapshot_shock
      ON vendor_prices_history(location_id, snapshot_at DESC)
      WHERE vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_vph_ingredient
      ON vendor_prices_history(ingredient);

    CREATE TABLE IF NOT EXISTS recipe_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
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
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS recipe_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_slug TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      caption TEXT,
      uploaded_by_cook_id TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recipe_photos_slug
      ON recipe_photos(location_id, recipe_slug, id DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS margin_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      net_sales REAL,
      cost_per_unit REAL,
      margin_pct REAL,
      popularity REAL,
      quadrant TEXT,
      snapshot_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    -- Latest-per-location read path + retention DELETE both need this.
    CREATE INDEX IF NOT EXISTS idx_margin_snapshots_loc_id
      ON margin_snapshots(location_id, id DESC);

    -- Point-in-time dish-coverage rollup written by the compute engine
    -- after each margin recompute, so the management page reads a cheap
    -- snapshot instead of scanning dish_components + sales_lines on load.
    -- Shape mirrors the DishCoverageSnapshot interface above.
    CREATE TABLE IF NOT EXISTS dish_coverage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      total_dishes INTEGER,
      covered_dishes INTEGER,
      coverage_pct REAL,
      uncovered_dishes TEXT,
      created_by TEXT,
      snapshot_at TEXT DEFAULT (datetime('now'))
    );
    -- Latest-per-location read path.
    CREATE INDEX IF NOT EXISTS idx_dish_coverage_snapshots_loc_id
      ON dish_coverage_snapshots(location_id, id DESC);

    CREATE TABLE IF NOT EXISTS accounting_variance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT,
      period_end TEXT,
      theoretical_cogs REAL,
      actual_cogs REAL,
      variance_amount REAL,
      variance_pct REAL,
      snapshot_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_accounting_variance_loc_id
      ON accounting_variance(location_id, id DESC);

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
      master_id           TEXT PRIMARY KEY,  -- slug: "ketchup_heinz_1gal"
      canonical_name      TEXT NOT NULL,
      category            TEXT,
      preferred_vendor    TEXT,
      quality_locked      INTEGER NOT NULL DEFAULT 0,
      quality_lock_reason TEXT,
      last_reviewed       TEXT
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
      imported_at TEXT DEFAULT (datetime('now')),
      -- 1 = row holds a recipe-derived placeholder cost (no real vendor
      -- invoice yet) and MUST be ignored by the costing bridge. Backfill
      -- script scripts/flag-placeholder-order-guide.mjs stamps it for
      -- known bad rows; ingest pipelines never set it to 1.
      is_placeholder INTEGER DEFAULT 0
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

    -- dish_components: per-serving component quantities for a Toast dish.
    -- A "component" is either a sub-recipe (recipe_slug populated) or a raw
    -- distributor item (vendor_ingredient populated). Examples:
    --   - bacon_jam (recipe) — house-made sauce
    --   - 8oz Burger Patty (vendor_item) — bought direct from Sysco
    --   - Brioche Bun (vendor_item) — bought direct from Shamrock
    -- Bridges menu pricing → recipe_costs OR vendor_prices.
    -- Each row is "X qty of component Y per single serving of dish Z."
    -- Populated via /menu-engineering/components.
    CREATE TABLE IF NOT EXISTS dish_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      dish_name TEXT NOT NULL,
      component_type TEXT NOT NULL DEFAULT 'recipe'
        CHECK(component_type IN ('recipe', 'vendor_item')),
      recipe_slug TEXT,
      vendor_ingredient TEXT,
      qty_per_serving REAL NOT NULL,
      unit TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (
        (component_type = 'recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL) OR
        (component_type = 'vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)
      )
    );
    -- Partial UNIQUE indexes are created after migrateLegacyColumns ensures
    -- the column shape is current (old dish_components tables without
    -- component_type must be rebuilt before an index can reference it).
    CREATE INDEX IF NOT EXISTS idx_dish_components_dish
      ON dish_components(location_id, dish_name);

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
      event_time TEXT,
      contact_name TEXT,
      guest_count INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'planned',
      tax_rate REAL DEFAULT 0.0675,
      service_fee_pct REAL DEFAULT 20,
      min_spend REAL,
      space TEXT,
      service_style TEXT,
      service_hours REAL,
      bar_mode TEXT,
      bar_amount REAL,
      bar_notes TEXT,
      share_token TEXT,
      share_expires_at TEXT,
      share_revoked_at TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beo_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      item_name TEXT NOT NULL,
      category TEXT,
      unit_cost REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_line_ev ON beo_line_items(event_id);

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

    -- Event-model wave (2026-07-21 spec): AV/production charges and additional
    -- fees, one table with a kind discriminator -- both share an identical
    -- {item, charge, cost} shape. The charge-vs-cost split is the point:
    -- charge bills the client, cost is the house's spend (margin math later).
    -- No location_id -- scoped through the parent event (beo_line_items
    -- precedent; routes verify the event's location).
    CREATE TABLE IF NOT EXISTS beo_event_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      item_name TEXT NOT NULL,
      charge REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_charges_ev ON beo_event_charges(event_id);

    -- Event-model wave: run of show (Studio 5's soe[] {t, what}). show_time is
    -- an operator-typed clock string, not parsed/validated as a timestamp.
    CREATE TABLE IF NOT EXISTS beo_run_of_show (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      show_time TEXT,
      note TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_soe_ev ON beo_run_of_show(event_id);

    -- Historical BEO prep records ingested from past events (catering invoice
    -- 'Kitchen Sheet' tabs and the master workbook's hand-curated 'BEO Prep'
    -- aggregate). NOT joined to beo_events -- past events predate the runtime
    -- cockpit. Read-only reference for kitchen-assistant context
    -- (e.g. "what was prepped for the last birria event").
    CREATE TABLE IF NOT EXISTS beo_prep_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      client TEXT,
      event_date TEXT,            -- ISO YYYY-MM-DD
      event_file TEXT,            -- source xlsx filename if known
      type TEXT,                  -- 'Main Item' | 'Secondary Prep' | 'Special Sauce' | …
      item TEXT NOT NULL,
      amount_qty TEXT,            -- numeric or descriptive (kept as text)
      prep_day TEXT,
      pre_prep_notes TEXT,
      plating_notes TEXT,
      source TEXT NOT NULL,       -- e.g. 'master_workbook_2026-04-18'
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_date
      ON beo_prep_history(location_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_item
      ON beo_prep_history(location_id, item);
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_source
      ON beo_prep_history(location_id, source);

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
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      deleted_by TEXT
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
      -- Bundle G: optional thermometer id linking the reading to a
      -- probe calibration record (see thermometer_calibrations). Null
      -- means "no probe recorded" — reading is still persisted.
      probe_id TEXT,
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

    -- Toast Inc. as a vendor: monthly subscription invoices Lariat pays Toast
    -- (handhelds, KDS, software, gift card program, API, catering & events).
    -- Source: PDFs under data/originals/Toast/Invoices/ (or the pre-scrub archive).
    -- Full-refresh-per-source: ingest deletes all rows for (location_id, source='toast_subscription_invoices')
    -- then re-inserts. Headers + lines are siblings, not FK-joined, so the lines
    -- table can be wiped and rebuilt independently if reparsed.
    CREATE TABLE IF NOT EXISTS toast_subscription_invoices (
      invoice_no    TEXT NOT NULL,
      invoice_date  TEXT NOT NULL,                    -- YYYY-MM-DD
      invoice_total REAL NOT NULL,
      line_count    INTEGER NOT NULL,
      source_pdf    TEXT,
      location_id   TEXT NOT NULL DEFAULT 'default',
      ingested_at   TEXT NOT NULL DEFAULT (datetime('now','subsec')),
      PRIMARY KEY (location_id, invoice_no)
    );
    CREATE INDEX IF NOT EXISTS idx_toast_sub_inv_date ON toast_subscription_invoices(location_id, invoice_date);

    CREATE TABLE IF NOT EXISTS toast_subscription_invoice_lines (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no   TEXT NOT NULL,
      invoice_date TEXT NOT NULL,                     -- denormalized for fast year/month rollups
      line_seq     INTEGER NOT NULL,                  -- 1-based order within the invoice
      item         TEXT NOT NULL,
      qty          INTEGER NOT NULL,                  -- can be negative (credit lines)
      rate         REAL NOT NULL,
      amount       REAL NOT NULL,                     -- can be negative (credit lines)
      location_id  TEXT NOT NULL DEFAULT 'default',
      UNIQUE(location_id, invoice_no, line_seq)
    );
    CREATE INDEX IF NOT EXISTS idx_toast_sub_lines_inv ON toast_subscription_invoice_lines(location_id, invoice_no);
    CREATE INDEX IF NOT EXISTS idx_toast_sub_lines_item ON toast_subscription_invoice_lines(location_id, item, invoice_date);
  `);

  // Cloud-bridge outbox — disk-backed queue for outage tolerance when
  // pushing snapshots to a future cloud peer. See docs/cloud-bridge-design.md
  // ("Next PR's job" item 3) and lib/cloudBridgeQueue.ts. Status today:
  // queue + tests landed, drainer + remote backend land in a follow-on PR
  // once the operator picks the cloud peer (Cloudflare Worker etc.).
  //
  // claimed_at NULL = queued; non-NULL = in-flight or dead-lettered.
  // dead_letter = 1 means attempts > maxAttempts; never re-claimed.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_bridge_outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name    TEXT NOT NULL,
      location_id   TEXT NOT NULL DEFAULT 'default',
      rows_json     TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      dead_letter   INTEGER NOT NULL DEFAULT 0,
      enqueued_at   TEXT NOT NULL DEFAULT (datetime('now')),
      claimed_at    TEXT,
      -- Audit H6 (2026-05-14): per-process claim owner. Set by claim()
      -- to lib/cloudBridgeQueue::OWNER (a UUID generated at module
      -- load). releaseAllClaimedRows() filters by this so a graceful
      -- shutdown only releases rows THIS process is holding — never
      -- yanks an in-flight claim out from under another drainer
      -- running in a different process (e.g. the standalone
      -- scripts/cloud-bridge-drainer.mjs alongside the in-process
      -- drainer from instrumentation.ts). sweepStaleClaims still
      -- ignores ownership (it's a time-based recovery for crashed
      -- holders, where the original owner is by definition gone).
      claim_owner   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cbo_drain
      ON cloud_bridge_outbox(dead_letter, claimed_at, id);
  `);
}

/** Phase 4-narrow: shows / specials / specials promotions / KDS tickets. */
function initPhase4Schema(db: DB): void {
  // ── Phase 4-narrow: shows / archive / tiktok ─────────────────────
  // Source-of-truth: drive-event-ops-dl/Lariat_Shows_MKT_Plan(...).xlsx
  // Lauren edits xlsx; `npm run ingest:shows` is the only mutation path.
  // Re-ingest is idempotent (DELETE+INSERT keyed on location_id).
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
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
    CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(location_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_shows_band ON shows(location_id, band_name);

    CREATE TABLE IF NOT EXISTS shows_archive (
      id            INTEGER PRIMARY KEY,
      location_id   TEXT NOT NULL DEFAULT 'default',
      band_name     TEXT NOT NULL,
      show_date     TEXT NOT NULL,
      era_year      INTEGER,
      source_row    INTEGER NOT NULL,
      ingested_at   TEXT NOT NULL,
      ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shows_archive_date ON shows_archive(location_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_shows_archive_band ON shows_archive(location_id, band_name);

    CREATE TABLE IF NOT EXISTS tiktok_ideas (
      id            INTEGER PRIMARY KEY,
      location_id   TEXT NOT NULL DEFAULT 'default',
      idea          TEXT NOT NULL,
      video_content TEXT,
      staff_needed  TEXT,
      props         TEXT,
      notes         TEXT,
      source_row    INTEGER NOT NULL,
      ingested_at   TEXT NOT NULL,
      ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
    );

    -- ── Phase 2 event-ops tables ────────────────────────────────────
    -- Per-show operator-mutable state: stage setup (room config + run-of-show
    -- + hospitality + tech rider), sound scenes (multiple per show),
    -- box-office lines (one row per ticket-source line). FK shows.id.
    -- All audited via lib/auditEvents.ts in the same tx as the source INSERT.
    -- See docs/PHASE2_PLAN.md for the full schema + migration story.

    CREATE TABLE IF NOT EXISTS stage_setups (
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
    CREATE INDEX IF NOT EXISTS idx_stage_setups_show
      ON stage_setups(show_id, location_id);

    CREATE TABLE IF NOT EXISTS sound_scenes (
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
    CREATE INDEX IF NOT EXISTS idx_sound_scenes_show
      ON sound_scenes(show_id, location_id);

    -- V3: append-only time-series of dB readings taken by the sound
    -- engineer during a show. Drives the sparkline in /shows/[id]/sound
    -- and the SPL pill on Tonight · Live. scene_id is nullable — readings
    -- can land before a scene exists; once a scene is saved subsequent
    -- readings carry its id for downstream filtering. Operational data
    -- (not regulated cash custody / HACCP) — audited via auditLog.mjs.
    CREATE TABLE IF NOT EXISTS spl_readings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id          INTEGER NOT NULL REFERENCES shows(id),
      location_id      TEXT NOT NULL DEFAULT 'default',
      scene_id         INTEGER REFERENCES sound_scenes(id),
      db_value         REAL NOT NULL,
      taken_at         TEXT NOT NULL DEFAULT (datetime('now')),
      taken_by_cook_id TEXT,
      notes            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_spl_readings_show
      ON spl_readings(show_id, location_id, taken_at);

    CREATE TABLE IF NOT EXISTS box_office_lines (
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
    CREATE INDEX IF NOT EXISTS idx_box_office_show
      ON box_office_lines(show_id, location_id);
    CREATE INDEX IF NOT EXISTS idx_box_office_source_ext
      ON box_office_lines(source, external_ref);
    -- Phase 2 DICE box-office ingest — idempotency on (source, external_ref).
    -- The DICE order id is the natural key per Phase 2 plan §C2 + the
    -- doc-comment in lib/boxOfficeRepo.ts. A partial UNIQUE index lets
    -- bulkUpsertFromDice use ON CONFLICT to dedupe retries — without
    -- it, a network-hiccup retry produces duplicate rows that inflate
    -- grossCents in getSettlement, which inflates the talent vsBonus,
    -- which silently overpays talent. Walkup / comp / will_call lines
    -- legitimately have no external_ref and must NOT collide with each
    -- other — the WHERE clause restricts the constraint to non-NULL.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_box_office_external_ref_unique
      ON box_office_lines(source, external_ref)
      WHERE external_ref IS NOT NULL;

    -- Phase 2 task B: deal-point inputs for the per-show settlement.
    -- Cents-as-INTEGER everywhere so settlement math never sees float drift.
    -- Audited via lib/auditEvents.ts (DB stream — talent payouts are
    -- regulated cash custody) inside the same tx as the upsert.
    CREATE TABLE IF NOT EXISTS show_deals (
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
    CREATE INDEX IF NOT EXISTS idx_show_deals_show
      ON show_deals(show_id, location_id);
  `);

  // ── Specials persistence ─────────────────────────────────────────
  // Session snapshots from the Specials Sandbox chat: pantry text,
  // prompt, AI answer/model, captured cost breakdown, scratch notes,
  // and grounding sources. Soft-delete via archived_at; export tracking
  // via last_exported_at. Indexed by (location_id, created_at) and a
  // partial index on active rows only.
  db.exec(`
    CREATE TABLE IF NOT EXISTS specials (
      id                 TEXT PRIMARY KEY,
      location_id        TEXT NOT NULL DEFAULT 'default',
      name               TEXT NOT NULL,
      pantry_text        TEXT NOT NULL DEFAULT '',
      prompt_text        TEXT NOT NULL DEFAULT '',
      ai_answer          TEXT NOT NULL DEFAULT '',
      ai_model           TEXT NOT NULL DEFAULT '',
      cost_breakdown     TEXT,
      cost_total         REAL,
      scratch_notes      TEXT NOT NULL DEFAULT '',
      sources            TEXT,
      last_exported_at   INTEGER,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      archived_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_specials_loc_created
      ON specials(location_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_specials_active
      ON specials(location_id, archived_at) WHERE archived_at IS NULL;
  `);

  // ── Specials → menu promotion records ────────────────────────────
  // One row per promoted special (roadmap 3.6). Promotion materializes
  // the special's costed cost_breakdown into dish_components vendor_item
  // rows under `menu_item_name`, which is how the dish→cost bridge
  // (lib/dishCostBridge.ts) and menu engineering pick up the cost.
  // components_json records which vendor_ingredient rows this promotion
  // owns so an idempotent re-promote can refresh/move them without
  // touching hand-entered components. UNIQUE(location_id, special_id)
  // makes re-promote an update, never a duplicate.
  db.exec(`
    CREATE TABLE IF NOT EXISTS specials_promotions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      special_id      TEXT NOT NULL,
      location_id     TEXT NOT NULL DEFAULT 'default',
      menu_item_name  TEXT NOT NULL,
      servings        REAL NOT NULL DEFAULT 1,
      components_json TEXT NOT NULL DEFAULT '[]',
      promoted_at     INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_specials_promotions_special
      ON specials_promotions(location_id, special_id);
    CREATE INDEX IF NOT EXISTS idx_specials_promotions_menu_item
      ON specials_promotions(location_id, menu_item_name);
  `);

  // ── KDS tickets ──────────────────────────────────────────────────
  // Manual ticket entry for the Lariat-KDS Swift iPad app, used until
  // the Toast Partner ingest lands (the "SWAP POINT" called out in
  // app/api/kds/tickets/route.js). FOH/expo punches a ticket on Lariat,
  // the iPad polls /api/kds/tickets and renders it. Wire shape mirrors
  // docs/lariat-kds-protocol.md §2 verbatim — same field names + types
  // so the Swift parser at Sources/LariatKDSCore/TicketParser.swift
  // doesn't need to change when Toast lands.
  //
  // IDs are TEXT (UUIDv7 from lib/uuid.ts) per the protocol's
  // "string id, stable per ticket / per line" rule. `bumped_at` is
  // present but unused in v1; reserved for the v2 bump-back endpoint.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kds_tickets (
      id            TEXT PRIMARY KEY,
      location_id   TEXT NOT NULL DEFAULT 'default',
      order_number  TEXT NOT NULL,
      placed_at     TEXT NOT NULL,
      destination   TEXT,
      bumped_at     TEXT,
      created_by_cook_id TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kds_tickets_active
      ON kds_tickets(location_id, placed_at DESC)
      WHERE bumped_at IS NULL;

    CREATE TABLE IF NOT EXISTS kds_ticket_lines (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      item_name   TEXT NOT NULL,
      quantity    INTEGER NOT NULL CHECK (quantity >= 1),
      station     TEXT NOT NULL,
      modifiers   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kds_ticket_lines_ticket
      ON kds_ticket_lines(ticket_id, sort_order, id);
  `);
}

/** Stamp {@link SCHEMA_VERSION} into `schema_migrations` (INSERT OR IGNORE). */
function recordSchemaVersion(db: DB): void {
  // ── Schema version marker (P1a spec §7) ──────────────────────────
  // A monotonic marker the native read-only app reads to detect schema
  // drift. Additive + idempotent: the table is created if absent and the
  // current SCHEMA_VERSION is recorded once. INSERT OR IGNORE keeps re-init
  // a no-op and preserves the original applied_at timestamp.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION);
}
