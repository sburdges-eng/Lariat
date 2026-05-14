#!/usr/bin/env node
// Tests for the cloud-bridge drainer's gracefulStop path + queue's
// releaseAllClaimedRows helper (T8).
//
// Verifies:
//   - releaseAllClaimedRows: clears claimed_at on all in-flight rows,
//     skips dead-letter tombstones, idempotent.
//   - gracefulStop:
//       - stops the interval (isRunning false after),
//       - awaits an in-flight tick before releasing claims,
//       - bounded by timeoutMs (hung push doesn't pin shutdown forever),
//       - releases any rows the in-flight tick left claimed,
//       - idempotent — second call returns 0 and doesn't throw.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-cloud-bridge-graceful-stop.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cbgs-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const queue = await import('../../lib/cloudBridgeQueue.ts');
const { createDrainer } = await import('../../lib/cloudBridgeDrainer.ts');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM cloud_bridge_outbox');
});

function enqueue(table = 'beo_events') {
  // enqueue(table, rows, { locationId }) — table must be on ALLOWED_TABLES.
  return queue.enqueue(table, [{ id: Math.random() }], {
    locationId: 'default',
  });
}

// ─────────────────────────────────────────────────────────────────
// releaseAllClaimedRows
// ─────────────────────────────────────────────────────────────────

describe('releaseAllClaimedRows', () => {
  it('returns 0 when nothing is claimed', () => {
    assert.equal(queue.releaseAllClaimedRows(), 0);
  });

  it('clears claimed_at on all queued-but-claimed rows', () => {
    enqueue();
    enqueue();
    enqueue();
    const claimed = queue.claim(10);
    assert.equal(claimed.length, 3);
    const released = queue.releaseAllClaimedRows();
    assert.equal(released, 3);
    // All three are queued again.
    assert.equal(queue.depth(), 3);
  });

  it('does NOT release dead-letter tombstones', () => {
    enqueue();
    const [b] = queue.claim(1);
    // Nack 5 times to push it to dead-letter (DEFAULT_MAX_ATTEMPTS=5).
    queue.nack(b.id, 'first');
    for (let i = 0; i < 5; i++) {
      const [claim] = queue.claim(1);
      if (!claim) break;
      queue.nack(claim.id, `retry ${i}`);
    }
    // Now it's dead-lettered (claimed_at set as a tombstone, dead_letter=1).
    assert.ok(queue.deadLetterDepth() >= 1, 'row must be dead-lettered');
    // releaseAllClaimedRows must skip it.
    const released = queue.releaseAllClaimedRows();
    assert.equal(released, 0);
    assert.equal(queue.deadLetterDepth(), 1, 'dead-letter count unchanged');
  });

  it('is idempotent — second call after release returns 0', () => {
    enqueue();
    queue.claim(1);
    assert.equal(queue.releaseAllClaimedRows(), 1);
    assert.equal(queue.releaseAllClaimedRows(), 0);
  });

  it('audit H6: does NOT release rows claimed by a different process owner', () => {
    enqueue();
    // Manually mimic "another process claimed this row": set
    // claimed_at + a DIFFERENT claim_owner UUID. releaseAllClaimedRows
    // from THIS process must leave the row alone.
    const otherOwner = 'other-process-uuid';
    testDb.prepare(
      `UPDATE cloud_bridge_outbox
          SET claimed_at = datetime('now'),
              claim_owner = ?`,
    ).run(otherOwner);
    const released = queue.releaseAllClaimedRows();
    assert.equal(released, 0, 'must not release other-process claims');
    // Sanity: the row is still claimed by the other owner.
    const row = testDb.prepare(`SELECT claimed_at, claim_owner FROM cloud_bridge_outbox`).get();
    assert.ok(row.claimed_at, 'claimed_at preserved');
    assert.equal(row.claim_owner, otherOwner, 'other-owner preserved');
  });

  it('audit H6: claim() stamps the current process OWNER on claimed rows', () => {
    enqueue();
    const [batch] = queue.claim(1);
    assert.ok(batch);
    const row = testDb.prepare(
      `SELECT claim_owner FROM cloud_bridge_outbox WHERE id = ?`,
    ).get(batch.id);
    assert.equal(row.claim_owner, queue.OWNER, 'claim stamps OWNER');
  });

  it('audit L4: gracefulStopVerbose returns released count + awaitedMs', async () => {
    const h = createDrainer({ tickMs: 1_000_000 });
    h.start();
    enqueue();
    queue.claim(1); // leave claimed so release happens
    const result = await h.gracefulStopVerbose(100);
    assert.equal(result.released, 1);
    assert.equal(typeof result.awaitedMs, 'number');
    assert.ok(result.awaitedMs >= 0);
  });

  it('audit L4: gracefulStop (legacy shape) still returns just the released count', async () => {
    const h = createDrainer({ tickMs: 1_000_000 });
    h.start();
    enqueue();
    queue.claim(1);
    const result = await h.gracefulStop(100);
    assert.equal(typeof result, 'number');
    assert.equal(result, 1);
  });

  it('audit H6: releases legacy rows with NULL claim_owner (pre-migration)', () => {
    enqueue();
    // Simulate a pre-H6 row: claimed_at set, claim_owner NULL.
    testDb.prepare(
      `UPDATE cloud_bridge_outbox
          SET claimed_at = datetime('now'),
              claim_owner = NULL`,
    ).run();
    const released = queue.releaseAllClaimedRows();
    assert.equal(released, 1, 'NULL-owner legacy rows are released (no stranding)');
  });
});

