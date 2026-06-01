# Cloud-Bridge Replay Determinism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic local replay proof for cloud-bridge outbox batches so roadmap 1.13 is covered without schema or runtime service changes.

**Architecture:** Keep production cloud-bridge queue and drainer behavior unchanged. Add one small pure helper, `lib/cloudBridgeReplay.ts`, that models the cloud peer's `(location_id, batch_id)` dedup contract in memory and produces canonical state for tests. Add one focused node test that captures batches through `cloudBridgeQueue.enqueue()` / `claim()` and replays them twice.

**Tech Stack:** Node test runner, TypeScript stripped by Node, `better-sqlite3` test DB through existing `lib/db.ts`, existing `lib/cloudBridgeQueue.ts` queue API.

---

## File Structure

- Create `lib/cloudBridgeReplay.ts`: pure in-memory replay helper. It must not import `db.ts`, call `fetch`, read env vars, generate IDs, or use time.
- Create `tests/js/test-cloud-bridge-replay-determinism.mjs`: focused replay test using a temp SQLite DB and existing cloud-bridge queue API.
- Modify `package.json`: add `test:cloud-bridge-replay-determinism` script.
- Modify `docs/PROJECT_ROADMAP.md`: mark 1.13 closed after tests pass.
- Modify `docs/V2_FREEZE_PLAN.md`: add replay determinism evidence to the cloud-bridge push row.

## Task T1: Pure Replay Helper And Failing Test

**Files:**
- Create: `lib/cloudBridgeReplay.ts`
- Create: `tests/js/test-cloud-bridge-replay-determinism.mjs`
- MUST NOT modify: `lib/cloudBridgeQueue.ts`, `lib/cloudBridgeDrainer.ts`, `lib/cloudBridgePush.ts`, `lib/db.ts`, any API route.

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-cloud-bridge-replay-determinism.mjs` with:

```js
#!/usr/bin/env node
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cbr-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();
const queue = await import('../../lib/cloudBridgeQueue.ts');
const replay = await import('../../lib/cloudBridgeReplay.ts');
const {
  createCloudBridgeReplayState,
  replayCloudBridgeBatches,
  canonicalCloudBridgeReplayState,
} = replay;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  testDb.exec('DELETE FROM cloud_bridge_outbox; DELETE FROM sqlite_sequence WHERE name = "cloud_bridge_outbox";');
});

function captureAllowedBatches() {
  queue.enqueue('spend_monthly', [
    { month: '2026-04', shamrock_total_spend: 4180.12, source: 'analytics_workbook', location_id: 'default' },
    { month: '2026-05', shamrock_total_spend: 5120.25, source: 'analytics_workbook', location_id: 'default' },
  ], { locationId: 'default' });
  queue.enqueue('beo_events', [
    { id: 42, title: 'Spring wine dinner', event_date: '2026-06-18', guest_count: 36, status: 'confirmed', location_id: 'default' },
  ], { locationId: 'default' });
  queue.enqueue('spend_monthly', [
    { month: '2026-05', shamrock_total_spend: 2110.5, source: 'analytics_workbook', location_id: 'lariat-west' },
  ], { locationId: 'lariat-west' });

  return queue.claim(10);
}

