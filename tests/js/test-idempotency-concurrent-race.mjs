#!/usr/bin/env node
// Tests for GH #249 — withIdempotency must not run the handler twice when
// two concurrent identical requests arrive with the same idempotency-key.
//
// Pre-fix flow was `lookup() → handler() → store()`. Both concurrent
// requests passed the lookup miss, both ran the handler (duplicate
// audit rows + duplicate writes), then one INSERT lost the PK conflict
// and the loser silently swallowed it. For routes that write to
// regulated tables (e.g. /api/signoff posting a station_signoffs row +
// audit_events row), this produced two attestations for one shift.
//
// Post-fix the wrapper reserves the slot up-front with status='pending'.
// The second concurrent caller loses the INSERT race, reads the row,
// and returns 409 "in flight" instead of running the handler. On
// success the row flips to 'complete'.
//
// Run:
//   node --experimental-strip-types --test \
//        tests/js/test-idempotency-concurrent-race.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-idem-race-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { withIdempotency } = await import('../../lib/idempotency.ts');

// Use a real regulated-shape side-effect table — station_signoffs is the
// exact route the issue called out ("two signoff POSTs → two rows in
// station_signoffs for the same (shift, station, cook)"). Schema is
// initialized on first getDb() — columns are id (AUTOINCREMENT),
// shift_date, station_id, cook_id, signoff_type, created_at, location_id.
const SIDE_EFFECT_INSERT = `
  INSERT INTO station_signoffs (shift_date, station_id, cook_id, location_id)
  VALUES (?, ?, ?, ?)
`;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM idempotency_keys;
    DELETE FROM station_signoffs;
    DELETE FROM audit_events;
  `);
});

function makeReq({ method = 'POST', url = 'http://localhost/api/signoff', body = '', headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : body,
  });
}

const KEY = 'race-key-aaaaaaaaaaaaaaaa';

/**
 * A handler that takes deterministic steps:
 *   1. yield once via setImmediate (allows the parallel call to enter
 *      its claim-slot path).
 *   2. INSERT a row into station_signoffs.
 *   3. INSERT a corresponding audit_events row.
 *   4. yield again (lengthens the in-flight window for the racing call).
 *   5. Return 200.
 *
 * `calls` is incremented at the very top so the test can prove how
 * many times the handler body started running.
 */
function makeHandler({ calls }) {
  return async () => {
    calls.n += 1;
    await new Promise((r) => setImmediate(r));
    testDb.transaction(() => {
      testDb.prepare(SIDE_EFFECT_INSERT).run('2026-05-13', 'grill', 'cook-a', 'default');
      testDb
        .prepare(
          `INSERT INTO audit_events
             (entity, action, actor_source, location_id, shift_date, payload_json, created_at)
           VALUES ('station_signoffs', 'insert', 'kitchen_assistant', 'default', '2026-05-13',
                   '{}', datetime('now'))`,
        )
        .run();
    })();
    await new Promise((r) => setImmediate(r));
    return Response.json({ ok: true, calls: calls.n }, { status: 200 });
  };
}

describe('withIdempotency — concurrent identical requests (#249)', () => {
  it('runs the handler exactly once when two parallel calls share the same key', async () => {
    const calls = { n: 0 };
    const handler = makeHandler({ calls });
    const headers = { 'idempotency-key': KEY };
    const body = JSON.stringify({ shift_date: '2026-05-13', station: 'grill', cook: 'cook-a' });

    const [r1, r2] = await Promise.all([
      withIdempotency(makeReq({ body, headers }), handler),
      withIdempotency(makeReq({ body, headers }), handler),
    ]);

    assert.equal(calls.n, 1, 'handler must run exactly once');

    const signoffCount = testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c;
    assert.equal(signoffCount, 1, 'exactly one station_signoffs row should land');

    const auditCount = testDb.prepare('SELECT COUNT(*) AS c FROM audit_events').get().c;
    assert.equal(auditCount, 1, 'exactly one audit_events row should land');

    // One call should be the handler's 200; the other should either be
    // 503 in-flight (handler1 still running when handler2 started) or
    // 200 cached (handler1 already complete). Both are valid outcomes.
    // 503, not 409: a same-body race is transient, not a conflict — 409
    // is reserved for a key reused with a DIFFERENT body (see
    // lib/idempotency.ts's case 3'/case 4 split).
    const statuses = [r1.status, r2.status].sort();
    assert.ok(
      (statuses[0] === 200 && statuses[1] === 200) ||
      (statuses[0] === 200 && statuses[1] === 503),
      `expected [200, 200] (cached) or [200, 503] (in-flight); got ${JSON.stringify(statuses)}`,
    );

    // The 503, when present, must carry the "in flight" error so the SW
    // (or human) knows to retry — not the "key reused" 409 which would
    // signal a buggy client.
    for (const r of [r1, r2]) {
      if (r.status === 503) {
        const body = await r.clone().json();
        assert.match(body.error, /in flight/i);
      }
    }
  });

  it('three parallel calls still produce exactly one side-effect row', async () => {
    const calls = { n: 0 };
    const handler = makeHandler({ calls });
    const headers = { 'idempotency-key': 'race-key-bbbbbbbbbbbbbbbb' };
    const body = JSON.stringify({ shift_date: '2026-05-13', station: 'grill', cook: 'cook-a' });

    const results = await Promise.all([
      withIdempotency(makeReq({ body, headers }), handler),
      withIdempotency(makeReq({ body, headers }), handler),
      withIdempotency(makeReq({ body, headers }), handler),
    ]);

    assert.equal(calls.n, 1, 'handler must run exactly once across three parallel callers');
    assert.equal(
      testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c,
      1,
    );
    assert.equal(
      testDb.prepare('SELECT COUNT(*) AS c FROM audit_events').get().c,
      1,
    );
    assert.equal(results.length, 3);
  });
});

describe('withIdempotency — pending row reaped after orphan timeout (#249)', () => {
  it('serves the next request fresh after a pending row is force-aged past the orphan TTL', async () => {
    // Seed a pending row by hand to simulate a crashed mid-flight
    // handler. Force `created_at` past the 60s pending-reap window so
    // the sweep on the next wrapped call drops it.
    testDb
      .prepare(
        `INSERT INTO idempotency_keys
           (key, method, path, request_hash, response_status, response_body, status, created_at)
         VALUES ('orphan-key-aaaaaaaaaaaaaaaa', 'POST', '/api/signoff', 'xxx', 0, '', 'pending',
                 datetime('now', '-10 minutes'))`,
      )
      .run();

    const calls = { n: 0 };
    const handler = makeHandler({ calls });
    const headers = { 'idempotency-key': 'orphan-key-aaaaaaaaaaaaaaaa' };
    const body = JSON.stringify({ shift_date: '2026-05-13', station: 'grill', cook: 'cook-a' });

    const res = await withIdempotency(makeReq({ body, headers }), handler);
    assert.equal(res.status, 200, 'handler should have re-run after orphan reap');
    assert.equal(calls.n, 1);
    // The single new row from this run should be the only signoff.
    assert.equal(
      testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c,
      1,
    );
  });
});
