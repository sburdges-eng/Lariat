import type { Database as DB } from 'better-sqlite3';

/**
 * Canonical entity layer (Phase 1 of the entity-layer rollout).
 *
 * Goal: every Employee, Vendor, MenuItem, Recipe, Ingredient, and
 * PurchaseOrder gets ONE permanent UUID v7 PK that all source-system
 * tables (Toast, 7shifts, Prism, Shamrock, Sysco, manual) reference
 * via the `external_ids` registry. Replaces today's free-text-string
 * joins documented in audit §1/§2/§9.
 *
 * Posture:
 *   - Additive only — existing tables (sales_lines, bom_lines, etc.) are
 *     untouched in Phase 1; their migration to FK against these UUIDs is
 *     Phase 2.
 *   - PKs are UUID v7 strings (lib/uuid.ts::uuidv7). Time-ordered so SQLite
 *     B-tree pages stay tight under high-cardinality inserts.
 *   - external_ids carries (source_system, external_id, location_id,
 *     entity_type) as the unique key. Toast guids are per-location, so
 *     location_id is part of the key — same Toast guid at two restaurants
 *     resolves to two distinct UUIDs.
 *   - All entity tables carry created_at/updated_at audit timestamps.
 */
export function initEntitySchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities_employees (
      uuid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      primary_email TEXT,
      primary_phone TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entities_vendors (
      uuid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      category TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entities_menu_items (
      uuid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      category TEXT,
      base_price REAL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entities_menu_items_loc
      ON entities_menu_items(location_id, active);

    -- Recipes get a UUID PK plus a stable slug for backward compatibility
    -- with recipes.json. Slug is unique per location since recipes are
    -- location-scoped (a "house ranch" at site A is a different recipe
    -- than at site B).
    CREATE TABLE IF NOT EXISTS entities_recipes (
      uuid TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      yield_qty REAL,
      yield_unit TEXT,
      category TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(slug, location_id)
    );

    -- Ingredients carry both a UUID PK and a normalized ingredient_key
    -- (parity with scripts/lib/ingredient_key.py). The key is what existing
    -- tables (vendor_prices, bom_lines, ingredient_densities) join on
    -- today; the UUID is what Phase-2 FKs will reference.
    CREATE TABLE IF NOT EXISTS entities_ingredients (
      uuid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      ingredient_key TEXT NOT NULL,
      category TEXT,
      default_unit TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ingredient_key)
    );

    -- Events are first-class entities (Phase 1 declared 'event' in the
    -- external_ids CHECK enum but the table itself was deferred to Phase 5
    -- when Prism.fm wiring lands). Distinct from beo_events: entities_events
    -- is the canonical "this booking exists" record; beo_events stays the
    -- operations sheet (line items, prep tasks, tax/service-fee snapshot).
    -- Phase 5 backfills beo_events.id ↔ entities_events.uuid via external_ids.
    CREATE TABLE IF NOT EXISTS entities_events (
      uuid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      event_date TEXT,
      event_time TEXT,
      venue TEXT,
      headliner TEXT,
      guest_count INTEGER,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK(status IN ('planned','confirmed','cancelled','completed')),
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entities_events_date
      ON entities_events(location_id, event_date);

    CREATE TABLE IF NOT EXISTS entities_purchase_orders (
      uuid TEXT PRIMARY KEY,
      vendor_uuid TEXT NOT NULL REFERENCES entities_vendors(uuid),
      po_number TEXT,
      ordered_at TEXT,
      expected_at TEXT,
      received_at TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','sent','received','cancelled','closed')),
      total_amount REAL,
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entities_po_vendor
      ON entities_purchase_orders(vendor_uuid, status);
    CREATE INDEX IF NOT EXISTS idx_entities_po_loc_date
      ON entities_purchase_orders(location_id, ordered_at);

    -- Cross-system identity registry. Each row says "source S calls this
    -- thing X; internally it's UUID U of type T at location L." A single
    -- UUID can have many rows (Toast guid + 7shifts user_id + manual
    -- alias), but a (source, external_id, location, type) tuple resolves
    -- to exactly one UUID.
    --
    -- entity_type is an enum so a typo at write time fails loud rather
    -- than silently creating a bogus mapping. metadata_json holds source-
    -- specific extras (department, hire date, GUID variant, etc.) that
    -- don't deserve their own column.
    CREATE TABLE IF NOT EXISTS external_ids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN
        ('employee','vendor','menu_item','recipe','ingredient',
         'purchase_order','event')),
      entity_uuid TEXT NOT NULL,
      source_system TEXT NOT NULL,
      external_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      metadata_json TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_system, external_id, location_id, entity_type)
    );
    CREATE INDEX IF NOT EXISTS idx_external_ids_uuid
      ON external_ids(entity_uuid, entity_type);
    CREATE INDEX IF NOT EXISTS idx_external_ids_lookup
      ON external_ids(source_system, entity_type, location_id);

    -- Sales-driven inventory depletion (Phase 3). One row per
    -- (location_id, period_label) successfully applied. Lets the CLI
    -- skip a re-run on a period thats already depleted, and gives
    -- operators an audit trail of "did Mar 2026 already deplete?"
    --
    -- inventory_updates rows written by a depletion run carry a
    -- note of the form "[deplete-run=<id>] ..." so a future
    -- --reapply path can DELETE them safely without touching manual
    -- waste-log rows. Phase 3 doesnt ship --reapply yet (skip-on-
    -- duplicate is the default), but the sentinel is forward-compatible.
    -- Phase 4: 7shifts raw-landing tables. Each row maps directly to one
    -- 7shifts API object (user / shift / time punch). seven_id is the
    -- 7shifts primary key; we keep it on the row alongside the resolver-
    -- assigned employee_uuid so a re-run can ON CONFLICT UPDATE without
    -- losing the entity link. Time fields are ISO-8601 UTC strings
    -- (whatever 7shifts emits — we don't reformat).
    CREATE TABLE IF NOT EXISTS sevenshifts_users (
      seven_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      employee_uuid TEXT,
      first_name TEXT,
      last_name TEXT,
      preferred_name TEXT,
      email TEXT,
      phone TEXT,
      employee_id TEXT,
      role_ids_json TEXT,
      hire_date TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      raw_json TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (seven_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS sevenshifts_shifts (
      seven_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      user_seven_id TEXT,
      employee_uuid TEXT,
      role_id TEXT,
      department_id TEXT,
      start_at TEXT,
      end_at TEXT,
      published INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
      raw_json TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (seven_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sevenshifts_shifts_user
      ON sevenshifts_shifts(user_seven_id, location_id, start_at);

    CREATE TABLE IF NOT EXISTS sevenshifts_time_punches (
      seven_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      user_seven_id TEXT,
      employee_uuid TEXT,
      role_id TEXT,
      clocked_in_at TEXT,
      clocked_out_at TEXT,
      hours_worked REAL,
      approved INTEGER,
      raw_json TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (seven_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sevenshifts_punches_user
      ON sevenshifts_time_punches(user_seven_id, location_id, clocked_in_at);

    -- Phase 5: Prism.fm raw-landing table. Field set is conservative —
    -- we capture the bits Lariat consumes (date, headliner, guest count,
    -- status) plus the full raw_json for forward compatibility. The
    -- ingest script in scripts/ingest-prism.mjs is a SCAFFOLD; the
    -- actual API client is gated on credentials we don't have yet
    -- (see scripts/prism_api/README.md).
    CREATE TABLE IF NOT EXISTS prism_events (
      prism_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      event_uuid TEXT,
      display_name TEXT,
      event_date TEXT,
      doors_at TEXT,
      show_at TEXT,
      venue TEXT,
      headliner TEXT,
      supports_json TEXT,
      ticket_count INTEGER,
      capacity INTEGER,
      status TEXT,
      raw_json TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (prism_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prism_events_date
      ON prism_events(location_id, event_date);

    -- Append-only: a --force re-run inserts a NEW row rather than
    -- updating in place. The skip-on-already-applied check picks the
    -- latest row by id and treats any prior run as a "yes, applied"
    -- signal.
    CREATE TABLE IF NOT EXISTS sales_depletion_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      period_label TEXT NOT NULL,
      shift_date TEXT NOT NULL,
      sales_rows_processed INTEGER NOT NULL DEFAULT 0,
      depletions_written INTEGER NOT NULL DEFAULT 0,
      unresolved_dish_count INTEGER NOT NULL DEFAULT 0,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_depletion_runs_period
      ON sales_depletion_runs(location_id, period_label, id DESC);

    -- Cross-host change-feed (docs/multi-instance-sync.md). APPEND-ONLY.
    -- One row per logical operation on a synced source table. Replicated
    -- between LAN peers via the (future) /api/peers/sync-since route.
    -- source_host + source_started_at form the stable identity from
    -- lib/hubFailover.ts; do not use service name.
    CREATE TABLE IF NOT EXISTS sync_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- UUIDv7. Globally unique; idempotency key for replay.
      op_id TEXT NOT NULL UNIQUE,
      -- Source table on the originating host (e.g. 'cooling_log').
      table_name TEXT NOT NULL,
      -- Multi-tenant scope; matches the source row's location_id.
      location_id TEXT NOT NULL DEFAULT 'default',
      -- Operation kind; see SyncOpKind in lib/syncFeed.ts.
      op_kind TEXT NOT NULL
        CHECK(op_kind IN ('insert','update','delete','delete-batch')),
      -- Stringified PK (or batch key for delete-batch).
      row_pk TEXT NOT NULL,
      -- JSON-encoded row body. '{}' for delete; rows-array payload for
      -- delete-batch envelopes.
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- Originating instance identity. Pair: (host, started_at) per
      -- lib/hubFailover.ts.
      source_host TEXT NOT NULL,
      source_started_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_feed_replay
      ON sync_feed(id);
    CREATE INDEX IF NOT EXISTS idx_sync_feed_source
      ON sync_feed(source_host, source_started_at, id);
    CREATE INDEX IF NOT EXISTS idx_sync_feed_table
      ON sync_feed(location_id, table_name, id);

    -- Per-peer replay cursor. One row per known peer. last_op_rowid is the
    -- highest sync_feed.id this peer has acknowledged applying.
    CREATE TABLE IF NOT EXISTS replay_checkpoints (
      peer_id TEXT NOT NULL,
      feed_scope TEXT NOT NULL DEFAULT 'local',
      last_op_rowid INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (peer_id, feed_scope)
    );

    -- Peer trust allowlist for /api/peers/sync-since. A peer must
    -- present its raw 32-byte Ed25519 pubkey (hex) as X-Lariat-Peer-Pubkey
    -- and a signature over the canonical signing payload (see
    -- lib/peerTrust.ts::SIGNING_PAYLOAD). The fingerprint is a derived
    -- 16-hex-char identifier (lib/peerKeypair.ts::fingerprint) used by
    -- mDNS TXT records + the /management peers UI. Revoked peers stay
    -- on the row for audit but their requests are rejected.
    CREATE TABLE IF NOT EXISTS peer_trust (
      pubkey_hex TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_peer_trust_fingerprint
      ON peer_trust(fingerprint);
  `);
}
