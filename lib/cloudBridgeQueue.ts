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
 * is left with claimed_at set but never resolved. The drainer should
 * call sweepStaleClaims() on each tick before claiming to reset
 * orphaned rows back to the queued state.
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
        WHERE dead_letter = 0
          AND claimed_at IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}

/**
 * Recover orphaned in-flight claims. If a process dies between claim()
 * and ack()/nack(), the row is left with `claimed_at` set forever and is
 * invisible to subsequent claim() calls. This function resets such rows
 * back to the queued state so they can be re-claimed.
 *
 * Resets `claimed_at` to NULL on rows where `claimed_at` is older than
 * `maxAgeSeconds` ago AND the row is not dead-lettered. Returns the
 * number of rows actually swept.
 *
 * Does NOT touch `attempts` (the work was attempted at claim time and
 * that history stands — the result was just lost), and does NOT touch
 * `last_error` or dead-lettered rows (terminal state).
 *
 * Default `maxAgeSeconds = 300` (5 minutes) — long enough that a
 * healthy in-flight push will finish, short enough that an
 * outage-recovery cycle isn't badly delayed. The eventual drainer
 * should call this on each tick before claiming.
 */
export function sweepStaleClaims(maxAgeSeconds: number = 300): number {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) return 0;
  const result = getDb()
    .prepare(
      `UPDATE cloud_bridge_outbox
          SET claimed_at = NULL
        WHERE claimed_at IS NOT NULL
          AND dead_letter = 0
          AND claimed_at < datetime('now', ?)`,
    )
    .run(`-${maxAgeSeconds} seconds`);
  return result.changes;
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

// ─────────────────────────────────────────────────────────────────
// Dead-letter triage helpers (Item 9).
//
// The drainer dead-letters a batch after DEFAULT_MAX_ATTEMPTS failed
// pushes; it stays on disk forever for diagnostics but is invisible
// to claim(). These helpers power the /management/cloud-bridge UI so
// a manager can inspect, requeue, or drop dead-lettered rows.
//
// All three are pure SQLite — audit/PIN/location-scoping live at the
// route layer, not here.
// ─────────────────────────────────────────────────────────────────

export interface DeadLetterBatch {
  id: number;
  table: string;
  locationId: string;
  rows: unknown[];
  attempts: number;
  lastError: string | null;
  enqueuedAt: string;
  /** When the row was last claimed; nack-to-DLQ stamps this as a tombstone. */
  claimedAt: string | null;
}

interface DeadLetterRow {
  id: number;
  table_name: string;
  location_id: string;
  rows_json: string;
  attempts: number;
  last_error: string | null;
  enqueued_at: string;
  claimed_at: string | null;
}

function hydrateDeadLetterBatch(row: DeadLetterRow): DeadLetterBatch {
  let rows: unknown[];
  try {
    const parsed = JSON.parse(row.rows_json);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Defensive: a corrupt rows_json shouldn't crash the triage UI.
    // The operator still needs to see (and probably drop) this row.
    rows = [];
  }
  return {
    id: row.id,
    table: row.table_name,
    locationId: row.location_id,
    rows,
    attempts: row.attempts,
    lastError: row.last_error,
    enqueuedAt: row.enqueued_at,
    claimedAt: row.claimed_at,
  };
}

/**
 * List dead-lettered batches, oldest-first (FIFO of failure). Optional
 * `locationId` filter scopes to one site so a manager viewing the
 * `default` location doesn't see another site's dead letters.
 *
 * Returns a fully-hydrated payload (rows are JSON-parsed) so the UI can
 * render an inspect modal without a second round-trip.
 */
export function listDeadLetters(
  opts: { locationId?: string } = {},
): DeadLetterBatch[] {
  const db = getDb();
  const sql = opts.locationId
    ? `SELECT id, table_name, location_id, rows_json, attempts,
              last_error, enqueued_at, claimed_at
         FROM cloud_bridge_outbox
        WHERE dead_letter = 1
          AND location_id = ?
        ORDER BY id ASC`
    : `SELECT id, table_name, location_id, rows_json, attempts,
              last_error, enqueued_at, claimed_at
         FROM cloud_bridge_outbox
        WHERE dead_letter = 1
        ORDER BY id ASC`;
  const rows = (
    opts.locationId
      ? db.prepare(sql).all(opts.locationId)
      : db.prepare(sql).all()
  ) as DeadLetterRow[];
  return rows.map(hydrateDeadLetterBatch);
}

/** Read one dead-lettered batch by id. Returns null when not found or alive. */
export function getDeadLetter(id: number): DeadLetterBatch | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = getDb()
    .prepare(
      `SELECT id, table_name, location_id, rows_json, attempts,
              last_error, enqueued_at, claimed_at
         FROM cloud_bridge_outbox
        WHERE id = ?
          AND dead_letter = 1`,
    )
    .get(id) as DeadLetterRow | undefined;
  return row ? hydrateDeadLetterBatch(row) : null;
}

/**
 * Requeue a dead-lettered batch — clears `dead_letter`, resets `attempts`
 * to zero, drops the stale `claimed_at` tombstone, and clears
 * `last_error` so the next claim sees a clean slate. Returns true when a
 * row was actually requeued.
 *
 * Refuses to touch healthy queued/in-flight rows: only `dead_letter = 1`
 * rows are eligible, so a misrouted action can't kick a live row.
 */
export function requeueDeadLetter(id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const result = getDb()
    .prepare(
      `UPDATE cloud_bridge_outbox
          SET dead_letter = 0,
              attempts = 0,
              claimed_at = NULL,
              last_error = NULL
        WHERE id = ?
          AND dead_letter = 1`,
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Drop a dead-lettered batch — DELETE by id. Returns true when a row
 * was actually deleted.
 *
 * Refuses to touch healthy queued/in-flight rows for the same reason as
 * requeueDeadLetter: only `dead_letter = 1` rows are eligible.
 */
export function dropDeadLetter(id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const result = getDb()
    .prepare(
      `DELETE FROM cloud_bridge_outbox
        WHERE id = ?
          AND dead_letter = 1`,
    )
    .run(id);
  return result.changes > 0;
}
