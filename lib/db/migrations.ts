/**
 * Additive migrations, index creation, and the default-location seed.
 *
 * Everything here must stay idempotent and additive — `initSchema` runs it
 * on every `getDb()`, against databases at any prior schema version. Adding
 * a column is `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info`
 * check; never an in-place edit of a `CREATE TABLE` in lib/db/schema/.
 */
import type { Database as DB } from 'better-sqlite3';

export function ensureIndexes(db: DB): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lce_loc_date ON line_check_entries(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_signoff_loc ON station_signoffs(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_86_loc_date ON eighty_six(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_inv_loc_date ON inventory_updates(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_gold_stars_live ON gold_stars(location_id, id DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_psc_vendor_sku ON pack_size_changes(vendor, sku);
    CREATE INDEX IF NOT EXISTS idx_psc_ack ON pack_size_changes(acknowledged, detected_at);
    -- T7: per-master lookup indexes. Placed in ensureIndexes (not inline in
    -- the CREATE TABLE block) so assertCriticalSchemas fires first — a
    -- partial-deploy drift on vendor_prices / bom_lines / ingredient_masters
    -- surfaces as a clean schema error instead of a silent "CREATE INDEX
    -- on a non-existent column" failure.
    CREATE INDEX IF NOT EXISTS idx_vp_master ON vendor_prices(master_id);
    CREATE INDEX IF NOT EXISTS idx_bom_master ON bom_lines(master_id);
    CREATE INDEX IF NOT EXISTS idx_perf_review_cook ON performance_reviews(cook_name, cook_uuid, location_id);
    CREATE INDEX IF NOT EXISTS idx_lari_conversation_partition
      ON lari_conversation_turns(location_id, cook_id, conversation_session_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_lari_conversation_expiry
      ON lari_conversation_turns(expires_at);
  `);

  // Bundle-H: NULL-safe uniqueness on (location, dow/date, service_label).
  // SQLite's table-level UNIQUE constraint already covers the non-NULL case
  // (each non-NULL label is distinct), so we only need partial unique indexes
  // to forbid duplicate NULL-label rows. A partial index avoids the
  // IFNULL(service_label, '') trick, which would conflate NULL with the empty
  // string '' — those are semantically distinct values.
  //
  // These run AFTER the main schema batch, with a deduplication pass and
  // try/catch protection: a database with pre-existing duplicate NULL rows
  // (the very condition this hardening targets) must not crash startup.
  try {
    db.exec(`
      DELETE FROM service_hours
       WHERE service_label IS NULL
         AND id NOT IN (
           SELECT MIN(id) FROM service_hours
            WHERE service_label IS NULL
            GROUP BY location_id, day_of_week
         );
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_service_hours_null_safe
        ON service_hours(location_id, day_of_week)
        WHERE service_label IS NULL;
    `);
  } catch { /* ignore — surfaced via assertCriticalSchemas if catastrophic */ }

  try {
    db.exec(`
      DELETE FROM preshift_notes
       WHERE service_label IS NULL
         AND id NOT IN (
           SELECT MIN(id) FROM preshift_notes
            WHERE service_label IS NULL
            GROUP BY location_id, shift_date
         );
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_preshift_null_safe
        ON preshift_notes(location_id, shift_date)
        WHERE service_label IS NULL;
    `);
  } catch { /* ignore — surfaced via assertCriticalSchemas if catastrophic */ }
}

export function migrateLegacyColumns(db: DB): void {
  // Audit H6 (2026-05-14): claim_owner column on cloud_bridge_outbox.
  // Existing installs created the table before this column existed;
  // ALTER TABLE ADD COLUMN is the additive-migration shape per the
  // project convention. Rows pre-dating the migration have NULL owner
  // and are visible to releaseAllClaimedRows from any process
  // (matches the pre-fix behaviour for legacy rows).
  try {
    const colsCbo = db.prepare('PRAGMA table_info(cloud_bridge_outbox)').all() as { name: string }[];
    if (!colsCbo.some((c) => c.name === 'claim_owner')) {
      db.exec('ALTER TABLE cloud_bridge_outbox ADD COLUMN claim_owner TEXT');
    }
  } catch { /* table missing in some test configs — ignore */ }

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

  // T2 — additive is_hero pin for recipe_photos. Default 0; at most
  // one row per (location_id, recipe_slug) is set to 1 by the PATCH
  // route. The cookbook page falls back to MAX(id) when no hero is
  // pinned. Never edit the original recipe_photos DDL in place — this
  // migration is the only place new columns are added.
  const photoCols = t('recipe_photos');
  if (!photoCols.includes('is_hero')) {
    try {
      db.exec(
        'ALTER TABLE recipe_photos ADD COLUMN is_hero INTEGER NOT NULL DEFAULT 0',
      );
    } catch { /* ignore */ }
  }

  // Cross-host sync replay provenance. Receiving replay needs to map a
  // source-host receiving_log id to the local replayed row id before
  // applying its companion inventory_updates credit. These nullable
  // columns are populated only by lib/syncApply.ts; local route writes
  // leave them NULL and keep the existing operator-facing schema.
  const addSyncSourceCols = (table: string, existingCols: string[]) => {
    const syncCols: [string, string][] = [
      ['sync_source_host', `ALTER TABLE ${table} ADD COLUMN sync_source_host TEXT`],
      ['sync_source_started_at', `ALTER TABLE ${table} ADD COLUMN sync_source_started_at TEXT`],
      ['sync_source_pk', `ALTER TABLE ${table} ADD COLUMN sync_source_pk TEXT`],
    ];
    for (const [col, ddl] of syncCols) {
      if (!existingCols.includes(col)) {
        try { db.exec(ddl); } catch { /* ignore */ }
      }
    }
  };
  addSyncSourceCols('receiving_log', t('receiving_log'));
  addSyncSourceCols('inventory_updates', t('inventory_updates'));

  // Phase 3 closed-loop receiving — inventory_updates rows written by the
  // closed-loop credit path stamp the source receiving_log row id here.
  // The partial UNIQUE index below makes the credit at-most-once per
  // receiving_log row: if the route ever re-enters with the same source
  // id (e.g. a stray retry inside the same transaction or a future
  // backfill that double-runs) the second INSERT fails the constraint
  // and the surrounding tx rolls back. Manual on-hand adjustments + the
  // sales-depletion path leave this NULL — the partial index ignores
  // those rows so they aren't constrained.
  // NOTE: this does NOT defend against true client double-tap (each POST
  // creates a fresh receiving_log row with a fresh id). That's a UI /
  // network-boundary concern; see app/api/receiving/route.js for the
  // documented limit. The handle here protects against in-process
  // double-credit on the SAME source row.
  const invCols = t('inventory_updates');
  if (!invCols.includes('master_id')) {
    try {
      db.exec('ALTER TABLE inventory_updates ADD COLUMN master_id TEXT');
    } catch { /* ignore */ }
  }
  if (!invCols.includes('receiving_log_id')) {
    try {
      db.exec(
        'ALTER TABLE inventory_updates ADD COLUMN receiving_log_id INTEGER REFERENCES receiving_log(id)',
      );
    } catch { /* ignore */ }
  }
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_updates_receiving_log_id
         ON inventory_updates(receiving_log_id)
         WHERE receiving_log_id IS NOT NULL`,
    );
  } catch { /* ignore */ }
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_receiving_log_sync_source
         ON receiving_log(sync_source_host, sync_source_started_at, sync_source_pk)
         WHERE sync_source_host IS NOT NULL
           AND sync_source_started_at IS NOT NULL
           AND sync_source_pk IS NOT NULL`,
    );
  } catch { /* ignore */ }
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_updates_sync_source
         ON inventory_updates(sync_source_host, sync_source_started_at, sync_source_pk)
         WHERE sync_source_host IS NOT NULL
           AND sync_source_started_at IS NOT NULL
           AND sync_source_pk IS NOT NULL`,
    );
  } catch { /* ignore */ }

  // §8 P1 cutover — service-worker replay idempotency.
  //
  // Every regulated POST handler that opts into withIdempotency() (in
  // lib/idempotency.ts) writes the cached response here keyed on the
  // client-supplied UUIDv7 idempotency-key header. A replayed request
  // (e.g. SW retry after a dropped 201) hits the cache and returns the
  // original response without re-running the handler.
  //
  // 24h TTL via lazy sweep on each wrapped POST — no background job.
  // Acceptable because shifts are <24h. Spec + plan at
  // docs/superpowers/{specs,plans}/2026-05-02-sw-replay-idempotency-*.md
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key             TEXT PRIMARY KEY,
        method          TEXT NOT NULL,
        path            TEXT NOT NULL,
        request_hash    TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body   TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_created
        ON idempotency_keys(created_at);
    `);
  } catch { /* ignore */ }

  // GH #249 — reserve-then-run race fix.
  //
  // Pre-fix the withIdempotency wrapper did `lookup → handler() → store`.
  // Two concurrent identical requests both passed the lookup miss, both
  // ran the handler (duplicate audit rows + duplicate writes), then one
  // INSERT lost the PK conflict and the loser silently swallowed it.
  //
  // Post-fix the wrapper reserves the slot up-front by inserting with
  // status='pending'. The second concurrent caller loses the INSERT
  // race, reads the row, and returns 409 "in flight" instead of running
  // the handler. On success the row flips to 'complete' with the real
  // response body; on throw / 401 the row is DELETEd so the next attempt
  // can run fresh.
  //
  // Existing rows are pre-migration completed writes — default 'complete'
  // is correct.
  const idemCols = t('idempotency_keys');
  if (!idemCols.includes('status')) {
    try {
      db.exec(
        `ALTER TABLE idempotency_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'`,
      );
    } catch { /* ignore */ }
  }

  // F15 (FDA §3-301.11): glove-change attestation on each line-check row
  // that touches ready-to-eat food. NULL on pre-migration rows so the
  // backfill is additive and the legacy data stays queryable.
  const lceCols = t('line_check_entries');
  if (!lceCols.includes('glove_change_attested')) {
    try {
      db.exec('ALTER TABLE line_check_entries ADD COLUMN glove_change_attested INTEGER');
    } catch { /* ignore */ }
  }

  // Runtime UX audit 2026-06-04 F2: staff recognition rows must not be
  // hard-deleted. These nullable columns make the delete path a soft archive
  // while preserving pre-migration rows as live records.
  const goldCols = t('gold_stars');
  const goldMigrations: [string, string][] = [
    ['deleted_at', 'ALTER TABLE gold_stars ADD COLUMN deleted_at TEXT'],
    ['deleted_by', 'ALTER TABLE gold_stars ADD COLUMN deleted_by TEXT'],
  ];
  for (const [col, ddl] of goldMigrations) {
    if (!goldCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Phase 1 C1 (GH #267) — day-level sales support on sales_lines.
  // Food cost / prep-forecast distinguish daily vs monthly sales rows:
  //   service_period='day'   → service_date is the YYYY-MM-DD it covers
  //   service_period='month' → whole-month aggregate, service_date NULL
  // Never edit the sales_lines DDL in place — this migration is the only
  // place these columns are added (spec 2026-04-11-food-cost-prep-forecasting
  // §"Component 1 — Schema migration").
  const salesCols = t('sales_lines');
  if (!salesCols.includes('service_date')) {
    try {
      db.exec('ALTER TABLE sales_lines ADD COLUMN service_date TEXT');
    } catch { /* ignore */ }
  }
  if (!salesCols.includes('service_period')) {
    try {
      db.exec('ALTER TABLE sales_lines ADD COLUMN service_period TEXT');
    } catch { /* ignore */ }
  }
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sales_service_date
         ON sales_lines(service_date, location_id)`,
    );
  } catch { /* ignore */ }
  // Backfill: pre-migration monthly analytics rows have NULL service_period.
  // Idempotent — only touches rows still NULL whose label is a monthly
  // "Item Sales" export; daily-ingest rows ('Toast daily …') are left alone.
  try {
    db.exec(
      `UPDATE sales_lines
          SET service_period = 'month'
        WHERE service_period IS NULL
          AND period_label LIKE '%Item Sales%'`,
    );
  } catch { /* ignore */ }

  // accounting_variance: per-vendor breakdown of actual_cogs added when the
  // computation shifted from "spend_monthly.shamrock_total_spend only" to a
  // unified roll-up across shamrock_invoices + sysco_invoices + (legacy)
  // spend_monthly. NULL on pre-migration rows.
  const avCols = t('accounting_variance');
  if (avCols.length > 0 && !avCols.includes('actual_cogs_breakdown_json')) {
    try {
      db.exec('ALTER TABLE accounting_variance ADD COLUMN actual_cogs_breakdown_json TEXT');
    } catch { /* ignore */ }
  }

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

  // dish_components gained component_type + vendor_ingredient so a dish can
  // hold both sub-recipes and raw distributor items (buns, patties, cheese).
  // The old shape had recipe_slug NOT NULL and a single composite UNIQUE,
  // neither of which are compatible with the vendor_item branch. SQLite can't
  // drop a column-level NOT NULL or UNIQUE, so the "unpatchable" path is to
  // rebuild the table. For dev DBs that already created the old shape but
  // haven't had any rows inserted yet, we detect via missing column and
  // rebuild in place, preserving any pre-existing rows as recipe-type.
  const dcCols = t('dish_components');
  if (dcCols.length > 0 && !dcCols.includes('component_type')) {
    // Rebuild the old-shape table: SQLite can't drop a NOT NULL from
    // recipe_slug or change a composite UNIQUE in place, so we rename +
    // recreate + copy. Preserves any existing rows as component_type='recipe'.
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE dish_components RENAME TO dish_components_old;
        CREATE TABLE dish_components (
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
        INSERT INTO dish_components
          (id, location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
           qty_per_serving, unit, notes, created_at, updated_at)
        SELECT id, location_id, dish_name, 'recipe', recipe_slug, NULL,
               qty_per_serving, unit, notes, created_at, updated_at
          FROM dish_components_old;
        DROP TABLE dish_components_old;
        COMMIT;
      `);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('dish_components rebuild migration failed:', err);
    }
  }

  // Partial UNIQUE indexes live here (not in the main schemaSQL block) so
  // they're only created AFTER the column shape is guaranteed current.
  // Idempotent: IF NOT EXISTS skips them on subsequent runs.
  const dcColsAfter = t('dish_components');
  if (dcColsAfter.includes('component_type')) {
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dish_components_recipe_unique
          ON dish_components(location_id, dish_name, recipe_slug)
          WHERE component_type = 'recipe';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dish_components_vendor_unique
          ON dish_components(location_id, dish_name, vendor_ingredient)
          WHERE component_type = 'vendor_item';
      `);
    } catch (err) {
      console.error('dish_components partial-index creation failed:', err);
    }
  }

  const invLineCols = db.prepare('PRAGMA table_info(inventory_count_lines)').all() as {
    name: string;
    notnull: number;
  }[];
  const invSku = invLineCols.find((c) => c.name === 'sku');
  if (invLineCols.length > 0 && invSku && invSku.notnull === 0) {
    try {
      db.exec(`
        BEGIN;
        DROP INDEX IF EXISTS idx_inv_count_lines_count;
        ALTER TABLE inventory_count_lines RENAME TO inventory_count_lines_old;
        CREATE TABLE inventory_count_lines (
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
        INSERT INTO inventory_count_lines
          (id, count_id, vendor, ingredient, sku, on_hand_qty, unit, par_qty,
           par_unit, note, counted_by, counted_at, location_id)
        SELECT id, count_id, vendor, ingredient, COALESCE(sku, ''), on_hand_qty,
               unit, par_qty, par_unit, note, counted_by, counted_at, location_id
          FROM (
            SELECT *,
                   ROW_NUMBER() OVER (
                     PARTITION BY count_id, ingredient, COALESCE(sku, '')
                     ORDER BY datetime(counted_at) DESC, id DESC
                   ) AS rn
              FROM inventory_count_lines_old
          )
         WHERE rn = 1;
        CREATE INDEX idx_inv_count_lines_count
          ON inventory_count_lines(count_id);
        DROP TABLE inventory_count_lines_old;
        COMMIT;
      `);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('inventory_count_lines SKU migration failed:', err);
    }
  }

  // BEO events gained event_time / contact_name / tax_rate / service_fee_pct
  // so the worksheet-style board can store the invoice-header fields.
  const beoCols = t('beo_events');
  const beoMigrations: [string, string][] = [
    ['event_time',      'ALTER TABLE beo_events ADD COLUMN event_time TEXT'],
    ['contact_name',    'ALTER TABLE beo_events ADD COLUMN contact_name TEXT'],
    ['tax_rate',        'ALTER TABLE beo_events ADD COLUMN tax_rate REAL DEFAULT 0.0675'],
    ['service_fee_pct', 'ALTER TABLE beo_events ADD COLUMN service_fee_pct REAL DEFAULT 20'],
    // Increment 2: operator-set F&B minimum spend ($). Nullable, no default.
    ['min_spend',       'ALTER TABLE beo_events ADD COLUMN min_spend REAL'],
    // Client-share token lifecycle. NULL token until the operator generates one.
    // revoked_at closes a leaked URL; expires_at can sunset temporary links.
    // Uniqueness enforced by partial index below.
    ['share_token',      'ALTER TABLE beo_events ADD COLUMN share_token TEXT'],
    ['share_expires_at', 'ALTER TABLE beo_events ADD COLUMN share_expires_at TEXT'],
    ['share_revoked_at', 'ALTER TABLE beo_events ADD COLUMN share_revoked_at TEXT'],
    // Event-model wave (2026-07-21 spec): Studio 5's first-class planning
    // fields. All nullable, no defaults -- absent means "not planned yet"
    // (min_spend precedent). Enum values (service_style: passed|buffet|plated,
    // bar_mode: fill|fixed) are route-validated, not CHECK-constrained.
    ['space',         'ALTER TABLE beo_events ADD COLUMN space TEXT'],
    ['service_style', 'ALTER TABLE beo_events ADD COLUMN service_style TEXT'],
    ['service_hours', 'ALTER TABLE beo_events ADD COLUMN service_hours REAL'],
    ['bar_mode',      'ALTER TABLE beo_events ADD COLUMN bar_mode TEXT'],
    ['bar_amount',    'ALTER TABLE beo_events ADD COLUMN bar_amount REAL'],
    ['bar_notes',     'ALTER TABLE beo_events ADD COLUMN bar_notes TEXT'],
  ];
  for (const [col, ddl] of beoMigrations) {
    if (!beoCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_beo_events_share_token
        ON beo_events(share_token) WHERE share_token IS NOT NULL;
    `);
  } catch { /* ignore */ }

  // BEO line items gained prep-sheet columns (mirrors the archive xlsx
  // layout: ITEM | PREP | SECONDARY PREP | ORDER ITEMS + fire time).
  const beoLineCols = t('beo_line_items');
  const beoLineMigrations: [string, string][] = [
    ['prep_notes',           'ALTER TABLE beo_line_items ADD COLUMN prep_notes TEXT'],
    ['secondary_prep_notes', 'ALTER TABLE beo_line_items ADD COLUMN secondary_prep_notes TEXT'],
    ['order_items_notes',    'ALTER TABLE beo_line_items ADD COLUMN order_items_notes TEXT'],
    ['order_time',           'ALTER TABLE beo_line_items ADD COLUMN order_time TEXT'],
    ['group_note',           'ALTER TABLE beo_line_items ADD COLUMN group_note TEXT'],
    // T4 (BEO course fire-times): nullable FK so pre-existing rows stay
    // valid. ON DELETE SET NULL — deleting a course unbinds its lines
    // rather than dropping them.
    ['course_id',            'ALTER TABLE beo_line_items ADD COLUMN course_id INTEGER REFERENCES beo_courses(id) ON DELETE SET NULL'],
  ];
  for (const [col, ddl] of beoLineMigrations) {
    if (!beoLineCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Per-venue max attendance, used by the Tonight · Live attendance tile
  // to render scanned-vs-capacity. NULL = capacity not set; the tile
  // renders the basic "X scanned" indicator and skips the percent /
  // status color in that case. Operators set this once via SQL or a
  // future settings UI; not auto-detected.
  const locationCols = t('locations');
  const locationMigrations: [string, string][] = [
    ['capacity', 'ALTER TABLE locations ADD COLUMN capacity INTEGER'],
  ];
  for (const [col, ddl] of locationMigrations) {
    if (!locationCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // T7: per-course station_id. Recon showed dish_components has no
  // station_id column, so the SPEC's join chain doesn't work. Per
  // operator mental model ("the entree course goes to grill"),
  // station belongs on the course, not the line. NULL = unassigned
  // bucket on the rollup page.
  const beoCourseCols = t('beo_courses');
  const beoCourseMigrations: [string, string][] = [
    ['station_id', 'ALTER TABLE beo_courses ADD COLUMN station_id TEXT'],
  ];
  for (const [col, ddl] of beoCourseMigrations) {
    if (!beoCourseCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
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

  // order_guide_items.is_placeholder — rows whose unit_price is a
  // recipe-derived placeholder (no real vendor invoice yet) set this to
  // 1 so the dishCostBridge fallback can skip them. Pre-migration rows
  // default to 0; a separate backfill script stamps the known-bad rows.
  const ogCols = t('order_guide_items');
  if (ogCols.length > 0 && !ogCols.includes('is_placeholder')) {
    try {
      db.exec(`ALTER TABLE order_guide_items ADD COLUMN is_placeholder INTEGER DEFAULT 0`);
    } catch { /* ignore */ }
  }

  // Operator quality locks on ingredient_masters — preserved across re-ingest
  // (same posture as preferred_vendor; ingest upsert omits these on conflict).
  const imCols = t('ingredient_masters');
  const imMigrations: [string, string][] = [
    ['quality_locked', 'ALTER TABLE ingredient_masters ADD COLUMN quality_locked INTEGER NOT NULL DEFAULT 0'],
    ['quality_lock_reason', 'ALTER TABLE ingredient_masters ADD COLUMN quality_lock_reason TEXT'],
  ];
  for (const [col, ddl] of imMigrations) {
    if (imCols.length > 0 && !imCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Bundle F — receiving_log gains package_ok (§3-202.15) and
  // expiration_date (§3-101.11). Pre-F rows stay NULL on both; that's
  // the conventional "unrecorded" sentinel the route + rule module
  // reason about.
  // Phase 3 closed-loop receiving — receiving_log gains received_qty
  // and received_unit so an accepted delivery can credit inventory in
  // the same transaction as the source INSERT. Both NULLable: pre-Phase-3
  // rows + new rows where the cook didn't capture a quantity stay NULL
  // (the closed-loop write is opt-in per row; missing qty/unit means
  // "delivery logged, on-hand untouched"). Backfill is intentionally
  // not attempted — historical rows have no provenance for qty/unit.
  const recvCols = t('receiving_log');
  const recvMigrations: [string, string][] = [
    ['package_ok', 'ALTER TABLE receiving_log ADD COLUMN package_ok INTEGER'],
    ['expiration_date', 'ALTER TABLE receiving_log ADD COLUMN expiration_date TEXT'],
    ['received_qty', 'ALTER TABLE receiving_log ADD COLUMN received_qty REAL'],
    ['received_unit', 'ALTER TABLE receiving_log ADD COLUMN received_unit TEXT'],
    ['vendor_sku', 'ALTER TABLE receiving_log ADD COLUMN vendor_sku TEXT'],
    ['master_id', 'ALTER TABLE receiving_log ADD COLUMN master_id TEXT'],
    ['match_status', "ALTER TABLE receiving_log ADD COLUMN match_status TEXT DEFAULT 'not_attempted'"],
    ['match_reason', 'ALTER TABLE receiving_log ADD COLUMN match_reason TEXT'],
  ];
  for (const [col, ddl] of recvMigrations) {
    if (!recvCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Bundle G — temp_log gains `probe_id` so a reading can be tied
  // back to the thermometer that produced it. The column is optional:
  // pre-G rows stay NULL (their probe is not on record) and post-G
  // rows can still omit it if the operator is using an uncalibrated
  // wall thermometer. The calibrations rule module uses this column
  // to surface an advisory warning when a cook references a probe
  // that has a failed / overdue / missing calibration — the write is
  // NOT rejected (that's a worse posture than letting the reading
  // land and flagging the probe), it's just audited.
  const tempCols = t('temp_log');
  const tempMigrations: [string, string][] = [
    ['probe_id', 'ALTER TABLE temp_log ADD COLUMN probe_id TEXT'],
  ];
  for (const [col, ddl] of tempMigrations) {
    if (!tempCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Bundle G-fix — thermometer_calibrations gains `frequency_days` so
  // per-probe calibration interval overrides are reachable from the API
  // (not just from test fixtures). NULL means "use the default 30-day
  // schedule"; a positive integer overrides the default for that probe.
  const thermcalCols = t('thermometer_calibrations');
  const thermcalMigrations: [string, string][] = [
    ['frequency_days', 'ALTER TABLE thermometer_calibrations ADD COLUMN frequency_days INTEGER'],
  ];
  for (const [col, ddl] of thermcalMigrations) {
    if (!thermcalCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Location-level configuration — the BEO worksheet previously hardcoded
  // tax_rate (0.0675) and service_fee_pct (20) as per-event fallbacks, which
  // meant a manager editing default tax/service had no reachable surface.
  // These columns let /admin/settings drive a per-location default that
  // /api/beo reads when the request body doesn't provide the field.
  const locCols = t('locations');
  const locMigrations: [string, string][] = [
    ['tax_rate',        'ALTER TABLE locations ADD COLUMN tax_rate REAL DEFAULT 0.0675'],
    ['service_fee_pct', 'ALTER TABLE locations ADD COLUMN service_fee_pct REAL DEFAULT 20'],
    ['phone',           'ALTER TABLE locations ADD COLUMN phone TEXT'],
    ['address',         'ALTER TABLE locations ADD COLUMN address TEXT'],
  ];
  for (const [col, ddl] of locMigrations) {
    if (!locCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Soft-archive timestamps. Tables that already use an `active` 0/1 flag get
  // a paired `archived_at` TEXT column. `scripts/archive-stale.mjs` (npm run
  // archive:stale) stamps it when a row is marked inactive, and list UIs can
  // filter `archived_at IS NULL` to hide retired rows. NULL = live; a
  // datetime('now') value = archived. Existing `active = 0` rows are fixed
  // up by the sweep script on first run.
  const archiveTables: string[] = [
    'service_hours',
    'cleaning_schedule',
    'sds_registry',
    'staff_certifications',
  ];
  for (const tbl of archiveTables) {
    const cols = t(tbl);
    if (cols.length === 0) continue; // table doesn't exist in this build
    if (!cols.includes('archived_at')) {
      try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN archived_at TEXT`); } catch { /* ignore */ }
    }
  }

  // recipe_costs was originally created with `recipe_id TEXT PRIMARY KEY`
  // which blocks multi-location (same recipe_id can't exist in two
  // locations). Rebuild to `id INTEGER PRIMARY KEY AUTOINCREMENT` +
  // `UNIQUE(location_id, recipe_id)` matching all other location-scoped
  // tables.
  const rcCols = t('recipe_costs');
  if (rcCols.length > 0 && !rcCols.includes('id')) {
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE recipe_costs RENAME TO recipe_costs_old;
        CREATE TABLE recipe_costs (
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
        INSERT INTO recipe_costs
          (recipe_id, recipe_name, category, yield, yield_unit, batch_cost,
           cost_per_yield_unit, costed_lines, total_lines, interpretations,
           location_id, imported_at)
        SELECT recipe_id, recipe_name, category, yield, yield_unit, batch_cost,
               cost_per_yield_unit, costed_lines, total_lines, interpretations,
               location_id, imported_at
          FROM recipe_costs_old;
        DROP TABLE recipe_costs_old;
        COMMIT;
      `);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('recipe_costs PK migration failed:', err);
    }
  }
}

/**
 * Move manager PIN users stranded under 'default' to the venue this install
 * actually serves.
 *
 * app/api/auth/manager-pins used to resolve the venue from the URL/body, both
 * falling back to 'default', while login has always resolved it from the
 * environment. On an install with LARIAT_LOCATION_ID set to anything else,
 * every PIN a GM added landed somewhere login would never look.
 *
 * Repointing the CRUD alone would leave those rows orphaned and empty the
 * board mid-service, so the rows move with it. Idempotent: after the first
 * run there are no 'default' rows left to move, and on a single-venue install
 * (env unset, or literally 'default') the WHERE clause matches its own target
 * and the guard below skips it entirely.
 */
export function repairManagerPinLocation(db: DB, envLocationId: string): void {
  if (!envLocationId || envLocationId === 'default') return;
  const stranded = db
    .prepare(`SELECT COUNT(*) AS c FROM manager_pin_users WHERE location_id = 'default'`)
    .get() as { c: number };
  if (stranded.c === 0) return;
  db.prepare(`UPDATE manager_pin_users SET location_id = ? WHERE location_id = 'default'`)
    .run(envLocationId);
   
  console.warn(
    `[lariat] moved ${stranded.c} manager PIN user(s) from 'default' to '${envLocationId}' — ` +
      'they were written by the pre-fix admin CRUD and login could not see them.',
  );
}

export function seedDefaultLocation(db: DB): void {
  const n = db.prepare(`SELECT COUNT(*) as c FROM locations WHERE id = 'default'`).get() as { c: number };
  if (n.c === 0) {
    db.prepare(`INSERT INTO locations (id, name) VALUES ('default', 'The Lariat')`).run();
  }
}
