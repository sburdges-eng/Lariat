#!/usr/bin/env node
// Pin the contract for lib/idempotency.ts::withIdempotency.
//
// Spec: docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md
// Plan: docs/superpowers/plans/2026-05-02-sw-replay-idempotency-plan.md (Task 1)
// Found via: docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md
//
// Five cases:
//   1. No `idempotency-key` header → handler runs once, response passes through, NOTHING cached.
//   2. New key → handler runs, response cached.
//   3. Same key + same hash → handler does NOT run, cached response returned.
//   4. Same key + different hash → 409, handler does NOT run, cache row unchanged.
//   5. Key older than 24h → swept; treated as fresh; handler runs again.
//
// Run: node --experimental-strip-types --test tests/js/test-idempotency-wrapper.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-idem-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { withIdempotency } = await import('../../lib/idempotency.ts');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM idempotency_keys`);
});

function makeReq({ method = 'POST', url = 'http://localhost/api/temp-log', body = '', headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : body,
  });
}

const KEY_A = 'key-aaaaaaaaaaaaaaaa';

describe('withIdempotency — case 1: no header', () => {
  it('runs the handler unchanged and writes nothing to the cache', async () => {
    let callCount = 0;
    const req = makeReq({ body: JSON.stringify({ x: 1 }) });
    const res = await withIdempotency(req, async () => {
      callCount++;
      return Response.json({ ok: true, n: callCount }, { status: 200 });
    });
    assert.strictEqual(callCount, 1);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: true, n: 1 });
    const cacheCount = testDb
      .prepare('SELECT COUNT(*) AS c FROM idempotency_keys')
      .get().c;
    assert.strictEqual(cacheCount, 0);
  });
});

describe('withIdempotency — case 2: new key', () => {
  it('runs the handler and caches the response', async () => {
    let callCount = 0;
    const req = makeReq({
      body: JSON.stringify({ x: 1 }),
      headers: { 'idempotency-key': KEY_A },
    });
    const res = await withIdempotency(req, async () => {
      callCount++;
      return Response.json({ ok: true, n: callCount }, { status: 201 });
    });
    assert.strictEqual(callCount, 1);
    assert.strictEqual(res.status, 201);
    const cacheRow = testDb
      .prepare('SELECT * FROM idempotency_keys WHERE key = ?')
      .get(KEY_A);
    assert.ok(cacheRow);
    assert.strictEqual(cacheRow.method, 'POST');
    assert.strictEqual(cacheRow.path, '/api/temp-log');
    assert.strictEqual(cacheRow.response_status, 201);
    const cached = JSON.parse(cacheRow.response_body);
    assert.deepStrictEqual(cached, { ok: true, n: 1 });
  });
});

describe('withIdempotency — case 3: same key + same hash', () => {
  it('does NOT run the handler; returns cached response', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return Response.json({ ok: true, n: callCount }, { status: 201 });
    };
    const headers = { 'idempotency-key': KEY_A };
    const body = JSON.stringify({ x: 1 });

    // First call — runs handler.
    const r1 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(r1.status, 201);

    // Second call — replay. Handler should NOT run.
    const r2 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 1, 'handler must run exactly once across replays');
    assert.strictEqual(r2.status, 201);
    const body2 = await r2.json();
    assert.deepStrictEqual(body2, { ok: true, n: 1 });

    // Third call (extra paranoia)
    const r3 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(r3.status, 201);
  });
});

describe('withIdempotency — case 4: same key + different hash', () => {
  it('returns 409 without running the handler', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return Response.json({ ok: true }, { status: 201 });
    };
    const headers = { 'idempotency-key': KEY_A };

    const r1 = await withIdempotency(
      makeReq({ body: JSON.stringify({ x: 1 }), headers }),
      handler,
    );
    assert.strictEqual(r1.status, 201);

    // Same key, different body — must 409.
    const r2 = await withIdempotency(
      makeReq({ body: JSON.stringify({ x: 999 }), headers }),
      handler,
    );
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(callCount, 1, 'handler must NOT run on key-reuse with different hash');
    const body = await r2.json();
    assert.match(body.error, /idempotency-key reused/i);
  });
});

