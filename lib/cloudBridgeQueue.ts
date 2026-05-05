// Cloud-bridge outbox — disk-backed queue for outage tolerance.
//
// Why this module exists: pushing snapshots to a cloud peer over the WAN
// will sometimes fail (peer down, DNS hiccup, captive portal at the
// venue). Per docs/cloud-bridge-design.md "Why a bridge, not direct DB
// replication" → "Degrade — queue-on-disk during a WAN outage; resume
// when the cloud peer is reachable again. Venue ops never blocks on
// cloud availability."
//
// What this module IS:
//   - A SQLite-backed FIFO queue keyed on table_name + location_id.
//   - An explicit allow-list of tables that may be enqueued (PII guard).
//   - Claim/ack/nack semantics with attempt tracking and dead-letter.
//
// What this module is NOT:
//   - Not a drainer. The drainer (which actually POSTs claimed batches
//     to the cloud peer and ack/nacks the result) lands when the cloud
//     backend is chosen. This module owns the durable storage layer.
//   - Not a wrapper around CloudBridge. The bridge stub keeps its
//     not-implemented sentinel; callers use this module directly until
//     the wire-in PR lands.
//
// The schema lives in lib/db.ts::initSchema (cloud_bridge_outbox table).

import { getDb } from './db';

/** Sentinel error: caller tried to enqueue a table not on the allow-list. */
export const CLOUD_BRIDGE_TABLE_DENIED = 'cloud bridge: table not on allow-list';

/**
 * Tables that may be pushed to the cloud peer. Mirrors the canonical
 * list in docs/cloud-bridge-design.md "Sync direction priority" →
 * "Per-table opt-in. Default is deny." When docs/data-governance.md
 * eventually owns this list, this Set should re-derive from it.
 */
export const ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'settlement_summaries', // end-of-night totals; coarse, no PII
  'beo_events',           // banquet/event ops; already shared with sales/corp
  'spend_monthly',        // monthly aggregate; no PII
]);

/**
 * Max claim attempts before a batch is moved to dead-letter and stops
 * being re-yielded. Five matches the lib/idempotency.ts retry budget
 * shape. Operators see dead-lettered batches via the eventual
 * /api/cloud-bridge/status surface; manual replay is a follow-on PR.
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

export interface OutboxBatch {
  id: number;
  table: string;
  locationId: string;
  rows: unknown[];
  attempts: number;
  enqueuedAt: string;
}

interface OutboxRow {
  id: number;
  table_name: string;
  location_id: string;
  rows_json: string;
  attempts: number;
  enqueued_at: string;
}

/**
 * Enqueue a batch of rows for `table` to be pushed to the cloud peer.
 * Throws CLOUD_BRIDGE_TABLE_DENIED if `table` is not on ALLOWED_TABLES,
 * or a generic Error if `rows` is empty (no point queueing nothing).
 *
 * Returns the new batch id. The batch is durable — it survives process
 * restart and stays in the queue until ack()'d or moved to dead-letter.
 */
export function enqueue(
  table: string,
  rows: unknown[],
  opts: { locationId: string },
): number {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(CLOUD_BRIDGE_TABLE_DENIED);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('cloud bridge: enqueue called with no rows');
  }
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO cloud_bridge_outbox (table_name, location_id, rows_json)
       VALUES (?, ?, ?)`,
    )
    .run(table, opts.locationId, JSON.stringify(rows));
  return Number(result.lastInsertRowid);
}

/**
 * Claim up to `maxBatch` queued batches in FIFO (id-ascending) order.
 * Marks each claimed batch as in-flight by stamping `claimed_at` and
 * incrementing `attempts`. The drainer should ack() on success or
 * nack() on failure; an in-flight batch is invisible to subsequent
 * claim() calls until acked, nacked, or process death (see Recovery
 * note below).
 *
 * Recovery: if the process dies between claim() and ack/nack, the row
 * is left with claimed_at set but never resolved. A future drainer
 * should sweep stale claims (e.g. claimed_at < now - 5min) back to
 * queued state. Out of scope for this PR; not yet implemented.
 */
export function claim(maxBatch: number): OutboxBatch[] {
  if (!Number.isInteger(maxBatch) || maxBatch <= 0) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, table_name, location_id, rows_json, attempts, enqueued_at
         FROM cloud_bridge_outbox
        WHERE dead_letter = 0
          AND claimed_at IS NULL
        ORDER BY id ASC
        LIMIT ?`,
    )
    .all(maxBatch) as OutboxRow[];

  if (rows.length === 0) return [];

  const update = db.prepare(
    `UPDATE cloud_bridge_outbox
        SET attempts = attempts + 1,
            claimed_at = datetime('now')
      WHERE id = ?`,
  );
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) update.run(id);
  });
  tx(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    table: r.table_name,
    locationId: r.location_id,
    rows: JSON.parse(r.rows_json),
    attempts: r.attempts + 1,
    enqueuedAt: r.enqueued_at,
  }));
}

/**
 * Ack a claimed batch — drainer succeeded in pushing it to the cloud
 * peer. Removes the row from the queue. Idempotent: ack of an unknown
 * id is a silent no-op.
 */
export function ack(id: number): void {
  if (!Number.isInteger(id) || id <= 0) return;
  getDb().prepare(`DELETE FROM cloud_bridge_outbox WHERE id = ?`).run(id);
}

/**
 * Nack a claimed batch — drainer failed. If `attempts < maxAttempts`,
 * returns the batch to the queued state for re-claim. Otherwise moves
 * it to dead-letter (still on disk for diagnostics, never re-claimed).
 *
 * The error string is recorded in `last_error` for the eventual
 * status / dead-letter triage UI.
 */
export function nack(
  id: number,
  errorMessage: string,
  opts: { maxAttempts?: number } = {},
): void {
  if (!Number.isInteger(id) || id <= 0) return;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const db = getDb();

  // We need attempts to decide queued vs dead-letter. Read first.
  const row = db
    .prepare(`SELECT attempts FROM cloud_bridge_outbox WHERE id = ?`)
    .get(id) as { attempts: number } | undefined;
  if (!row) return;

  if (row.attempts >= maxAttempts) {
    db.prepare(
      `UPDATE cloud_bridge_outbox
          SET dead_letter = 1,
              last_error = ?,
              claimed_at = datetime('now')
        WHERE id = ?`,
    ).run(errorMessage, id);
  } else {
    db.prepare(
      `UPDATE cloud_bridge_outbox
          SET claimed_at = NULL,
              last_error = ?
        WHERE id = ?`,
    ).run(errorMessage, id);
  }
}

/** Count of batches available to claim (queued, not in-flight, not dead). */
export function depth(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM cloud_bridge_outbox
        WHERE dead_letter = 0`,
    )
    .get() as { n: number };
  return row.n;
}

/** Count of dead-lettered batches (manual triage required). */
export function deadLetterDepth(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM cloud_bridge_outbox
        WHERE dead_letter = 1`,
    )
    .get() as { n: number };
  return row.n;
}
