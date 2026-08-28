import type { Database as DB } from 'better-sqlite3';

/**
 * Management-layer surfaces (reviews, KPIs, rollup data).
 */
export function initManagementSchema(db: DB): void {
  db.exec(`
    -- Manager PIN users: named local manager credentials beside the
    -- production override PIN. Raw PINs are never stored; only
    -- SHA-256(pin) lives in pin_hash. is_active keeps history without
    -- deleting rows.
    CREATE TABLE IF NOT EXISTS manager_pin_users (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_pin_users_active_pin
      ON manager_pin_users(location_id, pin_hash)
      WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_manager_pin_users_active
      ON manager_pin_users(location_id, is_active, updated_at DESC);

    -- Performance reviews (Lightweight manager-only log).
    CREATE TABLE IF NOT EXISTS performance_reviews (
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lari_conversation_turns (
      schemaVersion TEXT NOT NULL DEFAULT 'lari_conversation_turn_v1'
        CHECK(schemaVersion = 'lari_conversation_turn_v1'),
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      conversation_session_id TEXT NOT NULL,
      user_content TEXT NOT NULL,
      assistant_content TEXT NOT NULL,
      manager_tier INTEGER NOT NULL DEFAULT 0 CHECK(manager_tier IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dish_coverage_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id   TEXT NOT NULL DEFAULT 'default',
      total_dishes  INTEGER NOT NULL,
      covered_dishes INTEGER NOT NULL,
      coverage_pct  REAL NOT NULL,
      uncovered_dishes TEXT NOT NULL DEFAULT '[]',
      created_by    TEXT NOT NULL DEFAULT 'compute_engine',
      snapshot_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Allergen attestations (roadmap 3.3). Append-only: a correction is a
    -- fresh row and the latest row per (location_id, recipe_slug) wins —
    -- rows are NEVER updated or deleted. recipe_fingerprint hashes the
    -- ingredient composition the allergen heuristic reads (own ingredients
    -- + sub-recipe tree), so a later recipe edit renders the attestation
    -- STALE instead of silently inheriting the signoff.
    CREATE TABLE IF NOT EXISTS allergen_attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_slug TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      allergens_json TEXT NOT NULL DEFAULT '[]',
      recipe_fingerprint TEXT NOT NULL,
      attested_by TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_allergen_attestations_latest
      ON allergen_attestations(location_id, recipe_slug, id DESC);
  `);
}