describe('withIdempotency — case 5: key older than 24h', () => {
  it('sweeps the stale row; runs the handler again', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return Response.json({ ok: true, n: callCount }, { status: 200 });
    };
    const headers = { 'idempotency-key': KEY_A };
    const body = JSON.stringify({ x: 1 });

    await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 1);

    // Force-age the row past the 24h TTL.
    testDb
      .prepare(
        `UPDATE idempotency_keys
            SET created_at = datetime('now', '-2 days')
          WHERE key = ?`,
      )
      .run(KEY_A);

    // Next call — sweep drops the row, handler runs fresh.
    const r2 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 2);
    const body2 = await r2.json();
    assert.deepStrictEqual(body2, { ok: true, n: 2 });
  });
});

describe('withIdempotency — input validation', () => {
  it('400s on a malformed key (too short)', async () => {
    const r = await withIdempotency(
      makeReq({ headers: { 'idempotency-key': 'short' } }),
      async () => Response.json({ ok: true }),
    );
    assert.strictEqual(r.status, 400);
  });

  it('400s on a key with disallowed chars', async () => {
    const r = await withIdempotency(
      makeReq({ headers: { 'idempotency-key': '../../etc/passwd@@@' } }),
      async () => Response.json({ ok: true }),
    );
    assert.strictEqual(r.status, 400);
  });
});

describe('withIdempotency — 401 responses are not cached (auth is per-request)', () => {
  it('a 401 from the handler must NOT be cached; subsequent authed call runs fresh', async () => {
    // Surfaced by ultrathink debug pass: cache key is (key, request_hash) —
    // it does NOT include auth state. If a 401 is cached against the
    // (key, body) tuple, a user who taps Save without a PIN, then
    // authenticates, then taps Save again with the same key gets back the
    // cached 401 — confused-deputy UX bug. 401 responses must always
    // re-run the handler.
    const headers = { 'idempotency-key': KEY_A };
    const body = JSON.stringify({ x: 1 });

    let callCount = 0;
    const handler = async () => {
      callCount++;
      // First call: simulate "no auth" -> 401. Second call: simulate
      // "auth granted" -> 200. Pure function of callCount, not of the
      // request — proves the wrapper actually re-ran the handler the
      // second time rather than returning the cached 401.
      return callCount === 1
        ? Response.json({ error: 'unauthorized' }, { status: 401 })
        : Response.json({ ok: true }, { status: 200 });
    };

    const r1 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(r1.status, 401);
    // 401 must NOT be cached.
    const cacheCount = testDb
      .prepare('SELECT COUNT(*) AS c FROM idempotency_keys')
      .get().c;
    assert.strictEqual(cacheCount, 0, '401 response must not produce a cache row');

    // Second call with same key — handler MUST run again, not return cached 401.
    const r2 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 2, 'handler should have re-run on the second call');
    assert.strictEqual(r2.status, 200, 'expected 200 after auth, not the cached 401');
  });

  it('non-401 4xx responses (e.g. 422) ARE still cached — they are deterministic per body', async () => {
    // Sanity check that we narrowed the carve-out to 401 only and
    // didn\'t broaden it. 422 from a malformed body is the right
    // answer on retry too.
    const headers = { 'idempotency-key': KEY_A };
    const body = JSON.stringify({ x: 1 });
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return Response.json({ error: 'malformed' }, { status: 422 });
    };

    await withIdempotency(makeReq({ body, headers }), handler);
    await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 1, '422 should be cached on first call, replayed on second');
  });
});

describe('withIdempotency — handler errors are not cached', () => {
  it('a thrown handler does not write a cache row', async () => {
    const headers = { 'idempotency-key': KEY_A };
    const body = JSON.stringify({ x: 1 });
    let callCount = 0;
    const handler = async () => {
      callCount++;
      if (callCount === 1) throw new Error('first call boom');
      return Response.json({ ok: true, n: callCount }, { status: 200 });
    };

    await assert.rejects(
      () => withIdempotency(makeReq({ body, headers }), handler),
      /first call boom/,
    );
    const cacheCount = testDb
      .prepare('SELECT COUNT(*) AS c FROM idempotency_keys')
      .get().c;
    assert.strictEqual(cacheCount, 0, 'thrown handler must not produce a cache row');

    // Second call with same key proceeds fresh.
    const r2 = await withIdempotency(makeReq({ body, headers }), handler);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(r2.status, 200);
  });
});
