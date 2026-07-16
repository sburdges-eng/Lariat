# Cloud-Bridge Replay Determinism Design

## Goal

Roadmap 1.13 needs an end-to-end replay check for the cloud-bridge push lane without introducing a cloud service or changing the local SQLite schema. The feature adds a deterministic local replay harness for `cloud_bridge_outbox` batches: capture allow-listed outbox writes, replay them into a fresh in-memory cloud-side projection, replay the same capture again, and assert the final state is identical. This proves the bridge's safe-replay contract from `docs/cloud-bridge-backend-decision.md` §5.5 for the venue-side payload shape.

## Non-goals

- Do not stand up a Cloudflare Worker, D1 database, remote API, or network-backed test.
- Do not implement `pullSnapshot` or change `/api/cloud-bridge/status`.
- Do not add or alter database tables, migrations, columns, indexes, or runtime services.
- Do not widen `ALLOWED_TABLES` or relax the cloud-bridge deny-by-default policy.
- Do not reuse `sync_feed` / `applyWindow` as the proof surface; that validates multi-instance LAN sync, not the cloud-bridge push contract.

## User-facing surface

There is no UI or operator workflow change. The new surface is a test-only deterministic helper used by:

```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-replay-determinism.mjs
```

The helper accepts captured `OutboxBatch[]` objects with the same shape returned by `lib/cloudBridgeQueue.ts::claim()`:

```ts
const result = replayCloudBridgeBatches([
  {
    id: 1,
    table: 'spend_monthly',
    locationId: 'default',
    rows: [{ month: '2026-05', shamrock_total_spend: 1250.75, source: 'analytics_workbook', location_id: 'default' }],
    attempts: 1,
    enqueuedAt: '2026-06-01T00:00:00Z',
  },
]);
```

It returns a canonical projection of accepted batches and rows:

```ts
{
  accepted: 1,
  deduped: 0,
  rejected: 0,
  state: {
    batches: [
      { location_id: 'default', batch_id: 1, table: 'spend_monthly', n_rows: 1 }
    ],
    tables: {
      spend_monthly: {
        default: [
          { month: '2026-05', shamrock_total_spend: 1250.75, source: 'analytics_workbook', location_id: 'default' }
        ]
      }
    }
  }
}
```

## Data model deltas

None. The replay harness uses plain in-memory `Map` instances. The production `cloud_bridge_outbox` schema remains unchanged.

The canonical replay key is the backend decision's dedup key:

```text
location_id + "\u0000" + batch_id
```

Rows are deep-cloned through JSON serialization so the helper cannot mutate captured payloads. Canonical output sorts batches by `(location_id, batch_id)` and table projections by table name, location id, and stable JSON row value.

## Invariants

- **Safe replay:** applying the same captured batches twice yields the same canonical state and increments `deduped`, not row count.
- **Location isolation:** the same numeric `batch_id` from two locations is accepted as two independent batches.
- **Allow-list enforcement:** a denied table is rejected and never appears in canonical state, matching defense-in-depth in the cloud-side contract.
- **Empty rows fail closed:** an empty `rows` array is rejected and not recorded.
- **Canonical ordering:** replay output is deterministic regardless of capture order.
- **No runtime coupling:** the helper does not call `fetch`, use a cloud SDK, read env vars, or depend on wall-clock time.
- **No schema drift:** no database schema, JSON schema, or wire header changes are introduced.

## Test design

The focused test creates a temporary Lariat SQLite DB, enqueues realistic allow-listed batches through `enqueue()`, claims them through the existing queue API, and feeds the captured `OutboxBatch[]` into the helper. It then replays the same capture into a fresh helper state and asserts:

1. first pass accepts each allowed batch;
2. second pass dedups each batch;
3. final canonical state matches the first pass exactly;
4. location-scoped duplicate `batch_id` values do not collide;
5. denied and empty batches fail closed without state mutation.

The acceptance command is:

```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-replay-determinism.mjs
```

Project gates before PR:

```bash
bash scripts/ci/no-absolute-paths.sh
bash scripts/ci/no-cache-artifacts.sh
npm run typecheck
npm run test:cloud-bridge-replay-determinism
```

## Open questions

None for this scope. The helper models the already-decided local proof of the backend contract. Real Worker/D1 behavior, server-side retention, and remote observability remain outside 1.13.

## Governance impact

- **Affected subsystem:** cloud-bridge push replay tests.
- **Freeze-readiness impact:** positive; roadmap 1.13 gets a deterministic proof without changing frozen runtime surfaces.
- **Determinism impact:** positive; replay output is canonicalized and does not depend on network, time, random IDs, or external services.
- **Security impact:** neutral to positive; allow-list and location-scoped dedup checks are pinned in test coverage.

## 2026-07-16: envelope moved to `/v2` canonical

The push envelope moved to `/v2/snapshot` with CanonicalJSON + per-table `schema_version`; replay
determinism is unaffected (the outbox row shape is unchanged), and the byte contract is now pinned
by the golden-envelope fixtures. See
`docs/superpowers/plans/2026-07-16-cloud-bridge-v2-canonical-envelope.md`.
