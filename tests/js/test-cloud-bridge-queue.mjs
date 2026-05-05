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
