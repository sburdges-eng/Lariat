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

/**
 * Append a single op to the local sync feed. Intended call site is the
 * same `db.transaction(...)` block that writes the source row, so an
 * append failure rolls back the source mutation (matches `postAuditEvent`
 * semantics in `lib/auditEvents.ts`).
 *
 * Stub. Real implementation lands after perf-reviews unblocks `lib/db.ts`
 * for the `sync_feed` migration.
 */
export function appendOp(_op: SyncOp): never {
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * Replay every op a given peer has not yet observed, ordered by feed
 * rowid (insertion order). Idempotent: callers that re-request from the
 * same `fromRowId` get the same result, and `op_id` collisions on the
 * receiver are no-ops.
 *
 * Stub. Real implementation lands alongside the
 * `/api/peers/sync-since` route in a future PR.
 */
export function replaySince(_peerId: string, _fromRowId: number): never {
  throw new Error('NOT_IMPLEMENTED');
}
