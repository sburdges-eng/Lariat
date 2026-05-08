#!/usr/bin/env node
// Tests for the cloud-bridge outbox (disk-backed queue).
//
// Spec context: docs/cloud-bridge-design.md "Next PR's job" item 3.
// Outage tolerance: enqueued rows survive process restart and are
// drained in FIFO order when the cloud peer is reachable.
//
// Six contracts:
//   1. Empty queue: depth() = 0; claim() returns [].
//   2. enqueue() returns a positive batch id; depth() reflects new rows.
//   3. claim(n) returns up to n batches in FIFO order, marks them in-flight.
//   4. ack() removes a batch; depth() drops; claim() doesn't re-yield it.
//   5. nack() returns a batch to the queue with attempts++; eventually
//      moves to dead-letter after maxAttempts.
//   6. Per-table allow-list: enqueueing a denied table throws and
//      writes nothing. (Mirrors design-doc §"Sync direction priority".)
//
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-queue.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cbq-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const queue = await import('../../lib/cloudBridgeQueue.ts');
const {
  enqueue,
  claim,
  ack,
  nack,
  depth,
  deadLetterDepth,
  sweepStaleClaims,
  listDeadLetters,
  getDeadLetter,
  requeueDeadLetter,
  dropDeadLetter,
  CLOUD_BRIDGE_TABLE_DENIED,
  ALLOWED_TABLES,
} = queue;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM cloud_bridge_outbox`);
});

const LOC = 'default';
const TABLE = 'settlement_summaries';

describe('depth() — empty', () => {
  it('returns 0 on a fresh queue', () => {
    assert.equal(depth(), 0);
    assert.equal(deadLetterDepth(), 0);
  });

  it('claim() returns [] on a fresh queue', () => {
    assert.deepStrictEqual(claim(10), []);
  });
});

describe('depth() — excludes in-flight rows', () => {
  // Contract: depth() reports batches "available to claim" — not total queued.
  // In-flight rows (claimed_at IS NOT NULL, dead_letter = 0) have already been
  // handed to a drainer; counting them inflates monitoring relative to what
  // claim() will yield.
  it('drops claimed rows out of depth, restores them on nack', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    enqueue(TABLE, [{ shift_date: '2026-05-02', total: 2 }], { locationId: LOC });
    enqueue(TABLE, [{ shift_date: '2026-05-03', total: 3 }], { locationId: LOC });
    assert.equal(depth(), 3, 'three queued batches');

    const [c] = claim(1);
    assert.equal(depth(), 2, 'in-flight batch is excluded from depth');

    // nack returns the batch to the queue → depth recovers.
    nack(c.id, 'transient');
    assert.equal(depth(), 3, 'nacked batch is back in depth');
  });
});

describe('enqueue() — happy path', () => {
  it('returns a positive integer batch id', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-04', total: 4321.5 }], { locationId: LOC });
    assert.ok(Number.isInteger(id) && id > 0, `expected positive int id, got ${id}`);
    assert.equal(depth(), 1);
  });

  it('counts rows, not batches, in depth() — 3 enqueues = 3 batches', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-04', total: 1 }], { locationId: LOC });
    enqueue(TABLE, [{ shift_date: '2026-05-04', total: 2 }], { locationId: LOC });
    enqueue(TABLE, [{ shift_date: '2026-05-04', total: 3 }], { locationId: LOC });
    assert.equal(depth(), 3);
  });

  it('rejects an empty rows array (no point queueing nothing)', () => {
    assert.throws(
      () => enqueue(TABLE, [], { locationId: LOC }),
      /no rows/i,
    );
    assert.equal(depth(), 0);
  });
});

describe('enqueue() — table allow-list', () => {
  it('exposes an explicit allow-list', () => {
    assert.ok(ALLOWED_TABLES instanceof Set, 'ALLOWED_TABLES should be a Set');
    assert.ok(ALLOWED_TABLES.has('settlement_summaries'));
    assert.ok(ALLOWED_TABLES.has('beo_events'));
    assert.ok(ALLOWED_TABLES.has('spend_monthly'));
    // PII / never-sync tables from the design doc:
    assert.equal(ALLOWED_TABLES.has('sales_lines'), false);
    assert.equal(ALLOWED_TABLES.has('sales_depletion_runs'), false);
    assert.equal(ALLOWED_TABLES.has('temp_log_entries'), false);
  });

  it('throws CLOUD_BRIDGE_TABLE_DENIED for a denied table; writes nothing', () => {
    assert.throws(
      () => enqueue('sales_lines', [{ check_guid: 'X', total: 9.99 }], { locationId: LOC }),
      (err) => err instanceof Error && err.message === CLOUD_BRIDGE_TABLE_DENIED,
    );
    assert.equal(depth(), 0);
  });

  it('throws for an unknown table (not in the allow-list)', () => {
    assert.throws(
      () => enqueue('made_up_table', [{ x: 1 }], { locationId: LOC }),
      (err) => err instanceof Error && err.message === CLOUD_BRIDGE_TABLE_DENIED,
    );
    assert.equal(depth(), 0);
  });
});

describe('claim() / ack() — FIFO drain', () => {
  it('claim(n) returns up to n batches in insertion order; marks them in-flight', () => {
    const id1 = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const id2 = enqueue(TABLE, [{ shift_date: '2026-05-02', total: 2 }], { locationId: LOC });
    const id3 = enqueue(TABLE, [{ shift_date: '2026-05-03', total: 3 }], { locationId: LOC });

    const batch = claim(2);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].id, id1);
    assert.equal(batch[1].id, id2);
    assert.equal(batch[0].table, TABLE);
    assert.deepStrictEqual(batch[0].rows, [{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(batch[0].locationId, LOC);
    assert.equal(batch[0].attempts, 1, 'attempts increments on claim');

    // A second claim should NOT re-yield the in-flight ones — only id3 left to claim.
    const batch2 = claim(10);
    assert.equal(batch2.length, 1);
    assert.equal(batch2[0].id, id3);
  });

  it('ack(id) removes the batch; depth drops', () => {
    const id1 = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    enqueue(TABLE, [{ shift_date: '2026-05-02', total: 2 }], { locationId: LOC });
    assert.equal(depth(), 2);

    const [c] = claim(1);
    ack(c.id);
    assert.equal(depth(), 1);

    // ack of an unknown id is a silent no-op (idempotent ack).
    ack(99999);
    assert.equal(depth(), 1);

    // The remaining batch is still claimable.
    const next = claim(10);
    assert.equal(next.length, 1);
    assert.notEqual(next[0].id, id1);
  });
});

describe('nack() — retry + dead-letter', () => {
  it('nack returns a batch to the queue; claim() re-yields it', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c] = claim(1);
    nack(c.id, 'transient: 503');

    // After nack, depth still 1 (still queued), and claim picks it up again.
    assert.equal(depth(), 1);
    const [c2] = claim(1);
    assert.equal(c2.id, c.id);
    assert.equal(c2.attempts, 2, 'attempts increments on each claim');
  });

  it('moves to dead-letter after maxAttempts (default 5)', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });

    // Five claim/nack cycles → on the fifth nack, batch should move to DLQ.
    for (let i = 0; i < 5; i++) {
      const [c] = claim(1);
      assert.ok(c, `iteration ${i}: expected a claimable batch`);
      nack(c.id, `transient retry ${i + 1}`);
    }
    assert.equal(depth(), 0, 'queue is empty after dead-lettering');
    assert.equal(deadLetterDepth(), 1, 'one batch in dead letter');
    assert.deepStrictEqual(claim(10), [], 'dead-lettered batch is no longer claimable');
  });
});

describe('sweepStaleClaims()', () => {
  // Helper: backdate the claimed_at on a row so it looks ancient. This is
  // the project's standard time-bypass pattern — there's no fake clock.
  const backdateClaim = (id, ago) =>
    testDb
      .prepare(
        `UPDATE cloud_bridge_outbox SET claimed_at = datetime('now', ?) WHERE id = ?`,
      )
      .run(ago, id);

  it('returns 0 on an empty queue', () => {
    assert.equal(sweepStaleClaims(), 0);
  });

  it('does not sweep a row claimed just now (not stale)', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c] = claim(1);
    assert.ok(c, 'pre-condition: a batch was claimed');

    assert.equal(sweepStaleClaims(), 0, 'fresh in-flight claim is not stale');

    // And the in-flight row is still in-flight (claim returns nothing).
    assert.deepStrictEqual(claim(10), []);
  });

  it('sweeps a stale claim back to queued state and counts it', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    claim(1);
    backdateClaim(id, '-10 minutes');

    assert.equal(sweepStaleClaims(), 1, 'returns count of swept rows');

    // claimed_at is reset to NULL.
    const row = testDb
      .prepare(`SELECT claimed_at FROM cloud_bridge_outbox WHERE id = ?`)
      .get(id);
    assert.equal(row.claimed_at, null);
  });

  it('after sweep, claim() picks the previously-stale row up again', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    claim(1);
    backdateClaim(id, '-10 minutes');

    sweepStaleClaims();

    const reclaimed = claim(10);
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].id, id);
  });

  it('does NOT sweep a dead-lettered row even if its claimed_at is ancient', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });

    // Push it to dead-letter via 5 nack cycles.
    for (let i = 0; i < 5; i++) {
      const [c] = claim(1);
      nack(c.id, `attempt ${i + 1}`);
    }
    assert.equal(deadLetterDepth(), 1, 'pre-condition: row is dead-lettered');

    // Backdate its claimed_at to an ancient time. (nack-to-DLQ stamps
    // claimed_at as a tombstone; we make it ancient on purpose here.)
    const dlqRow = testDb
      .prepare(`SELECT id FROM cloud_bridge_outbox WHERE dead_letter = 1`)
      .get();
    backdateClaim(dlqRow.id, '-1 day');

    assert.equal(sweepStaleClaims(), 0, 'dead-lettered rows are terminal');
    assert.equal(deadLetterDepth(), 1, 'still dead-lettered after sweep');
  });

  it('does not increment attempts when sweeping', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c1] = claim(1);
    assert.equal(c1.attempts, 1, 'pre: attempts incremented to 1 by claim()');

    backdateClaim(id, '-10 minutes');
    assert.equal(sweepStaleClaims(), 1);

    // Verify directly that attempts is still 1 after the sweep — sweeping
    // does not double-count an attempt that already happened.
    const after = testDb
      .prepare(`SELECT attempts FROM cloud_bridge_outbox WHERE id = ?`)
      .get(id);
    assert.equal(after.attempts, 1, 'sweep must not change attempts');

    // The next claim() bumps it to 2 (that's the new attempt).
    const [c2] = claim(1);
    assert.equal(c2.id, id);
    assert.equal(c2.attempts, 2, 'subsequent claim increments attempts as usual');
  });

  it('rejects non-finite or negative maxAgeSeconds (no-op, returns 0)', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c] = claim(1);
    backdateClaim(c.id, '-10 minutes');

    // Negatives, NaN, Infinity → silent no-op. Mirrors the input-validation
    // shape of claim() / ack() / nack().
    assert.equal(sweepStaleClaims(-1), 0);
    assert.equal(sweepStaleClaims(NaN), 0);
    assert.equal(sweepStaleClaims(Infinity), 0);

    // The stale row is still in-flight (not swept).
    assert.deepStrictEqual(claim(10), [], 'still claimed; nothing newly claimable');

    // Sanity: a valid call still works after the no-ops.
    assert.equal(sweepStaleClaims(300), 1);
  });

  it('honors a custom maxAgeSeconds (e.g. 60 sweeps a 2-minute-old claim)', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    claim(1);
    backdateClaim(id, '-2 minutes');

    // 2-minute-old claim is not stale under the default (300s) threshold...
    assert.equal(sweepStaleClaims(), 0);

    // ...but is stale under a custom 60s threshold.
    assert.equal(sweepStaleClaims(60), 1);

    const row = testDb
      .prepare(`SELECT claimed_at FROM cloud_bridge_outbox WHERE id = ?`)
      .get(id);
    assert.equal(row.claimed_at, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// Dead-letter triage helpers (Item 9).
//
// Drives a fresh batch all the way to dead-letter via 5 nack cycles
// so the listDeadLetters / getDeadLetter / requeueDeadLetter /
// dropDeadLetter contracts can be exercised against real rows.
//
// Placed BEFORE the persistence block on purpose: the persistence
// test calls setDbPathForTest(null) then re-opens, which leaves the
// cached `testDb` reference at the top of this file pointing at a
// closed DB. Any tests that run after persistence and reach for
// `testDb` in beforeEach blow up with "database connection is not
// open."
// ─────────────────────────────────────────────────────────────────

function deadLetterBatch(rows, opts = {}) {
  const id = enqueue(opts.table ?? TABLE, rows, {
    locationId: opts.locationId ?? LOC,
  });
  for (let i = 0; i < 5; i++) {
    const [c] = claim(1);
    nack(c.id, opts.lastError ?? `transient ${i + 1}`);
  }
  return id;
}

describe('listDeadLetters()', () => {
  it('returns [] when no dead letters exist', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    assert.deepStrictEqual(listDeadLetters(), []);
  });

  it('returns hydrated batches in FIFO id order', () => {
    const id1 = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    const id2 = deadLetterBatch([{ shift_date: '2026-05-02', total: 2 }]);

    const dlqs = listDeadLetters();
    assert.equal(dlqs.length, 2);
    assert.equal(dlqs[0].id, id1);
    assert.equal(dlqs[1].id, id2);
    assert.deepStrictEqual(dlqs[0].rows, [{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(dlqs[0].table, TABLE);
    assert.equal(dlqs[0].locationId, LOC);
    assert.equal(dlqs[0].attempts, 5, 'attempts is captured at dead-letter time');
    assert.match(dlqs[0].lastError ?? '', /transient 5/);
    assert.ok(dlqs[0].enqueuedAt, 'enqueuedAt is populated');
  });

  it('does not include alive (queued or in-flight) rows', () => {
    deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    enqueue(TABLE, [{ shift_date: '2026-05-02', total: 2 }], { locationId: LOC }); // queued
    const queuedId = enqueue(TABLE, [{ shift_date: '2026-05-03', total: 3 }], { locationId: LOC });
    claim(1); // marks one row in-flight; dead-letter list must skip it

    const dlqs = listDeadLetters();
    assert.equal(dlqs.length, 1);
    assert.notEqual(dlqs[0].id, queuedId);
  });

  it('filters by locationId when provided', () => {
    deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }], { locationId: 'site-a' });
    deadLetterBatch([{ shift_date: '2026-05-02', total: 2 }], { locationId: 'site-b' });

    const a = listDeadLetters({ locationId: 'site-a' });
    const b = listDeadLetters({ locationId: 'site-b' });
    const all = listDeadLetters();
    assert.equal(a.length, 1);
    assert.equal(a[0].locationId, 'site-a');
    assert.equal(b.length, 1);
    assert.equal(b[0].locationId, 'site-b');
    assert.equal(all.length, 2);
  });

  it('hydrates corrupt rows_json as [] (does not crash the triage UI)', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    testDb.prepare('UPDATE cloud_bridge_outbox SET rows_json = ? WHERE id = ?')
      .run('not-json', id);

    const dlqs = listDeadLetters();
    assert.equal(dlqs.length, 1);
    assert.deepStrictEqual(dlqs[0].rows, []);
  });
});

describe('getDeadLetter()', () => {
  it('returns null for unknown ids', () => {
    assert.equal(getDeadLetter(99999), null);
    assert.equal(getDeadLetter(0), null);
    assert.equal(getDeadLetter(-1), null);
  });

  it('returns null for an alive (queued) id', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    assert.equal(getDeadLetter(id), null);
  });

  it('returns the hydrated batch for a dead-lettered id', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 99 }]);
    const row = getDeadLetter(id);
    assert.ok(row);
    assert.equal(row.id, id);
    assert.equal(row.attempts, 5);
    assert.deepStrictEqual(row.rows, [{ shift_date: '2026-05-01', total: 99 }]);
  });
});

describe('requeueDeadLetter()', () => {
  it('returns false for unknown ids', () => {
    assert.equal(requeueDeadLetter(99999), false);
    assert.equal(requeueDeadLetter(0), false);
  });

  it('returns false (and changes nothing) for an alive queued id', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    assert.equal(requeueDeadLetter(id), false);
    // Row remains intact and claimable.
    const [c] = claim(1);
    assert.equal(c.id, id);
    assert.equal(c.attempts, 1, 'attempts unchanged by the no-op requeue');
  });

  it('clears dead_letter, resets attempts, last_error, claimed_at', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(deadLetterDepth(), 1);

    assert.equal(requeueDeadLetter(id), true);
    assert.equal(deadLetterDepth(), 0);
    assert.equal(depth(), 1, 'requeued batch is back in the active queue');

    const row = testDb
      .prepare(
        `SELECT dead_letter, attempts, last_error, claimed_at
           FROM cloud_bridge_outbox WHERE id = ?`,
      )
      .get(id);
    assert.equal(row.dead_letter, 0);
    assert.equal(row.attempts, 0, 'fresh retry budget');
    assert.equal(row.last_error, null);
    assert.equal(row.claimed_at, null);

    // Drainer can pick it up again.
    const [c] = claim(1);
    assert.equal(c.id, id);
    assert.equal(c.attempts, 1, 'first claim after requeue counts as attempt 1');
  });

  it('a second requeue of the same id is a no-op (already alive)', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(requeueDeadLetter(id), true);
    assert.equal(requeueDeadLetter(id), false, 'no longer dead-lettered');
  });

  it('REFUSES to requeue a row whose table_name is not on the current allow-list', () => {
    // Defense-in-depth: simulate a future state where ALLOWED_TABLES
    // has been tightened — a previously-allow-listed table got
    // reclassified, so an old dead-letter row's table_name is no
    // longer on the list. Force this by enqueuing normally, dead-
    // lettering, then mutating the row's table_name to something
    // off the list. The requeue must refuse rather than re-arm
    // a row that would now fail at enqueue().
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    testDb
      .prepare('UPDATE cloud_bridge_outbox SET table_name = ? WHERE id = ?')
      .run('retired_table_name', id);

    assert.equal(requeueDeadLetter(id), false, 'not on allow-list → refuse');

    // Row stays dead-lettered.
    const row = testDb
      .prepare('SELECT dead_letter, attempts FROM cloud_bridge_outbox WHERE id = ?')
      .get(id);
    assert.equal(row.dead_letter, 1, 'still dead-lettered');
    assert.equal(row.attempts, 5, 'attempts not reset');
  });
});

describe('dropDeadLetter()', () => {
  it('returns false for unknown ids', () => {
    assert.equal(dropDeadLetter(99999), false);
    assert.equal(dropDeadLetter(0), false);
  });

  it('returns false (and changes nothing) for an alive queued id', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    assert.equal(dropDeadLetter(id), false);
    assert.equal(depth(), 1, 'alive row was not deleted');
  });

  it('deletes a dead-lettered row by id', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(deadLetterDepth(), 1);
    assert.equal(dropDeadLetter(id), true);
    assert.equal(deadLetterDepth(), 0);

    const row = testDb
      .prepare('SELECT id FROM cloud_bridge_outbox WHERE id = ?')
      .get(id);
    assert.equal(row, undefined, 'row is gone');
  });

  it('a second drop of the same id is a no-op', () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    assert.equal(dropDeadLetter(id), true);
    assert.equal(dropDeadLetter(id), false);
  });
});

describe('persistence', () => {
  it('claim() returns the rows JSON exactly as enqueued', () => {
    const rows = [
      { shift_date: '2026-05-01', total: 4321.5, lines: 87, voided: 2 },
      { shift_date: '2026-05-01', total: 1234.0, lines: 31, voided: 0 },
    ];
    enqueue(TABLE, rows, { locationId: LOC });
    const [c] = claim(1);
    assert.deepStrictEqual(c.rows, rows);
  });

  it('survives a fresh DB handle (same file)', () => {
    enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });

    // Force a new handle by closing+reopening via setDbPathForTest. The
    // outbox row should still be there because it lives on disk.
    db.setDbPathForTest(null);
    db.setDbPathForTest(TMP_DB);

    assert.equal(depth(), 1);
    const [c] = claim(1);
    assert.equal(c.locationId, LOC);
    assert.equal(c.table, TABLE);
  });
});
