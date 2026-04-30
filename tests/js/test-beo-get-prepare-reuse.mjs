#!/usr/bin/env node
// Regression-prevention test for the GET /api/beo prepared-statement
// cache. The route hoists its three SELECTs (events, prep_tasks,
// line_items) into a per-db WeakMap so they are prepared once per
// process and reused across requests.
//
// This test wraps `db.prepare` with a counter and asserts:
//   1. The first GET prepares the three SELECTs once.
//   2. A second GET against the same db instance prepares zero
//      additional SELECTs (cache hit).
//   3. Rebinding the db via `setDbPathForTest` produces a fresh
//      instance, and the next GET prepares the three SELECTs again
//      against the new connection (cache is keyed by db identity, not
//      module-scope).
//
// Run: node --test tests/js/test-beo-get-prepare-reuse.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-beo-prepare-reuse-'));
const TMP_DB_A = path.join(TMP_DIR, 'a.db');
const TMP_DB_B = path.join(TMP_DIR, 'b.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/route.js');
const { GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function getReq() {
  return new Request('http://localhost/api/beo');
}

// SQL fragments that uniquely identify each of the three GET SELECTs.
// We rely on tail-end clauses that don't appear in any POST handler so
// the counter is not contaminated by other handlers preparing similarly
// shaped SQL. (Notably, the line_items SELECT contains a
// `FROM beo_events WHERE location_id` subquery, so the events fragment
// must also match the trailing ORDER BY to avoid double-counting.)
const GET_SQL_FRAGMENTS = [
  'FROM beo_events WHERE location_id = ? ORDER BY event_date DESC',
  'FROM beo_prep_tasks WHERE location_id = ? ORDER BY event_id, sort_order, id',
  'FROM beo_line_items\n          WHERE event_id IN',
];

function instrumentPrepare(targetDb) {
  const counts = Object.fromEntries(GET_SQL_FRAGMENTS.map((f) => [f, 0]));
  const origPrepare = targetDb.prepare.bind(targetDb);
  targetDb.prepare = (sql) => {
    for (const frag of GET_SQL_FRAGMENTS) {
      if (typeof sql === 'string' && sql.includes(frag)) counts[frag] += 1;
    }
    return origPrepare(sql);
  };
  return counts;
}

describe('GET /api/beo — prepared-statement reuse', () => {
  it('prepares each GET SELECT once per db, reuses across requests, and re-prepares against a rebound db', async () => {
    // ── DB A: first GET prepares once, second GET reuses ──────────
    db.setDbPathForTest(TMP_DB_A);
    const dbA = db.getDb();
    const countsA = instrumentPrepare(dbA);

    const res1 = await GET(getReq());
    assert.strictEqual(res1.status, 200);
    for (const frag of GET_SQL_FRAGMENTS) {
      assert.strictEqual(
        countsA[frag],
        1,
        `first GET should prepare "${frag}" exactly once, got ${countsA[frag]}`,
      );
    }

    const res2 = await GET(getReq());
    assert.strictEqual(res2.status, 200);
    for (const frag of GET_SQL_FRAGMENTS) {
      assert.strictEqual(
        countsA[frag],
        1,
        `second GET should reuse cached "${frag}", count went to ${countsA[frag]}`,
      );
    }

    // ── DB B: rebinding closes A, so the cache must miss on B ─────
    db.setDbPathForTest(TMP_DB_B);
    const dbB = db.getDb();
    assert.notStrictEqual(dbA, dbB, 'setDbPathForTest must produce a new db instance');
    const countsB = instrumentPrepare(dbB);

    const res3 = await GET(getReq());
    assert.strictEqual(res3.status, 200);
    for (const frag of GET_SQL_FRAGMENTS) {
      assert.strictEqual(
        countsB[frag],
        1,
        `GET against rebound db should re-prepare "${frag}", got ${countsB[frag]}`,
      );
    }
  });
});
