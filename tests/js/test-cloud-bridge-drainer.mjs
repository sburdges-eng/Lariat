#!/usr/bin/env node
// Tests for the cloud-bridge drainer (Item 8).
//
// Spec context:
//   - docs/cloud-bridge-backend-decision.md §5.4 — response→action map.
//   - lib/cloudBridgeQueue.ts — sweepStaleClaims, claim, ack, nack,
//     DEFAULT_MAX_ATTEMPTS=5.
//
// Six contracts the drainer ties together:
//   1. Each tick: sweepStaleClaims → claim(1) → pushBatch → ack/nack.
//   2. Empty queue: tick is a no-op (no errors, returns claimed=0).
//   3. Happy push (ok:true): ack — outbox row deleted.
//   4. Permanent reject (4xx-style): ack — outbox row deleted (NOT
//      retried; that would burn DEFAULT_MAX_ATTEMPTS on bad data).
//   5. Transient failure (5xx/network/timeout): nack — attempts++,
//      row returns to queued state. After DEFAULT_MAX_ATTEMPTS (5)
//      consecutive transient failures, queue dead-letters.
//   6. createDrainer is idempotent under start()/start() and stops
//      cleanly under stop() (no ticks fire after stop).
//
// Run:
//   node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cbd-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const queue = await import('../../lib/cloudBridgeQueue.ts');
const drainer = await import('../../lib/cloudBridgeDrainer.ts');
const { createDrainer } = drainer;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM cloud_bridge_outbox');
});

/** Build a tick-callable drainer with an injected stub pushBatch. */
function makeDrainer(stubPushBatch, opts = {}) {
  return createDrainer({
    url: 'http://stub',
    secret: 'stub-secret',
    pushBatch: stubPushBatch,
    ...opts,
  });
}

describe('drainer.tick — empty queue', () => {
  it('is a no-op (claimed=0)', async () => {
    let called = 0;
    const d = makeDrainer(async () => { called++; return { ok: true }; });
    const result = await d.tick();
    assert.equal(result.claimed, 0);
    assert.equal(called, 0, 'pushBatch should not be called when queue is empty');
  });
});

describe('drainer.tick — happy path (ok:true → ack)', () => {
  it('ack-drops the batch from the outbox', async () => {
    queue.enqueue('beo_events', [{ totals_cents: 100 }], { locationId: 'default' });
    assert.equal(queue.depth(), 1);

    let receivedBatch;
    const d = makeDrainer(async (batch) => {
      receivedBatch = batch;
      return { ok: true };
    });
    const result = await d.tick();

    assert.equal(result.claimed, 1);
    assert.equal(result.outcome, 'ack');
    assert.equal(queue.depth(), 0, 'row should be removed from queue');
    assert.equal(receivedBatch.table, 'beo_events');
    assert.equal(receivedBatch.locationId, 'default');
  });
});

describe('drainer.tick — permanent reject (4xx → ack)', () => {
  it('ack-drops on permanent:true even though push failed', async () => {
    queue.enqueue('beo_events', [{ event_id: 'X' }], { locationId: 'default' });
    const d = makeDrainer(async () => ({
      ok: false, permanent: true, status: 422, reason: 'allow-list',
    }));

    const result = await d.tick();
    assert.equal(result.outcome, 'ack');
    assert.equal(queue.depth(), 0, 'permanent reject should drop, not retry');
    assert.equal(queue.deadLetterDepth(), 0, 'permanent reject should NOT dead-letter');
  });
});