describe('cloud-bridge replay determinism', () => {
  it('replaying captured outbox batches twice yields identical canonical state', () => {
    const captured = captureAllowedBatches();
    assert.equal(captured.length, 3, 'precondition: three outbox batches captured');

    const state = createCloudBridgeReplayState();
    const first = replayCloudBridgeBatches(captured, state);
    const afterFirst = canonicalCloudBridgeReplayState(state);
    const second = replayCloudBridgeBatches(captured, state);
    const afterSecond = canonicalCloudBridgeReplayState(state);

    assert.equal(first.accepted, 3);
    assert.equal(first.deduped, 0);
    assert.equal(first.rejected, 0);
    assert.equal(second.accepted, 0);
    assert.equal(second.deduped, 3);
    assert.equal(second.rejected, 0);
    assert.deepStrictEqual(afterSecond, afterFirst);
    assert.deepStrictEqual(afterSecond.tables.spend_monthly.default.map((r) => r.month), ['2026-04', '2026-05']);
    assert.deepStrictEqual(afterSecond.tables.spend_monthly['lariat-west'].map((r) => r.month), ['2026-05']);
    assert.equal(afterSecond.batches.length, 3);
  });

  it('dedup is scoped by location_id plus batch_id, not batch_id alone', () => {
    const state = createCloudBridgeReplayState();
    const batchDefault = {
      id: 7,
      table: 'spend_monthly',
      locationId: 'default',
      rows: [{ month: '2026-05', shamrock_total_spend: 100, source: 'analytics_workbook', location_id: 'default' }],
      attempts: 1,
      enqueuedAt: '2026-06-01T00:00:00Z',
    };
    const batchWest = {
      ...batchDefault,
      locationId: 'lariat-west',
      rows: [{ month: '2026-05', shamrock_total_spend: 200, source: 'analytics_workbook', location_id: 'lariat-west' }],
    };

    const result = replayCloudBridgeBatches([batchDefault, batchWest], state);
    const canonical = canonicalCloudBridgeReplayState(state);

    assert.equal(result.accepted, 2);
    assert.equal(result.deduped, 0);
    assert.equal(canonical.batches.length, 2);
    assert.equal(canonical.tables.spend_monthly.default[0].shamrock_total_spend, 100);
    assert.equal(canonical.tables.spend_monthly['lariat-west'][0].shamrock_total_spend, 200);
  });

  it('denied tables and empty rows fail closed without state mutation', () => {
    const state = createCloudBridgeReplayState();
    const result = replayCloudBridgeBatches([
      { id: 1, table: 'sales_lines', locationId: 'default', rows: [{ check_guid: 'pii' }], attempts: 1, enqueuedAt: '2026-06-01T00:00:00Z' },
      { id: 2, table: 'spend_monthly', locationId: 'default', rows: [], attempts: 1, enqueuedAt: '2026-06-01T00:00:00Z' },
    ], state);

    assert.equal(result.accepted, 0);
    assert.equal(result.deduped, 0);
    assert.equal(result.rejected, 2);
    assert.deepStrictEqual(canonicalCloudBridgeReplayState(state), { batches: [], tables: {} });
  });

  it('canonical output is stable when capture order changes', () => {
    const captured = captureAllowedBatches();
    const forward = createCloudBridgeReplayState();
    const reverse = createCloudBridgeReplayState();

    replayCloudBridgeBatches(captured, forward);
    replayCloudBridgeBatches([...captured].reverse(), reverse);

    assert.deepStrictEqual(
      canonicalCloudBridgeReplayState(reverse),
      canonicalCloudBridgeReplayState(forward),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-replay-determinism.mjs
```

Expected: FAIL because `../../lib/cloudBridgeReplay.ts` cannot be imported.

- [ ] **Step 3: Implement the minimal helper**

Create `lib/cloudBridgeReplay.ts` with exported functions:

```ts
import { ALLOWED_TABLES, type OutboxBatch } from './cloudBridgeQueue.ts';

type JsonRow = Record<string, unknown>;

export interface CloudBridgeReplayState {
  seenBatchKeys: Set<string>;
  batches: Map<string, { location_id: string; batch_id: number; table: string; n_rows: number }>;
  tables: Map<string, Map<string, JsonRow[]>>;
}

export interface ReplaySummary {
  accepted: number;
  deduped: number;
  rejected: number;
}

export interface CanonicalReplayState {
  batches: { location_id: string; batch_id: number; table: string; n_rows: number }[];
  tables: Record<string, Record<string, JsonRow[]>>;
}

export function createCloudBridgeReplayState(): CloudBridgeReplayState {
  return {
    seenBatchKeys: new Set(),
    batches: new Map(),
    tables: new Map(),
  };
}

export function replayCloudBridgeBatches(
  batches: OutboxBatch[],
  state: CloudBridgeReplayState = createCloudBridgeReplayState(),
): ReplaySummary {
  const summary = { accepted: 0, deduped: 0, rejected: 0 };
  for (const batch of batches) {
    if (!isReplayableBatch(batch)) {
      summary.rejected += 1;
      continue;
    }
    const key = batchKey(batch.locationId, batch.id);
    if (state.seenBatchKeys.has(key)) {
      summary.deduped += 1;
      continue;
    }
    state.seenBatchKeys.add(key);
    state.batches.set(key, {
      location_id: batch.locationId,
      batch_id: batch.id,
      table: batch.table,
      n_rows: batch.rows.length,
    });
    const tableMap = getOrCreate(state.tables, batch.table, () => new Map<string, JsonRow[]>());
    const rows = getOrCreate(tableMap, batch.locationId, () => []);
    for (const row of batch.rows) rows.push(deepCloneObject(row));
    summary.accepted += 1;
  }
  return summary;
}

export function canonicalCloudBridgeReplayState(
  state: CloudBridgeReplayState,
): CanonicalReplayState {
  const batches = [...state.batches.values()].sort(compareBatch);
  const tables: Record<string, Record<string, JsonRow[]>> = {};
  for (const table of [...state.tables.keys()].sort()) {
    const byLocation = state.tables.get(table)!;
    tables[table] = {};
    for (const locationId of [...byLocation.keys()].sort()) {
      tables[table][locationId] = byLocation
        .get(locationId)!
        .map(deepCloneObject)
        .sort(compareJsonRows);
    }
  }
  return { batches, tables };
}

function isReplayableBatch(batch: OutboxBatch): batch is OutboxBatch & { rows: JsonRow[] } {
  return ALLOWED_TABLES.has(batch.table)
    && Number.isInteger(batch.id)
    && batch.id > 0
    && typeof batch.locationId === 'string'
    && batch.locationId.trim().length > 0
    && Array.isArray(batch.rows)
    && batch.rows.length > 0
    && batch.rows.every(isJsonObject);
}

function batchKey(locationId: string, batchId: number): string {
  return `${locationId}\u0000${batchId}`;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

function isJsonObject(value: unknown): value is JsonRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneObject(row: JsonRow): JsonRow {
  return JSON.parse(JSON.stringify(row)) as JsonRow;
}

function compareBatch(
  a: { location_id: string; batch_id: number; table: string; n_rows: number },
  b: { location_id: string; batch_id: number; table: string; n_rows: number },
): number {
  return a.location_id.localeCompare(b.location_id)
    || a.batch_id - b.batch_id
    || a.table.localeCompare(b.table);
}

function compareJsonRows(a: JsonRow, b: JsonRow): number {
  return JSON.stringify(sortJson(a)).localeCompare(JSON.stringify(sortJson(b)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)]),
    );
  }
  return value;
}
```

- [ ] **Step 4: Run focused GREEN verification**

Run:

```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-replay-determinism.mjs
```

Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 5: Run adjacent cloud-bridge queue/drainer tests**

Run:

```bash
npm run test:cloud-bridge-push
npm run test:cloud-bridge-drainer
node --experimental-strip-types --test tests/js/test-cloud-bridge-queue.mjs
```

Expected: PASS for all three commands.

- [ ] **Step 6: Commit T1**

Run:

```bash
git add lib/cloudBridgeReplay.ts tests/js/test-cloud-bridge-replay-determinism.mjs
AGENT_NAME=codex git commit -m "T1: add cloud bridge replay determinism test"
```

## Task T2: Script And Freeze Docs

**Files:**
- Modify: `package.json`
- Modify: `docs/PROJECT_ROADMAP.md`
- Modify: `docs/V2_FREEZE_PLAN.md`
- MUST NOT modify: any runtime route, `lib/db.ts`, `lib/cloudBridgeQueue.ts`, `lib/cloudBridgeDrainer.ts`, `lib/cloudBridgePush.ts`.

- [ ] **Step 1: Add package script**

Modify `package.json` scripts to include:

```json
"test:cloud-bridge-replay-determinism": "node --experimental-strip-types --test tests/js/test-cloud-bridge-replay-determinism.mjs"
```

Place it next to the existing cloud-bridge scripts.

- [ ] **Step 2: Update roadmap row 1.13**

Change `docs/PROJECT_ROADMAP.md` row `1.13` to:

```md
| 1.13 | M | **Closed:** Cloud-bridge replay determinism is pinned by `tests/js/test-cloud-bridge-replay-determinism.mjs`, which captures outbox batches, replays them into a fresh local projection, replays the same capture again, and asserts canonical state-equivalence plus location-scoped dedup. |
```

- [ ] **Step 3: Update freeze-plan evidence**

Change the `Cloud-bridge push` row in `docs/V2_FREEZE_PLAN.md` to include the replay test:

```md
| Cloud-bridge push | **FROZEN** | `lib/cloudBridge.ts:92` `pushSnapshot()`→`pushBatch()`; DLQ admin routes complete; `test-cloud-bridge-replay-determinism.mjs` pins local replay state-equivalence | |
```

- [ ] **Step 4: Run focused script**

Run:

```bash
npm run test:cloud-bridge-replay-determinism
```

Expected: PASS, 4 tests, 0 failures.

- [ ] **Step 5: Run policy/type gates**

Run:

```bash
bash scripts/ci/no-absolute-paths.sh
bash scripts/ci/no-cache-artifacts.sh
npm run typecheck
```

Expected: all three pass.

- [ ] **Step 6: Run GitNexus change detection**

Run GitNexus detect changes for repo `Lariat`, scope `all`.

Expected: changed files are the helper, focused test, package script, and two docs rows. Risk should be low or none; if higher, stop and report before committing.

- [ ] **Step 7: Commit T2**

Run:

```bash
git add package.json docs/PROJECT_ROADMAP.md docs/V2_FREEZE_PLAN.md
AGENT_NAME=codex git commit -m "T2: document cloud bridge replay gate"
```

## Final Verification Before PR

Run:

```bash
npm run test:cloud-bridge-replay-determinism
npm run test:cloud-bridge-push
npm run test:cloud-bridge-drainer
node --experimental-strip-types --test tests/js/test-cloud-bridge-queue.mjs
bash scripts/ci/no-absolute-paths.sh
bash scripts/ci/no-cache-artifacts.sh
npm run typecheck
```

Then verify:

```bash
git -c core.fsmonitor=false status --short --branch
git -c core.fsmonitor=false log --oneline --max-count=5
```

Expected: branch `feat/cloud-bridge-replay-determinism` contains commits `T0`, `T1`, and `T2`; worktree is clean before push/PR.

## Self-Review

- Spec coverage: T1 covers replay, dedup, location isolation, allow-list rejection, empty-row rejection, canonical ordering, and no external runtime dependency. T2 covers the package script and roadmap/freeze evidence.
- Placeholder scan: no task uses deferred placeholders or vague "add tests" instructions.
- Type consistency: helper exports in T1 match the exact names imported by the test.
