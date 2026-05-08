#!/usr/bin/env node
// Cloud-bridge outbox — TOCTOU race-safety structural invariants.
//
// Audit ref: docs/audit/2026-05-08-codebase-audit.md §3, Cloud-bridge HIGH.
//
// Two race shapes:
//   1) claim(): SELECT FROM cloud_bridge_outbox ran outside the tx that
//      did the attempts++/claimed_at UPDATE — two concurrent drainers
//      could both SELECT the same rows before either UPDATE fired.
//   2) nack(): SELECT attempts → branch to queued-or-DLQ UPDATE, both
//      outside any tx — a concurrent sweepStaleClaims() could reset
//      claimed_at between, exposing the row to claim() mid-nack.
//
// better-sqlite3 is synchronous so a true threaded race can't be
// triggered from Node, but we CAN assert the structural invariant that
// the SELECT executions live inside db.transaction(...). Same approach
// as the TPHC PATCH TOCTOU regression test (commit aef09bf).
//
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-queue-race-safety.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cbq-race-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const queue = await import('../../lib/cloudBridgeQueue.ts');
const { enqueue, claim, nack, depth, deadLetterDepth } = queue;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM cloud_bridge_outbox`);
});

const LOC = 'default';
const TABLE = 'settlement_summaries';

// ─── Source-grep helper ──────────────────────────────────────────

const here = path.dirname(url.fileURLToPath(import.meta.url));
const QUEUE_SRC = fs.readFileSync(
  path.resolve(here, '../../lib/cloudBridgeQueue.ts'),
  'utf8',
);

/**
 * Slice the source of an exported top-level function from
 * `export function <fnName>` to the next `\nexport function ` (or EOF).
 */
function functionBody(src, fnName) {
  const startMarker = `export function ${fnName}`;
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`could not locate "${startMarker}"`);
  const after = src.indexOf('\nexport function ', start + startMarker.length);
  return after < 0 ? src.slice(start) : src.slice(start, after);
}

// ─── Structural invariants ───────────────────────────────────────

// db.prepare() defines a reusable template, not an execution. The
// invariant is that no .all()/.get() row read fires before
// db.transaction(...) opens. If anyone reintroduces a top-level read,
// these tests trip.

describe('claim() — TOCTOU structural invariant', () => {
  it('claim() opens db.transaction(...) before executing any SELECT', () => {
    const body = functionBody(QUEUE_SRC, 'claim');
    const txIdx = body.indexOf('db.transaction(');
    assert.ok(txIdx > 0, 'claim() must open db.transaction(...)');
    assert.doesNotMatch(
      body.slice(0, txIdx),
      /\.(all|get)\s*\(/,
      'claim() must not execute .all/.get before db.transaction(...) — TOCTOU race with concurrent drainers',
    );
  });
});

describe('nack() — TOCTOU structural invariant', () => {
  it('nack() opens db.transaction(...) before executing SELECT attempts', () => {
    const body = functionBody(QUEUE_SRC, 'nack');
    const txIdx = body.indexOf('db.transaction(');
    assert.ok(txIdx > 0, 'nack() must open db.transaction(...)');
    assert.doesNotMatch(
      body.slice(0, txIdx),
      /\.(all|get)\s*\(/,
      'nack() must not execute .all/.get before db.transaction(...) — TOCTOU race with sweepStaleClaims()',
    );
    // Tripwire: both branch UPDATEs must still exist somewhere in the body.
    assert.match(body, /SET\s+dead_letter\s*=\s*1/i, 'dead-letter branch missing');
    assert.match(body, /SET\s+claimed_at\s*=\s*NULL/i, 'requeue branch missing');
  });
});

// ─── Behavioral happy-path snapshot ──────────────────────────────
// The fix is structural; these document that single-threaded behavior
// is preserved post-refactor.

describe('claim() — atomic batch increment', () => {
  it('claim(n) increments attempts + stamps claimed_at on every claimed row', () => {
    const id1 = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const id2 = enqueue(TABLE, [{ shift_date: '2026-05-02', total: 2 }], { locationId: LOC });

    const batch = claim(2);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].id, id1);
    assert.equal(batch[1].id, id2);
    assert.equal(batch[0].attempts, 1);
    assert.equal(batch[1].attempts, 1);
    assert.equal(depth(), 0, 'all rows in-flight, none available');

    const stamped = testDb
      .prepare(`SELECT COUNT(*) AS n FROM cloud_bridge_outbox WHERE claimed_at IS NOT NULL`)
      .get();
    assert.equal(stamped.n, 2, 'claimed_at stamped on both rows in one tx');
  });
});

describe('nack() — branches stay correct after refactor', () => {
  it('nack with attempts < maxAttempts returns the row to the queue', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c] = claim(1);
    assert.equal(c.id, id);
    assert.equal(depth(), 0);

    nack(id, 'transient', { maxAttempts: 5 });
    assert.equal(depth(), 1, 'nacked row visible to next claim');
    assert.equal(deadLetterDepth(), 0);
  });

  it('nack with attempts >= maxAttempts moves the row to dead-letter', () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: LOC });
    const [c] = claim(1);
    assert.equal(c.attempts, 1);

    // maxAttempts=1 → 1 attempt is already too many → DLQ on nack.
    nack(id, 'fatal', { maxAttempts: 1 });
    assert.equal(depth(), 0);
    assert.equal(deadLetterDepth(), 1, 'row moved to dead-letter');
  });
});
