# Cloud Bridge — Design Doc (Stub)

Status: **stub / scoping only**. This document describes a future capability.
The accompanying `lib/cloudBridge.ts` and `app/api/cloud-bridge/status` exist
so the next PR can fill in real behavior without redesigning the surface.

## What this is

A future capability to sync select tables from each Lariat instance to a
central cloud peer, and back, so:

- The corp office can see consolidated data across multiple venues.
- A venue can read a sibling venue's snapshot for backup / failover.

The bridge is the seam between Lariat's local-first SQLite world and a
cloud peer that has its own auth, firewall, and latency posture.

## What this is not

- **Not a sync engine.** No vector clocks, no merge logic.
- **Not a CRDT system.** No conflict-free replicated types, no per-row
  causal metadata.
- **Not a conflict-resolution layer.** If two locations write the same
  monthly aggregate, the stub does not arbitrate. Conflict policy is an
  explicit non-goal for this PR and is deferred to a future design pass.

## Why a bridge, not direct DB replication

Lariat is local-first on `better-sqlite3` with WAL. The cloud peer is a
separate failure domain. Replicating the SQLite file (or the WAL) over the
WAN directly would couple two failure domains:

- A cloud outage stalls local writes (back-pressure on the WAL ship).
- A schema migration on one side breaks the other immediately.
- Per-row replication leaks PII (sales_lines, payroll-adjacent rows) that
  has no business leaving the venue.

A bridge introduces a deliberate seam where we can:

- **Filter** — skip PII-bearing tables, skip ephemeral / cache tables.
- **Batch** — publish per-shift or per-day, not per-row. Cloud writes
  cost money and have rate limits; row-by-row replication wastes both.
- **Degrade** — queue-on-disk during a WAN outage; resume when the cloud
  peer is reachable again. Venue ops never blocks on cloud availability.
- **Translate** — emit a stable wire-format that survives schema drift
  on either side, without coupling the bridge to internal table shapes.

## Sync direction priority

Push (local → cloud) is implemented before pull (cloud → local). Push is
the higher-value direction for the corp-office consolidation use case,
and it carries less risk: a bad push pollutes a downstream view, but it
cannot corrupt an authoritative local table.

Per-table opt-in. Default is **deny**. The first three candidates:

1. `settlement_summaries` — end-of-night totals, already coarse.
2. `beo_events` — banquet / event ops, already shared with sales/corp.
3. monthly aggregates (e.g. `spend_monthly`) — month-grain, no PII.

Explicitly **never** synced:

- `sales_lines` — per-transaction, ties to staff / time / item.
- `sales_depletion_runs` — depletion ingest provenance, internal-only.
- Anything in the temp-log / sick-worker / wage-action surfaces.

This list lives here as the canonical constraint until a `docs/data-governance.md`
exists. When that doc lands, this list moves there and this section
becomes a pointer.

## Auth model

The cloud peer issues an API key per location. Exchange happens via the
existing PIN / manager surface in a future PR (the manager enters a
one-time pairing code at the iPad, the server fetches a long-lived API
key, key is stored in the local SQLite-backed config).

For the stub, the key is read from `process.env.LARIAT_CLOUD_API_KEY`.
If unset, `createCloudBridge()` still returns a usable handle, but
`pushSnapshot` / `pullSnapshot` will fail loudly when called.

## Out-of-scope acknowledgments

These are not stubbed and not planned for the immediate next PR:

- Real-time / streaming sync.
- Multi-master writes (two locations writing the same logical row).
- Schema migrations across the bridge (the wire format will be versioned
  separately from the local DB schema, but cross-version negotiation is
  future work).
- iCloud-style transparent sync. The bridge is explicit and opt-in by
  table, not a magic mirror.
- Pull-driven cache invalidation on the local side.

## Surface (current stub)

```ts
export interface CloudBridge {
  pushSnapshot(
    table: string,
    rows: unknown[],
    opts: { locationId: string },
  ): Promise<{ accepted: number; rejected: number }>;

  pullSnapshot(
    table: string,
    opts: { locationId: string; since: string },
  ): Promise<unknown[]>;

  status(): Promise<{
    lastPushAt: string | null;
    lastPullAt: string | null;
    queueDepth: number;
    lastError: string | null;
  }>;
}

export function createCloudBridge(opts?: {
  apiKey?: string;
  baseUrl?: string;
}): CloudBridge;
```

The default implementation throws a sentinel `not implemented yet` for
push/pull, and returns an empty status. This lets future API routes
wire `try/catch` around it without breaking the build.

## Next PR's job

1. Pick a backend (likely a tiny HTTPS service we own; Cloudflare Worker
   or similar — explicitly not a third-party SDK with hidden runtime
   coupling).
2. Implement `pushSnapshot` against that backend, starting with
   `settlement_summaries`.
3. Add a disk-backed queue for outage tolerance.
4. Wire the per-location API-key exchange into `/login-pin` flow.
