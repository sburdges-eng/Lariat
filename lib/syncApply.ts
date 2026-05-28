// lib/syncApply.ts
//
// Receiving-side applier for ops pulled from a peer's
// /api/peers/sync-since window. Composes with lib/syncFeed.ts
// (replaySince producer side) and lib/syncClient.ts (HTTP fetch).
//
// Conflict policy per docs/multi-instance-sync.md §"Conflict policy
// per table family":
//
//   Family 1 (HACCP + live-ops append-only):
//     17 tables (cooling_log, temp_log_entries, receiving_log, etc.).
//     INSERT OR IGNORE on op_id-equivalent — but we use the rowJson
//     payload's natural shape (no `op_id` column on the source table).
//     The "no double-apply" invariant is enforced at the sync_feed
//     layer: appendOp is INSERT-ON-CONFLICT-DO-NOTHING on sync_feed.op_id,
//     so an op that re-arrives never reaches the applier twice for the
//     same source. Receivers run with a per-source replay_checkpoint
//     that only advances after a successful applyOp, so re-fetched
//     windows replay safely.
//
//   Family 2 (financial DELETE+INSERT-per-ingest):
//     6 tables (vendor_prices, recipe_costs, bom_lines,
//     order_guide_items, settlement_summaries, spend_monthly).
//     A delete-batch envelope carries `{ where, rows }` in rowJson;
//     the applier DELETEs by `where` then INSERTs `rows`, all in one
//     transaction.
//
//   Family 3 (LWW live state):
//     `recipes`, `dish_components`, `entities_*`. Deferred to v2 —
//     v1's single-KM workflow doesn't exercise concurrent recipe edits,
//     and the design doc explicitly punts the OT/CRDT model. For now
//     family-3 ops are SKIPPED with an audit-log entry; operators see
//     them in `data/audit/management-actions.jsonl` under
//     `sync_apply.skip_family3`.
//
// Schema-drift defense (design doc §"Failure modes"): every family-1
// or family-2 write filters rowJson keys against the LOCAL
// PRAGMA table_info before INSERT, so a producer carrying an extra
// column doesn't blow up the receiver's INSERT. Unknown tables and
// unknown rowJson kinds skip + log.

import type { Database as DB } from 'better-sqlite3';
import type { SyncOp } from './syncFeed.ts';
import { logAuditAction } from './auditLog.mjs';
import { clearSchemaCache, getTableColumnsCached } from './schemaCache.ts';

// Family table names MUST match the live schema in lib/db.ts exactly.
// audit C1 (2026-05-14) caught 7 HACCP names that diverged — those
// tables silently skipped replication because familyOf() returned
// 'unknown' for them. The names here are now verified against
// `CREATE TABLE IF NOT EXISTS <name>` in lib/db.ts; the
// assertFamilyTablesExist() helper below pins the contract at boot.

/** Family 1: append-only HACCP + live-ops. INSERT OR IGNORE semantics. */
export const FAMILY_1_TABLES: ReadonlySet<string> = new Set([
  'audit_events',
  'cooling_log',
  'temp_log',                  // (was temp_log_entries)
  'receiving_log',
  'sanitizer_checks',          // (was sanitizer_log)
  'date_marks',
  'sick_worker_reports',       // (was sick_worker_log)
  'thermometer_calibrations',  // (was calibrations_log)
  'cleaning_log',
  'pest_control_log',          // (was pest_log)
  'sds_registry',              // (was sds_log)
  'tphc_entries',              // (was tphc_log)
  'beo_events',
  'beo_courses',
  'beo_line_items',
  'beo_prep_tasks',
  'inventory_updates',
  'line_check_entries',
  'station_signoffs',
  'eighty_six',
  'inventory_counts',
]);

/** Family 2: financial DELETE+INSERT-per-ingest. */
export const FAMILY_2_TABLES: ReadonlySet<string> = new Set([
  'vendor_prices',
  'recipe_costs',
  'bom_lines',
  'order_guide_items',
  // 'settlement_summaries' removed — settlements are computed at read
  // time from show_deals + box_office_lines + toast_sales_daily, not
  // persisted in a settlement_summaries table. If a future PR adds
  // such a table, re-add this set entry alongside.
  'spend_monthly',
]);

