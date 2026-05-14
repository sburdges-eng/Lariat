/**
 * Cross-host sync change-feed — types + stubs.
 *
 * See docs/multi-instance-sync.md for the full design. This module
 * defines the wire and DB shapes; behaviour is NOT_IMPLEMENTED in this
 * PR and ships in a future PR after perf-reviews unblocks lib/db.ts.
 *
 * Identity convention: `sourceHost` + `sourceStartedAt` mirror the
 * `(host, started_at)` pair used by `lib/hubFailover.ts` for stable peer
 * identity across mDNS name-suffix shuffles. Do not invent a new identity
 * scheme here — peers reconcile with hub-failover by the same key.
 */

/**
 * The four kinds of operation a `sync_feed` row can describe.
 *
 * - `insert` / `update` / `delete` are per-row.
 * - `delete-batch` is the financial-tier pattern: an entire ingest run is
 *   one envelope keyed on `ingest_run_id` so the receiver can apply the
 *   DELETE+INSERT-per-ingest semantics atomically. Per-row updates inside
 *   that envelope ride the same op_id; only the envelope replays as a
 *   single unit.
 *
 * Append-only HACCP and live-ops tables only ever emit `insert` —
 * corrections are new inserts with `replaces_id` linkage, never UPDATEs.
 * Last-writer-wins live-state tables (recipes, dish_components, etc.)
 * emit `update`; `delete` is rare and reserved for explicit hard deletes.
 */
export type SyncOpKind = 'insert' | 'update' | 'delete' | 'delete-batch';

/**
 * One change-feed envelope. Mirrors the `sync_feed` row shape (see
 * docs/multi-instance-sync.md §"sync_feed schema") with camelCase field
 * names for the in-process call surface; the DB column names are
 * snake_case.
 */
export interface SyncOp {
  /**
   * UUIDv7 — globally unique, monotonic per-host within a boot.
   * Idempotency key for replay: a peer that already saw this op_id
   * MUST silently no-op rather than re-apply.
   */
  opId: string;
  /** Source table. Used by the applier to dispatch to per-table writers. */
  tableName: string;
  /** Multi-tenant scope; matches `location_id` on the source table. */
  locationId: string;
  /** See `SyncOpKind`. */
  opKind: SyncOpKind;
  /**
   * Stringified primary key on the source row. For `delete-batch` this is
   * the batch key (e.g. an `ingest_run_id`) rather than a row PK; the
   * applier uses it to scope the wholesale DELETE+INSERT envelope.
   */
  rowPk: string;
  /**
   * JSON-encoded row body. Must be JSON-parseable. Empty object (`'{}'`)
   * for `delete`. For `delete-batch` it carries the post-DELETE INSERT
   * payload (rows array under a documented key — see design doc).
   */
  rowJson: string;
  /** ISO 8601 timestamp the op was appended on the source host. */
  createdAt: string;
  /**
   * mDNS host of the originating instance. Same identity convention as
   * `lib/hubFailover.ts`: pair this with `sourceStartedAt` to form the
   * stable `(host, started_at)` key.
   */
  sourceHost: string;
  /**
   * ISO 8601 boot timestamp of the originating instance. Monotonic within
   * a single host's boot; do NOT use to order events across hosts (clock
   * skew makes that unsafe — see design doc §"Failure modes").
   */
  sourceStartedAt: string;
}

import { getDb } from './db.ts';

/**
 * Append a single op to the local sync feed. Intended call site is the
 * same `db.transaction(...)` block that writes the source row, so an
 * append failure rolls back the source mutation (matches `postAuditEvent`
 * semantics in `lib/auditEvents.ts`).
 *
 * Throws when called outside a transaction so the caller can't acci-
 * dentally drift from the regulated source-write semantics. On a
 * duplicate `op_id` the INSERT no-ops via the UNIQUE index — this is
 * the cross-host idempotency property: the same op arriving twice from
 * a re-fetched window must not double-apply.
 */
export function appendOp(op: SyncOp): void {
  const db = getDb();
  if (!db.inTransaction) {
    throw new Error(
      `appendOp called outside of a transaction context (table=${op.tableName}, op_id=${op.opId}). ` +
        `Atomicity is required — an append failure must roll back the source row. ` +
        `Wrap the source INSERT and the appendOp call inside a single db.transaction(...).`,
    );
  }
  // ON CONFLICT (op_id) DO NOTHING is the *narrow* idempotency carve-out:
  // a duplicate op arriving from a re-fetched window is silently absorbed.
  // CHECK constraint violations (e.g. an invalid op_kind) and any other
  // table-level rejection still throw — we never want to silently lose
  // a malformed op that the caller built incorrectly.
  db.prepare(
    `INSERT INTO sync_feed
       (op_id, table_name, location_id, op_kind, row_pk, row_json,
        created_at, source_host, source_started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(op_id) DO NOTHING`,
  ).run(
    op.opId,
    op.tableName,
    op.locationId,
    op.opKind,
    op.rowPk,
    op.rowJson,
    op.createdAt,
    op.sourceHost,
    op.sourceStartedAt,
  );
}

