# Cross-host sync — design and typed skeleton

## Status: design only — no implementation in this PR

This doc describes how a future Lariat will replicate `data/lariat.db`
between LAN peers (hub + tablets / hub + standby laptop). The current PR
ships:

- this design doc,
- `lib/syncFeed.ts` — typed skeleton with `appendOp` / `replaySince`
  stubs that throw `NOT_IMPLEMENTED`,
- `tests/js/test-sync-feed-types.mjs` — type-import smoke test.

It does **not** ship:

- the `sync_feed` / `replay_checkpoints` migration in `lib/db.ts`
  (deferred — perf-reviews owns the file right now; the migration lands
  in a follow-up PR after that branch merges),
- the `/api/peers/sync-since` HTTP route (named here, implemented later),
- any real behaviour for `appendOp` / `replaySince`.

A future implementer can write the migration and routes from this doc
alone. If the doc and the perf-reviews schema disagree at merge time,
the doc is normative and the migration adapts.

## Scope

**In scope.** LAN peer-to-peer sync of one venue's `data/lariat.db`
between Lariat instances that have already discovered each other via
mDNS (`lib/mdnsDiscovery.ts`) and elected a hub
(`lib/hubElection.ts` + `lib/hubFailover.ts`). All peers belong to one
venue / one tenant.

**Out of scope.** Cloud-bridge (venue → corp office; different problem
domain — see `docs/cloud-bridge-decision.md` and the `pushSnapshot`
work in Item 7). HACCP cross-tenant sync (regulated data never leaves
the venue). Web-scale or multi-region replication. Backfill of historical
rows that pre-date the `sync_feed` migration (deferred to v2 — see
"What's deferred" below).

## Why a change-feed (alternatives considered)

| Approach | Why rejected |
|---|---|
| **Per-row replication via triggers** | SQLite triggers cannot easily capture the (host, started_at) source-identity that hub-failover requires; the trigger fires inside the DB with no access to runtime context. Forcing context into a session-temp table is fragile. |
| **Periodic full-snapshot ship** | Wire-cost is fine for `data/lariat.db` (~tens of MB), but the receiver has to diff to figure out what changed, which loses the audit trail. HACCP requires every regulated insert traceable to its origin host — snapshot diff erases that. |
| **CRDT merge per row** | The HACCP append-only contract (`docs/PATTERNS.md §3` — corrections are new rows with `replaces_id`, never edits) is already CRDT-shaped: it's a grow-only set keyed on row id. CRDT machinery for that table family is overkill. The financial tier (DELETE+INSERT per ingest run) is *fundamentally not* a per-row CRDT — it's last-writer-wins at the *envelope* level. Different tiers want different conflict policies; one CRDT doesn't fit. |
| **Change-feed log (chosen)** | Captures runtime source identity, replays in insertion order, supports per-tier conflict policy at the *applier*, and `op_id` (UUIDv7) gives natural idempotency for re-fetched windows. Matches the existing `audit_events` shape — operators already read append-only event tables. |

## Identity

Stable peer identity is the `(host, started_at)` pair, as defined and
documented in [`lib/hubFailover.ts`](../lib/hubFailover.ts) (see
`peerKey()` and the module docstring). The change-feed mirrors this:
every `sync_feed` row carries `source_host` + `source_started_at`,
populated from the local mDNS advertisement at append time. Service
*name* is not used as identity — it can be reassigned across reboots
and bonjour appends conflict suffixes; both cases would lie.

`source_started_at` is monotonic per-boot per-host. Use it for ordering
events from a single host. **Never** use it to order events across
hosts — clocks drift, and even if NTP-synced the precision isn't
trustworthy at the second level. Cross-host ordering is the receiver's
problem and is solved by per-source replay (each peer is replayed
independently from its own checkpoint).

## `sync_feed` schema (DDL skeleton — to be added in a future PR)

This is what the migration will write. It mirrors `audit_events` style
(`lib/db.ts` ~L2630): integer rowid PK, `created_at TEXT DEFAULT
(datetime('now'))`, `location_id TEXT NOT NULL DEFAULT 'default'`,
shift-style indices.

