import type { Database as DB } from 'better-sqlite3';

/**
 * Guard against `CREATE TABLE IF NOT EXISTS` silently skipping a legacy
 * table that exists but carries a mismatched schema (e.g. from a failed
 * partial deploy of an earlier T-task). If that happens, INSERTs later fail
 * at runtime with cryptic "no such column" errors — this raises a clear
 * schema-drift error at init time instead.
 */
export function assertCriticalSchemas(db: DB): void {
  const requirements: Record<string, string[]> = {
    ingredient_yields: [
      'ingredient_key', 'yield_pct', 'loss_factor', 'source', 'notes', 'updated_at',
    ],
    manager_pin_users: [
      'location_id', 'name', 'pin_hash', 'role', 'is_active', 'created_at', 'updated_at', 'disabled_at',
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
      'preferred_vendor', 'quality_locked', 'quality_lock_reason', 'last_reviewed',
    ],
    // Phase 3 closed-loop receiving — guard the new closed-loop columns
    // alongside Bundle F so a partial deploy fails loudly at init time
    // instead of dropping silently into a "delivery logged but inventory
    // untouched" state. Pre-Bundle-F rows still carry NULLs on package_ok
    // / expiration_date; the column-presence check is what we're asserting.
    receiving_log: [
      'id', 'shift_date', 'location_id', 'vendor', 'category', 'item',
      'vendor_sku', 'master_id', 'match_status', 'match_reason',
      'reading_f', 'required_max_f', 'package_ok', 'expiration_date',
      'received_qty', 'received_unit',
      'status', 'rejection_reason',
    ],
    inventory_updates: [
      'id', 'shift_date', 'item', 'master_id', 'delta', 'direction',
      'note', 'cook_id', 'location_id', 'receiving_log_id',
    ],
    performance_reviews: [
      'id', 'cook_name', 'cook_uuid', 'review_date', 'punctuality_score',
      'technique_score', 'speed_score', 'notes', 'reviewer_name',
      'location_id', 'created_at',
    ],
    gold_stars: [
      'id', 'cook_name', 'reason', 'stars', 'awarded_date',
      'location_id', 'created_at', 'deleted_at', 'deleted_by',
    ],
    lari_conversation_turns: [
      'schemaVersion', 'id', 'location_id', 'cook_id',
      'conversation_session_id', 'user_content', 'assistant_content',
      'manager_tier', 'created_at', 'expires_at',
    ],
    prep_par: [
      'id', 'location_id', 'station_id', 'recipe_slug', 'ingredient',
      'target_qty', 'unit', 'sort_order', 'note', 'created_at', 'updated_at',
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