// ─────────────────────────────────────────────────────────────────
// drainer.gracefulStop
// ─────────────────────────────────────────────────────────────────

describe('drainer.gracefulStop', () => {
  it('stops the interval (isRunning false after)', async () => {
    const h = createDrainer({ tickMs: 1_000_000 }); // huge tickMs so no auto-tick
    h.start();
    assert.equal(h.isRunning(), true);
    await h.gracefulStop(100);
    assert.equal(h.isRunning(), false);
  });

  it('returns 0 when no rows are claimed', async () => {
    const h = createDrainer({ tickMs: 1_000_000 });
    h.start();
    const released = await h.gracefulStop(100);
    assert.equal(released, 0);
  });

  it('releases rows left claimed by an aborted/in-flight tick', async () => {
    // Simulate an in-flight tick by manually claiming a row, then
    // gracefulStop to release it. This is the post-crash recovery shape:
    // a previous process died holding a claim, this process restarts and
    // its gracefulStop should release all stale-but-live claims even
    // before the staleClaimAgeSec window expires.
    enqueue();
    queue.claim(1); // simulate "in-flight" state
    const h = createDrainer({ tickMs: 1_000_000 });
    const released = await h.gracefulStop(100);
    assert.equal(released, 1);
    assert.equal(queue.depth(), 1, 'row is queued again');
  });

  it('idempotent: second gracefulStop returns 0', async () => {
    const h = createDrainer({ tickMs: 1_000_000 });
    h.start();
    enqueue();
    queue.claim(1);
    const first = await h.gracefulStop(100);
    assert.equal(first, 1);
    const second = await h.gracefulStop(100);
    assert.equal(second, 0);
  });

  it("respects timeoutMs so a hung push doesn't pin shutdown forever", async () => {
    // pushBatch that never resolves — simulates a hung remote.
    const hung = () => new Promise(() => {});
    const h = createDrainer({
      tickMs: 1_000_000,
      url: 'http://example.invalid',
      secret: 's',
      pushBatch: hung,
    });
    enqueue();
    const tickPromise = h.tick(); // start a tick that will never resolve
    void tickPromise;
    const start = Date.now();
    const released = await h.gracefulStop(150); // tight budget
    const elapsed = Date.now() - start;
    // Allow generous wall-clock slack — the test only needs to confirm
    // gracefulStop returned within reasonable bounds of the budget, not
    // burning the test runner's default 30s.
    assert.ok(elapsed < 1000, `gracefulStop must return promptly; took ${elapsed}ms`);
    // The hung tick left the row claimed; gracefulStop released it.
    assert.equal(released, 1);
  });
});