```sql
-- Cross-host change-feed. APPEND-ONLY. NEVER UPDATE OR DELETE.
-- One row per logical operation on a synced source table. Replicated
-- between LAN peers via /api/peers/sync-since (see "Replay protocol"
-- below). source_host + source_started_at form the stable identity from
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
  -- delete-batch (see "Conflict policy" below).
  row_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Originating instance identity. Pair: (host, started_at) per
  -- lib/hubFailover.ts.
  source_host TEXT NOT NULL,
  source_started_at TEXT NOT NULL
);
-- Replay scan: peer pulls "everything after my last checkpoint".
CREATE INDEX IF NOT EXISTS idx_sync_feed_replay
  ON sync_feed(id);
-- Per-source ordering for diagnostics and recovery.
CREATE INDEX IF NOT EXISTS idx_sync_feed_source
  ON sync_feed(source_host, source_started_at, id);
-- Per-table replay (rare; mostly for debugging an out-of-sync table).
CREATE INDEX IF NOT EXISTS idx_sync_feed_table
  ON sync_feed(location_id, table_name, id);

-- Per-peer replay cursor. One row per known peer. last_op_rowid is the
-- highest sync_feed.id this peer has acknowledged applying.
CREATE TABLE IF NOT EXISTS replay_checkpoints (
  peer_id TEXT NOT NULL,
  -- Which feed are we tracking — currently always the local feed, but
  -- a future hub-of-hubs topology might track multiple.
  feed_scope TEXT NOT NULL DEFAULT 'local',
  last_op_rowid INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (peer_id, feed_scope)
);
```

Field-by-field rationale:

- **`id` (rowid PK)** is the replay cursor key. SQLite guarantees monotonic
  rowid within a connection's lifetime; we accept the (rare) gap from
  rolled-back transactions because replay is gap-tolerant.
- **`op_id` (UUIDv7)** is the cross-host idempotency key. Receivers seeing
  a duplicate `op_id` MUST no-op silently. UUIDv7 is monotonic within a
  host so it doubles as a debug breadcrumb.
- **`row_json`** is a snapshot of the after-state, like `audit_events.payload_json`.
  The receiver does not have to join back to the source table to apply.
- **No `applied` flag.** A receiver tracks what it's applied via its own
  `replay_checkpoints` row, not by mutating the feed. The feed is
  append-only on every host.

## Conflict policy per table family

Three families. Each has a different rule. The rule is enforced at the
applier (the receiving peer), not at the producer.

### Family 1 — Append-only HACCP and live-ops

Tables (HACCP regulated, `docs/PATTERNS.md §1`):

`audit_events`, `cooling_log`, `temp_log_entries`, `receiving_log`,
`sanitizer_log`, `date_marks`, `sick_worker_log`, `calibrations_log`,
`cleaning_log`, `pest_log`, `sds_log`, `tphc_log`, `beo_events`,
`beo_courses`, `beo_line_items`, `beo_prep_tasks`.

Tables (live-ops, append-only by convention):

`inventory_updates`, `line_check_entries`, `station_signoffs`,
`eighty_six`, `inventory_counts`.

**Rule.** CRDT-style add-only set keyed on `op_id`. Concurrent inserts
from two peers are simply concatenated; the receiver applies whichever
arrives first and skips the second on `op_id` UNIQUE. There is no
merge — these tables are never edited in place. Corrections are NEW
rows with `replaces_id` pointing at the prior row (`docs/PATTERNS.md §3`),
which is itself just another insert.

**Why.** Regulated records cannot be "merged" without violating the
audit contract — the original incorrect reading must remain in the log,
with the correction as a separate row. Last-writer-wins is forbidden:
it would silently overwrite a value the operator must keep.

**Replay example.**

1. Peer A writes `cooling_log#42` (start_reading_f=140) at t1, op_id `α`.
2. Peer B writes `cooling_log#43` (different cooling event) at t2, op_id `β`.
3. A pulls B's feed → applies β. B pulls A's feed → applies α. Both
   peers now have rows 42 and 43.
4. Peer A re-pulls B's feed (e.g. after a network blip). B's feed still
   contains β; A's INSERT hits the unique-on-op_id index, no-ops, moves
   the checkpoint.

`replaces_id` linkage: when the source-host wrote the correction it used
the local row id of the prior row. On the receiving host that local row
id may differ. The applier MUST translate `replaces_id` via `op_id` of
the prior op (or via a shadow `op_id`-by-replaces_id index). Concrete
mapping is implementer's choice — recommendation: feed payload carries
the *prior op_id* alongside `replaces_id`, and the applier resolves
`prior_op_id` → local row id at apply time.

### Family 2 — Financial DELETE+INSERT-per-ingest

Tables: `vendor_prices`, `recipe_costs`, `bom_lines`, `order_guide_items`,
`settlement_summaries`, `spend_monthly`.

**Local pattern.** Every costing/financial ingest run does a wholesale
DELETE+INSERT inside a single transaction, keyed on `ingest_run_id`
(`docs/PATTERNS.md §2` and `scripts/ingest-costing.mjs` — the
`vendor_prices_history` snapshot preserves audit before each sweep).

**Sync rule.** Last-writer-wins **at the ingest-run granularity, never
at the row granularity.** A whole ingest run is one envelope keyed on
`ingest_run_id`, emitted as a single `delete-batch` op with `row_pk =
ingest_run_id` and `row_json` containing the post-INSERT payload (rows
array under key `rows`, plus a `where` clause describing the DELETE
scope, e.g. `{location_id, table_name}`).