export interface ReplayPage {
  ops: SyncOp[];
  /** Next rowid to fetch — null when caught up. */
  nextOp: number | null;
  /**
   * Highest rowid the server actually observed in this scan. Always
   * present, regardless of whether more rows exist. Receivers MUST
   * checkpoint to MAX(currentCheckpoint, lastSeenId) on success rather
   * than synthesizing `fromOp + ops.length`, which skips rows when
   * `sync_feed.id` has gaps (rolled-back txs, WAL recovery, etc.).
   *
   * Audit fix H3 (2026-05-14): pre-fix the receiver could enter an
   * infinite re-fetch loop on a sparse rowid sequence.
   */
  lastSeenId: number;
}

const DEFAULT_REPLAY_LIMIT = 500;
const MAX_REPLAY_LIMIT = 2000;

/**
 * Replay every op a given peer has not yet observed, ordered by feed
 * rowid (insertion order). Idempotent: callers that re-request from the
 * same `fromRowId` get the same result.
 *
 * The peer cursor (`replay_checkpoints` row) is **read but not written**
 * by this function — the receiver advances its own checkpoint after it
 * successfully applies a contiguous prefix. That keeps replaySince a
 * pure read operation so a stale or malicious caller cannot DoS the
 * server-side cursor.
 *
 * Args:
 *   peerId    — caller's stable `peerKey()` (host, started_at).
 *   fromRowId — caller's highest applied rowid from this server's feed.
 *   limit     — optional page size; clamped to [1, MAX_REPLAY_LIMIT].
 */
export function replaySince(
  peerId: string,
  fromRowId: number,
  limit?: number,
): ReplayPage {
  // peerId is currently unused by the read query — every peer sees the
  // same feed. It is captured here for forward-compatible logging and
  // for the future hub-of-hubs topology where the feed_scope filter
  // might depend on the requesting peer's role.
  void peerId;

  const lim = Math.max(
    1,
    Math.min(MAX_REPLAY_LIMIT, Math.floor(limit ?? DEFAULT_REPLAY_LIMIT)),
  );
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         id,
         op_id        AS opId,
         table_name   AS tableName,
         location_id  AS locationId,
         op_kind      AS opKind,
         row_pk       AS rowPk,
         row_json     AS rowJson,
         created_at   AS createdAt,
         source_host  AS sourceHost,
         source_started_at AS sourceStartedAt
       FROM sync_feed
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(fromRowId, lim + 1) as ({ id: number } & SyncOp)[];

  // We over-fetched by 1 to detect "more available". Trim to `lim`
  // and use the (lim+1)-th row to compute nextOp.
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const lastId = page.length > 0 ? page[page.length - 1]!.id : fromRowId;

  const ops: SyncOp[] = page.map(({ id: _id, ...rest }) => rest);
  // lastSeenId is the highest rowid we OBSERVED in this scan, regardless
  // of whether more rows exist beyond `lim`. Empty page → unchanged.
  return { ops, nextOp: hasMore ? lastId : null, lastSeenId: lastId };
}

/** Read a peer's current replay checkpoint. Returns 0 when no row exists. */
export function getReplayCheckpoint(
  peerId: string,
  feedScope: string = 'local',
): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT last_op_rowid FROM replay_checkpoints
       WHERE peer_id = ? AND feed_scope = ?`,
    )
    .get(peerId, feedScope) as { last_op_rowid: number } | undefined;
  return row?.last_op_rowid ?? 0;
}

/**
 * Advance (or set) a peer's replay checkpoint. The receiver calls this
 * after it successfully applies a contiguous prefix from replaySince().
 *
 * Idempotent: setting to a value ≤ current is a no-op (checkpoints
 * MUST NOT regress except through an explicit reset call, which this
 * function deliberately does not provide).
 */
export function setReplayCheckpoint(
  peerId: string,
  lastOpRowId: number,
  feedScope: string = 'local',
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO replay_checkpoints (peer_id, feed_scope, last_op_rowid, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(peer_id, feed_scope) DO UPDATE SET
       last_op_rowid = MAX(replay_checkpoints.last_op_rowid, excluded.last_op_rowid),
       updated_at    = datetime('now')`,
  ).run(peerId, feedScope, lastOpRowId);
}
