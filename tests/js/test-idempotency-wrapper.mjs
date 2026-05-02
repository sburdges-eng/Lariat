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