The applier:

1. Begins a transaction.
2. DELETEs all rows in the named table matching the envelope's `where`.
3. INSERTs the payload's `rows`.
4. Commits.

If two ingest runs from different hosts target the same table, the one
applied later wins entirely. This matches the local semantics:
ingest is *idempotent and rebuild-the-whole-table*, so the only thing
that makes sense across hosts is "the most recent rebuild wins."

**Why.** Financial tables are caches of upstream truth (vendor CSVs,
costing math). They are not authored on the hub at all — they are
re-derived. Per-row merge would let stale half-rebuilds sneak in.

**Replay example.**

1. Peer A runs `npm run ingest:costing` at t1; emits envelope α
   targeting `vendor_prices` with all current rows.
2. Peer B runs `npm run ingest:costing` at t2 (>t1) with newer source
   data; emits envelope β.
3. A pulls B's feed → applies β: DELETE-then-INSERT vendor_prices on A.
4. B pulls A's feed → applies α: would replace its newer data with
   older data. **This is the cross-host LWW edge case.**
   - Mitigation: financial ingest runs SHOULD only happen on the hub
     (election'd via `lib/hubElection.ts`). A non-hub peer that is
     receiving sync should not be running its own costing ingest.
   - If a tablet *did* run ingest concurrently, the operator gets the
     last-applied result, with the prior envelope preserved in the
     `vendor_prices_history` snapshot at *both* hosts. This is
     acceptable degradation, not silent corruption.

### Family 3 — Last-writer-wins live state

Tables: `recipes`, `dish_components`, `entities_*`, recipe-edit
landscape, etc.

**Rule.** Per-row LWW by `created_at` of the op (which equals the source
host's local clock at append time). On tie, source_host lex order
breaks ties (deterministic, doesn't matter who wins as long as both
peers agree).

**Why.** These are author-edit surfaces. The operator on Peer A and the
operator on Peer B editing the same recipe simultaneously is rare, and
when it happens the human-acceptable behaviour is "whoever hit save
last." This is not a regulated table; the file-audit log
(`data/audit/management-actions.jsonl`, `lib/auditLog.mjs`) preserves
both edits for forensic recovery.

**Deferred.** v2 may upgrade this family to operational-transform / CRDT
merge for collaborative editing. Not needed for v1: typical Lariat
workflow has one KM editing recipes on the hub, with tablets read-only
on those screens.

## Replay protocol

### Local-side flow

1. **Append.** Each source-table mutation writes to `sync_feed` inside
   the same `db.transaction(...)` as the source INSERT/UPDATE/DELETE.
   Failure to append rolls back the source mutation. Same idiom as
   `postAuditEvent` (`docs/PATTERNS.md §3`); a future
   `lib/auditEvents.ts`-style helper will gate this.
2. **Subscribe.** Periodically (or on-demand) each peer pulls
   `sync_feed` rows from every other peer, starting at its local
   `replay_checkpoints.last_op_rowid` for that peer.
3. **Apply.** For each pulled op, the applier dispatches by `table_name`
   to a per-table writer. The writer enforces the family's conflict
   policy (insert-or-skip on op_id for Family 1; transactional
   DELETE+INSERT for Family 2; LWW row write for Family 3).
4. **Checkpoint.** After applying a contiguous prefix, the receiver
   updates `replay_checkpoints.last_op_rowid` for that peer.

### Cross-peer endpoint (named here, implemented in a future PR)

```
GET /api/peers/sync-since?peer_id=<caller>&from_op=<rowid>&limit=<n>
  → 200 { ops: SyncOp[], next_op: number | null }
```

The caller supplies its `peer_id` (the canonical `(host, started_at)`
key, see `lib/hubFailover.ts::peerKey()`) and the highest rowid it has
applied from this server's feed. The server returns the next window of
ops, ordered by rowid, and `next_op` is the next rowid to fetch (or
`null` when caught up).

Wire format (JSON over HTTP, fields 1:1 with `SyncOp` in
`lib/syncFeed.ts`):

```json
{
  "ops": [
    {
      "opId": "01927d8e-...",
      "tableName": "cooling_log",
      "locationId": "default",
      "opKind": "insert",
      "rowPk": "42",
      "rowJson": "{\"id\":42,\"item\":\"chili\",...}",
      "createdAt": "2026-05-06T14:31:02.111Z",
      "sourceHost": "lariat-hub.local",
      "sourceStartedAt": "2026-05-06T08:00:00.000Z"
    }
  ],
  "next_op": 1234
}
```

The full HTTP contract (auth, error envelopes, pagination caps) is the
implementing PR's responsibility — Item 13 (peer auth, Ed25519 + TXT
fingerprint) will gate the endpoint, and the implementer will choose a
sensible window size (suggested: 500 ops or 1 MB, whichever first).

### Idempotency

`op_id` is unique on every receiver. Re-fetching a window is safe:
duplicates collide on the unique index and become no-ops. This is the
single most important property — every other guarantee (gap-tolerant
checkpoints, mid-replay disconnect recovery, etc.) flows from it.

## Failure modes

- **Peer disconnects mid-replay.** The receiver has only checkpointed
  the contiguous prefix it fully applied. On reconnect it resumes from
  the same rowid; ops applied but not yet checkpointed are re-applied
  and no-op on `op_id` UNIQUE.
- **Checkpoint regression.** If a receiver's `replay_checkpoints` row
  is wiped or rolled back (e.g. the receiver restored from a backup
  older than its current checkpoint state), it will re-fetch ops it
  already has. They no-op on `op_id` UNIQUE. Worst case: one bulk
  re-replay, no data loss.
- **Clock skew between hosts.** `source_started_at` is monotonic
  per-boot per-host but not comparable across hosts. The replay
  protocol does not depend on cross-host ordering — every source is
  replayed from its own checkpoint, in source-rowid order. Family-3
  LWW tiebreaks use source_host lex order on `created_at` collision,
  not absolute time comparison.
- **Duplicate `op_id` from a UUID generator collision.** UUIDv7 carries
  48 bits of millisecond timestamp and 74 bits of randomness; a
  collision is effectively impossible (≪ birthday bound at any realistic
  rate). If it ever happened, the unique index would reject the second
  op and we'd lose that op's effect on the receiver. Documented
  assumption: producers MUST use a UUIDv7 generator with a healthy
  RNG; we do not retry on collision.
- **A correction (`replaces_id`) arriving before the prior row.** Out
  of order is possible — Peer A writes row R, then writes correction
  R' replacing R; both go to the feed in order, but Peer B may pull
  R' before R if pull windows misalign. Mitigation: the applier defers
  rows whose `replaces_id`'s op_id is unknown locally, until the prior
  op shows up. Bounded queue with TTL; if the prior op never arrives
  (e.g. it's lost), the correction is logged and dropped — operator
  alert. (Edge case; unlikely in practice because rowid order is
  preserved.)
- **Schema drift between peers.** Two peers running different Lariat
  versions may have different table shapes. The applier MUST validate
  `row_json` against the local table shape before writing; on
  validation failure the op is logged and skipped, not retried. Bumping
  Lariat versions on all peers in lockstep is the operator's job.

## What's deferred to v2

- **Backfill of historical rows.** v1 only syncs ops appended *after*
  the `sync_feed` migration runs on a peer. Existing historical rows
  on a peer are not retroactively published. Operators bring up new
  peers via a backup-restore (`npm run backup`) of a known-good DB,
  then sync forward from there. v2 may add a one-shot snapshot+resume
  protocol.
- **HACCP cross-tenant sync.** Out of scope. One venue, one tenant.
  Multi-tenant sync would need different identity, different auth,
  and a different conflict policy for shared reference tables.
- **CRDT for live-ops drift.** Family 3 (LWW live state) is sufficient
  today. v2 may upgrade `recipes` / `dish_components` to a true OT or
  CRDT model if collaborative editing becomes a real workflow.
- **Compression / batch envelopes on the wire.** v1 sends one
  `SyncOp` per JSON object. If the wire size becomes a problem (it
  will not at the data rates Lariat sees), v2 can batch and gzip.

## References

- `docs/multi-instance.md` — LAN multi-instance roadmap (this is the
  "Cross-host sync of `data/lariat.db`" item from §"What is deliberately
  NOT built").
- [`lib/hubFailover.ts`](../lib/hubFailover.ts) — `(host, started_at)`
  identity convention, `peerKey()`.
- [`lib/hubElection.ts`](../lib/hubElection.ts) — hub election; only
  the hub should run financial ingest.
- [`lib/mdnsDiscovery.ts`](../lib/mdnsDiscovery.ts) — peer discovery
  and TXT record shape.
- `docs/PATTERNS.md §1` — HACCP rule-module shape.
- `docs/PATTERNS.md §2` — ETL pattern; financial DELETE+INSERT-per-ingest.
- `docs/PATTERNS.md §3` — audit two-track (`audit_events` is in-tx with
  source row); the `appendOp` call site mirrors `postAuditEvent`.
- [`lib/syncFeed.ts`](../lib/syncFeed.ts) — typed skeleton (this PR).
- [`tests/js/test-sync-feed-types.mjs`](../tests/js/test-sync-feed-types.mjs)
  — type-import smoke test (this PR).
