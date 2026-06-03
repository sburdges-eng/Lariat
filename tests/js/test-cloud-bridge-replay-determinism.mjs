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
  testDb.exec('DELETE FROM cloud_bridge_outbox;');
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