/**
 * Audit H5 (2026-05-14): per-table required `where` columns for the
 * family-2 DELETE+INSERT envelope.
 *
 * The applier refuses any envelope whose `where` doesn't include every
 * column listed for that table. Pre-fix, only `location_id` was
 * required (audit C3). Per-table tightening is the extension point for
 * the schema-drift case the audit called out: when the receiver has
 * columns the producer didn't address, a narrow `where` widens the
 * DELETE on the receiver and wipes more rows than intended.
 *
 * Today every table requires only `location_id` because that matches
 * the producer's actual ingest pattern (scripts/ingest-costing.mjs
 * rebuilds per location). Future PRs can tighten per-table by adding
 * natural-key columns (e.g. `recipe_id` for bom_lines, `vendor` +
 * `sku` for vendor_prices) once the producer envelope shape settles.
 *
 * MUST be a superset of any whereCols a legitimate producer sends.
 * Tables not in this map are refused outright — defense against typos
 * in FAMILY_2_TABLES or future tables added there without an entry
 * here.
 */
export const FAMILY_2_REQUIRED_WHERE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['vendor_prices', new Set(['location_id'])],
  ['recipe_costs', new Set(['location_id'])],
  ['bom_lines', new Set(['location_id'])],
  ['order_guide_items', new Set(['location_id'])],
  ['spend_monthly', new Set(['location_id'])],
]);

/** Family 3: LWW live state. v1 SKIPs these — see module doc. */
export const FAMILY_3_TABLES: ReadonlySet<string> = new Set([
  // 'recipes' removed — recipes live in the JSON cache, not a SQL table.
  // Cross-host recipe sync, if it ever lands, would replicate through
  // a different mechanism (file-based or a new entities_recipe_edits
  // surface), not this family.
  'dish_components',
  'entities_employees',
  'entities_ingredients',
  'entities_recipes',
  'entities_menu_items',
  'entities_vendors',
]);

/**
 * Boot-time guard. Throws if any table name in the family sets does
 * not exist in the live schema. Called by the scheduler lifecycle
 * (lib/syncSchedulerLifecycle.ts) so a future schema rename fails
 * loud, not silent.
 *
 * Cheap to run (single PRAGMA scan); safe to call repeatedly.
 */
export function assertFamilyTablesExist(db: DB): void {
  const all = new Set([...FAMILY_1_TABLES, ...FAMILY_2_TABLES, ...FAMILY_3_TABLES]);
  const present = new Set(
    (db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as { name: string }[]).map((r) => r.name),
  );
  const missing = [...all].filter((t) => !present.has(t));
  if (missing.length) {
    throw new Error(
      `syncApply: family-table names do not match schema: ${missing.join(', ')}. ` +
        `Update FAMILY_*_TABLES in lib/syncApply.ts to match lib/db.ts DDL.`,
    );
  }
}

export type Family = 'family1' | 'family2' | 'family3' | 'unknown';

export function familyOf(tableName: string): Family {
  if (FAMILY_1_TABLES.has(tableName)) return 'family1';
  if (FAMILY_2_TABLES.has(tableName)) return 'family2';
  if (FAMILY_3_TABLES.has(tableName)) return 'family3';
  return 'unknown';
}

export interface ApplyResult {
  /** What happened, for the per-source apply-loop's running counters. */
  outcome:
    | 'applied'           // op landed (family 1 INSERT, family 2 tx)
    | 'skipped-family3'   // v1 punts LWW
    | 'skipped-unknown-table'
    | 'skipped-bad-payload'
    | 'skipped-schema-drift';
  /** Brief reason for logs / /management dashboard. */
  reason?: string;
}

// PRAGMA-table-info cache moved to lib/schemaCache.ts so db.ts can
// invalidate it after every migration pass without a circular import.
// See lib/schemaCache.ts for audit context (H2 + H8).
function getTableColumns(db: DB, tableName: string): ReadonlySet<string> | null {
  return getTableColumnsCached(db, tableName);
}

// Re-export so existing call sites + test imports keep working.
export { clearSchemaCache };

