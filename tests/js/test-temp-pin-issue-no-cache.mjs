#!/usr/bin/env node
// Regression — POST /api/auth/temp-pin/issue must NOT cache the raw
// PIN in idempotency_keys (audit 2026-05-08 §1, Tier-1 HIGH #2). The
// route was previously wrapped in withIdempotency, which caches the
// response body — containing the raw PIN — for 24h. The fix removes
// the wrapper; this test pins the no-leak invariant.
//
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-issue-no-cache.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
// Legacy unsigned cookie path (parity with test-temp-pin-routes.mjs).
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const issueRoute = await import('../../app/api/auth/temp-pin/issue/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
});

function makeReq({ body, idempotencyKey } = {}) {
  const headers = { 'content-type': 'application/json', cookie: 'lariat_pin_ok=1' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request('http://localhost/api/auth/temp-pin/issue', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const futureIso = (m = 60) => new Date(Date.now() + m * 60_000).toISOString();

describe('POST /api/auth/temp-pin/issue — no PIN leak via idempotency_keys', () => {
  it('does NOT cache the raw PIN in idempotency_keys (audit §1 HIGH #2)', async () => {
    // 16+ char idempotency-key — wrapper rejects shorter keys.
    const res = await issueRoute.POST(
      makeReq({
        body: { label: 'Sous chef Marco', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
        idempotencyKey: 'abcdefghijklmnop_no_cache_1',
      }),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.match(json.pin, /^[0-9]{4}$/);

    // Pre-fix: withIdempotency wrote the response body verbatim into
    // response_body, leaking the PIN. Post-fix: zero rows touch the cache.
    const leaked = conn
      .prepare(`SELECT key FROM idempotency_keys WHERE response_body LIKE ?`)
      .get(`%${json.pin}%`);
    assert.equal(leaked, undefined, 'raw PIN must NOT appear in idempotency_keys.response_body');

    const cacheCount = conn.prepare(`SELECT COUNT(*) AS n FROM idempotency_keys`).get().n;
    assert.equal(cacheCount, 0, 'issue route must not write to idempotency_keys at all');
  });

  it('a replay with the same idempotency-key mints a fresh PIN', async () => {
    // The "re-tap returns same response" contract is intentionally
    // gone — caching would re-leak the PIN. Manager UI is the only
    // caller (no SW-replay path) so dedup is unnecessary.
    const key = 'abcdefghijklmnop_replay_1';
    const body = { label: 'Twice', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] };

    const first = await issueRoute.POST(makeReq({ body, idempotencyKey: key }));
    const second = await issueRoute.POST(makeReq({ body, idempotencyKey: key }));
    const j1 = await first.json();
    const j2 = await second.json();
    assert.notEqual(j1.id, j2.id, 'replay must mint a new row, not return the cached one');
    assert.notEqual(j1.pin, j2.pin, 'replay must mint a new PIN');

    assert.equal(conn.prepare(`SELECT COUNT(*) AS n FROM temp_pins`).get().n, 2);
    assert.equal(conn.prepare(`SELECT COUNT(*) AS n FROM idempotency_keys`).get().n, 0);
  });

  it('happy-path single POST writes exactly one temp_pins row', async () => {
    // Collision-retry loop (5 attempts) covers UNIQUE conflicts on
    // pin_hash. On a freshly-purged table the first attempt wins.
    const res = await issueRoute.POST(
      makeReq({
        body: { label: 'Solo', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(conn.prepare(`SELECT COUNT(*) AS n FROM temp_pins`).get().n, 1);
  });
});