describe('drainer.tick — transient failure (5xx → nack-retry)', () => {
  it('nack-retries on permanent:false (queue depth recovers, attempts increments)', async () => {
    queue.enqueue('beo_events', [{ totals_cents: 50 }], { locationId: 'default' });
    const d = makeDrainer(async () => ({
      ok: false, permanent: false, status: 503, reason: 'upstream-down',
    }));

    const result = await d.tick();
    assert.equal(result.outcome, 'nack-retry');
    assert.equal(queue.depth(), 1, 'transient failure should put row back in queue');
    assert.equal(queue.deadLetterDepth(), 0);

    const row = testDb
      .prepare('SELECT attempts, last_error FROM cloud_bridge_outbox')
      .get();
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /upstream-down/);
  });

  it('dead-letters after DEFAULT_MAX_ATTEMPTS (5) consecutive transient failures', async () => {
    queue.enqueue('beo_events', [{ totals_cents: 25 }], { locationId: 'default' });
    const d = makeDrainer(async () => ({
      ok: false, permanent: false, reason: 'still down',
    }));

    let last;
    for (let i = 0; i < queue.DEFAULT_MAX_ATTEMPTS; i++) {
      last = await d.tick();
    }

    assert.equal(last.outcome, 'nack-dead-letter');
    assert.equal(queue.depth(), 0, 'dead-lettered rows are not in queue');
    assert.equal(queue.deadLetterDepth(), 1);
  });
});

describe('drainer.tick — sweepStaleClaims runs each tick', () => {
  it('recovers orphaned in-flight claims older than the threshold', async () => {
    // Force-insert a row that's been "claimed" 10 minutes ago — simulates
    // a process death between claim() and ack/nack.
    testDb
      .prepare(
        `INSERT INTO cloud_bridge_outbox
           (table_name, location_id, rows_json, attempts, claimed_at)
         VALUES (?, ?, ?, 1, datetime('now', '-600 seconds'))`,
      )
      .run('beo_events', 'default', JSON.stringify([{ x: 1 }]));

    assert.equal(queue.depth(), 0, 'stale-claimed rows are invisible to claim()');

    let pushedAfterSweep = false;
    const d = makeDrainer(async () => {
      pushedAfterSweep = true;
      return { ok: true };
    }, { staleClaimAgeSec: 300 });

    const result = await d.tick();
    assert.ok(result.swept >= 1, `sweep should recover the stale row, got swept=${result.swept}`);
    assert.equal(result.outcome, 'ack', 'claimed row after sweep should push + ack');
    assert.ok(pushedAfterSweep);
    assert.equal(queue.depth(), 0);
  });
});

describe('drainer — start/stop lifecycle', () => {
  it('start() is idempotent — calling twice does not double-fire ticks', async () => {
    let pushCount = 0;
    const d = makeDrainer(async () => { pushCount++; return { ok: true }; }, {
      tickMs: 30,
    });

    queue.enqueue('beo_events', [{ a: 1 }], { locationId: 'default' });

    d.start();
    d.start();
    d.start();
    await new Promise((r) => setTimeout(r, 80));
    d.stop();

    // With one row in the queue and 80ms of ticking at 30ms/tick, we
    // expect 1 push (the only enqueue) — definitely not 3× the work
    // from 3 start() calls.
    assert.equal(pushCount, 1, `pushCount=${pushCount}, expected 1`);
  });

  it('stop() halts further ticks', async () => {
    let pushCount = 0;
    const d = makeDrainer(async () => { pushCount++; return { ok: true }; }, {
      tickMs: 20,
    });

    d.start();
    d.stop();

    queue.enqueue('beo_events', [{ a: 1 }], { locationId: 'default' });
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(pushCount, 0, 'no ticks should fire after stop()');
    assert.equal(queue.depth(), 1, 'enqueued row stays untouched');
  });
});

describe('drainer.tick — pushBatch throws unexpectedly', () => {
  it('treats unexpected throws as transient (nack-retry, no crash)', async () => {
    queue.enqueue('beo_events', [{ a: 1 }], { locationId: 'default' });

    const d = makeDrainer(async () => {
      throw new Error('boom');
    });

    const result = await d.tick();
    assert.equal(result.outcome, 'nack-retry');
    assert.equal(queue.depth(), 1);
    assert.match(result.error ?? '', /boom/);
  });
});