/** @deprecated Use `clearSchemaCache()` instead. Kept for the test alias only. */
export const _clearSchemaCacheForTest = clearSchemaCache;

function parseRowJson(op: SyncOp): unknown | undefined {
  try {
    return JSON.parse(op.rowJson);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Filter a row object to columns the local table actually has.
 * Returns { cols, vals, dropped } where cols/vals are aligned arrays
 * suitable for parameterized INSERT, and dropped names anything the
 * producer sent that the local table doesn't carry — surfaces as the
 * schema-drift signal.
 */
function alignToTable(
  row: Record<string, unknown>,
  tableCols: ReadonlySet<string>,
): { cols: string[]; vals: unknown[]; dropped: string[] } {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (tableCols.has(k)) {
      cols.push(k);
      vals.push(v);
    } else {
      dropped.push(k);
    }
  }
  return { cols, vals, dropped };
}

/**
 * Family 1 applier: INSERT OR IGNORE one row.
 *
 * The "or ignore" carve-out is for PK / UNIQUE collisions. Schema-drift
 * (producer sent a column the receiver doesn't have) drops the extra
 * keys — the row still lands with the columns both sides agree on.
 */
function applyFamily1(db: DB, op: SyncOp): ApplyResult {
  const tableCols = getTableColumns(db, op.tableName);
  if (!tableCols) return { outcome: 'skipped-unknown-table', reason: 'PRAGMA returned no cols' };
  const parsed = parseRowJson(op);
  if (!isObject(parsed)) return { outcome: 'skipped-bad-payload', reason: 'rowJson is not an object' };

  const { cols, vals, dropped } = alignToTable(parsed, tableCols);
  if (cols.length === 0) {
    return { outcome: 'skipped-schema-drift', reason: 'no columns overlap local table' };
  }

  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${op.tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
  db.prepare(sql).run(...(vals as never[]));

  return {
    outcome: 'applied',
    reason: dropped.length ? `dropped unknown cols: ${dropped.join(',')}` : undefined,
  };
}

/**
 * Family 2 applier: single-tx DELETE+INSERT envelope.
 *
 * rowJson is expected to be `{ where: {...}, rows: [{...}, ...] }`.
 * where defaults to `{ location_id: op.locationId }` if not provided
 * (matches the most common envelope shape — wholesale per-location
 * rebuild). where keys must all be known columns; missing keys is a
 * schema-drift skip.
 */
function applyFamily2(db: DB, op: SyncOp): ApplyResult {
  const tableCols = getTableColumns(db, op.tableName);
  if (!tableCols) return { outcome: 'skipped-unknown-table', reason: 'PRAGMA returned no cols' };
  const parsed = parseRowJson(op);
  if (!isObject(parsed)) return { outcome: 'skipped-bad-payload', reason: 'rowJson is not an object' };

  const rawWhere = isObject(parsed.where) ? parsed.where : { location_id: op.locationId };
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : null;
  if (rawRows === null) {
    return { outcome: 'skipped-bad-payload', reason: 'rowJson.rows must be an array' };
  }
  for (const r of rawRows) {
    if (!isObject(r)) {
      return { outcome: 'skipped-bad-payload', reason: 'rowJson.rows entries must be objects' };
    }
  }

  const whereCols = Object.keys(rawWhere);

  // Audit C3 guard: an empty `where` would build `DELETE FROM <table>`
  // with no WHERE — wiping every row in the financial table from a
  // single op. Compromised or buggy peer is the threat model. Refuse.
  if (whereCols.length === 0) {
    return {
      outcome: 'skipped-bad-payload',
      reason: 'empty where would wipe entire table — refusing',
    };
  }

  // Audit H5: per-table required-where check. Tables not in the map
  // are refused outright (defensive against typos in FAMILY_2_TABLES
  // or future entries added without a corresponding required-where).
  const required = FAMILY_2_REQUIRED_WHERE.get(op.tableName);
  if (!required) {
    return {
      outcome: 'skipped-bad-payload',
      reason: `table ${op.tableName} has no FAMILY_2_REQUIRED_WHERE entry`,
    };
  }
  const whereColsSet = new Set(whereCols);
  const missingRequired = [...required].filter((c) => !whereColsSet.has(c));
  if (missingRequired.length) {
    return {
      outcome: 'skipped-bad-payload',
      reason: `where missing required cols: ${missingRequired.join(',')}`,
    };
  }

  const unknownWhere = whereCols.filter((k) => !tableCols.has(k));
  if (unknownWhere.length) {
    return {
      outcome: 'skipped-schema-drift',
      reason: `where uses unknown cols: ${unknownWhere.join(',')}`,
    };
  }

  const whereSql = `WHERE ${whereCols.map((c) => `${c} = ?`).join(' AND ')}`;
  const whereVals = whereCols.map((c) => (rawWhere as Record<string, unknown>)[c]);

  let droppedAny: string[] = [];
  db.transaction(() => {
    db.prepare(`DELETE FROM ${op.tableName} ${whereSql}`).run(...(whereVals as never[]));
    for (const row of rawRows as Record<string, unknown>[]) {
      const { cols, vals, dropped } = alignToTable(row, tableCols);
      if (cols.length === 0) continue; // schema drift; skip the row, keep going
      droppedAny = droppedAny.concat(dropped);
      const placeholders = cols.map(() => '?').join(', ');
      db.prepare(
        `INSERT INTO ${op.tableName} (${cols.join(', ')}) VALUES (${placeholders})`,
      ).run(...(vals as never[]));
    }
  })();

  return {
    outcome: 'applied',
    reason: droppedAny.length
      ? `dropped unknown cols across rows: ${[...new Set(droppedAny)].join(',')}`
      : undefined,
  };
}

function applyFamily3(db: DB, op: SyncOp): ApplyResult {
  void db;
  try {
    logAuditAction({
      action: 'sync_apply.skip_family3',
      op_id: op.opId,
      table_name: op.tableName,
      source_host: op.sourceHost,
    });
  } catch {
    // Audit-log failure must not block replay checkpoint progress.
  }
  return { outcome: 'skipped-family3', reason: 'family 3 deferred until LWW metadata exists' };
}

/**
 * Apply one op. Routes by family.
 */
export function applyOp(db: DB, op: SyncOp): ApplyResult {
  const family = familyOf(op.tableName);
  if (family === 'family1') return applyFamily1(db, op);
  if (family === 'family2') return applyFamily2(db, op);
  if (family === 'family3') return applyFamily3(db, op);
  return { outcome: 'skipped-unknown-table', reason: `no family for ${op.tableName}` };
}

/**
 * Apply a contiguous prefix of ops. Returns counters + the highest
 * rowid that was successfully reached, so the caller can advance its
 * replay_checkpoints row to that id and re-request the next window.
 *
 * Caller is expected to wrap the per-window apply in their own tx if
 * they want all-or-nothing semantics across the window. Default
 * (no wrapping) is "best effort": each op applies independently, so a
 * single bad payload doesn't poison the whole window.
 */
export interface ApplyWindowResult {
  applied: number;
  skippedFamily3: number;
  skippedUnknown: number;
  skippedBadPayload: number;
  skippedSchemaDrift: number;
  reasons: string[];
}

export function applyWindow(db: DB, ops: SyncOp[]): ApplyWindowResult {
  const result: ApplyWindowResult = {
    applied: 0,
    skippedFamily3: 0,
    skippedUnknown: 0,
    skippedBadPayload: 0,
    skippedSchemaDrift: 0,
    reasons: [],
  };
  for (const op of ops) {
    const r = applyOp(db, op);
    switch (r.outcome) {
      case 'applied':
        result.applied += 1;
        break;
      case 'skipped-family3':
        result.skippedFamily3 += 1;
        break;
      case 'skipped-unknown-table':
        result.skippedUnknown += 1;
        break;
      case 'skipped-bad-payload':
        result.skippedBadPayload += 1;
        break;
      case 'skipped-schema-drift':
        result.skippedSchemaDrift += 1;
        break;
    }
    if (r.reason) result.reasons.push(`${op.opId}:${r.outcome}:${r.reason}`);
  }
  return result;
}
