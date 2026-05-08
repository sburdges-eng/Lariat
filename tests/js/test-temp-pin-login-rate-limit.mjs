#!/usr/bin/env node
// Rate-limit tests for /api/auth/temp-pin/login (5/60s per IP).
// Mirrors the limiter shape in /api/auth/pin. Cases:
//   1. burst of 6 wrong PINs → first 5 are 401, 6th is 429
//   2. window expiry resets the count (via _setNowForTest)
//   3. successful login clears attempts (post-clear 4 wrongs ≠ 429)
//   4. format-fail also counts as an attempt
//   5. JSON-fail also counts as an attempt
//   6. TRUST_PROXY off → x-forwarded-for ignored (one bucket)
//   7. TRUST_PROXY on  → different XFF IPs are independent
//
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-login-rate-limit.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
const SAVED_TRUST_PROXY = process.env.LARIAT_TRUST_PROXY;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;
// Default: TRUST_PROXY off. The TRUST_PROXY-on case re-imports the
// route after flipping the env (see bottom of this file).
delete process.env.LARIAT_TRUST_PROXY;

const db = await import('../../lib/db.ts');
const issueRoute = await import('../../app/api/auth/temp-pin/issue/route.js');
const loginRoute = await import('../../app/api/auth/temp-pin/login/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  if (SAVED_TRUST_PROXY === undefined) delete process.env.LARIAT_TRUST_PROXY;
  else process.env.LARIAT_TRUST_PROXY = SAVED_TRUST_PROXY;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events;');
  // Each test starts with a clean limiter map. The route exposes
  // _resetAttemptsForTest so we don't accumulate state across cases.
  if (typeof loginRoute._resetAttemptsForTest === 'function') {
    loginRoute._resetAttemptsForTest();
  }
  if (typeof loginRoute._setNowForTest === 'function') {
    loginRoute._setNowForTest(null);
  }
});

const PIN_COOKIE = 'lariat_pin_ok=1';

function makeReq({ method = 'POST', path = '/', body, withPin = false, headers: extra } = {}) {
  const headers = { 'content-type': 'application/json', ...(extra ?? {}) };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

const futureIso = (minutesAhead = 60) =>
  new Date(Date.now() + minutesAhead * 60_000).toISOString();

async function issueOne(label = 'RL Test') {
  const req = new Request('http://localhost/api/auth/temp-pin/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: PIN_COOKIE },
    body: JSON.stringify({
      label,
      expires_at: futureIso(),
      scopes: ['beo.fire_at_edit'],
    }),
  });
  const res = await issueRoute.POST(req);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// 1. Burst of 6 wrong PINs from the same IP
// ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/temp-pin/login — rate limiter (5/60s per IP)', () => {
  it('first 5 wrong PINs return 401, 6th returns 429', async () => {
    // Use a non-existent PIN so each call hits the unknown-PIN path.
    const wrongPin = '9999';
    for (let i = 0; i < 5; i++) {
      const res = await loginRoute.POST(
        makeReq({ path: '/api/auth/temp-pin/login', body: { pin: wrongPin } }),
      );
      assert.equal(res.status, 401, `attempt ${i + 1} should be 401`);
    }
    const sixth = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin: wrongPin } }),
    );
    assert.equal(sixth.status, 429, '6th attempt should be rate-limited');
  });

  it('after the 60s window expires, attempts reset', async () => {
    // Skip if the route hasn't exposed an injectable clock — see
    // README/PR notes for the gap. Mark explicitly so reviewers see it.
    if (typeof loginRoute._setNowForTest !== 'function') {
      assert.fail('route must expose _setNowForTest for window-expiry test');
    }
    const wrongPin = '9999';
    let fakeNow = 1_000_000_000_000;
    loginRoute._setNowForTest(() => fakeNow);

    for (let i = 0; i < 5; i++) {
      const res = await loginRoute.POST(
        makeReq({ path: '/api/auth/temp-pin/login', body: { pin: wrongPin } }),
      );
      assert.equal(res.status, 401);
    }
    // 6th hits the limiter
    const sixth = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin: wrongPin } }),
    );
    assert.equal(sixth.status, 429);

    // Advance past the window — old timestamps should be filtered out.
    fakeNow += 60_001;
    const after = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin: wrongPin } }),
    );
    assert.equal(after.status, 401, 'window should have rolled over');
  });

  // Per-IP independence is asserted in the TRUST_PROXY-ON suite below;
  // with TRUST_PROXY off, every request buckets to the same fallback
  // IP, so XFF can't be used to demonstrate independence here.

  it('successful login clears attempts', async () => {
    const { pin } = await issueOne('clear-on-success');
    // 4 wrong attempts (still under the limit of 5)
    for (let i = 0; i < 4; i++) {
      const res = await loginRoute.POST(
        makeReq({ path: '/api/auth/temp-pin/login', body: { pin: '9999' } }),
      );
      assert.equal(res.status, 401);
    }
    // Successful login — should clear the 4 prior attempts
    const ok = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin } }),
    );
    assert.equal(ok.status, 200);
    // 4 more wrong attempts must still all return 401, NOT 429
    for (let i = 0; i < 4; i++) {
      const res = await loginRoute.POST(
        makeReq({ path: '/api/auth/temp-pin/login', body: { pin: '9999' } }),
      );
      assert.equal(res.status, 401, `post-clear attempt ${i + 1} must be 401, not 429`);
    }
  });

  it('format-fail PINs (wrong length / non-digits) also count', async () => {
    // 5 malformed bodies → all 422
    for (let i = 0; i < 5; i++) {
      const res = await loginRoute.POST(
        makeReq({ path: '/api/auth/temp-pin/login', body: { pin: '12' } }), // too short
      );
      assert.equal(res.status, 422, `format-fail ${i + 1} should be 422`);
    }
    // 6th request — even with a correctly-formatted PIN — must hit 429
    // because the limiter ran before format validation.
    const sixth = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin: '9999' } }),
    );
    assert.equal(sixth.status, 429, '6th should be 429 even with valid format');
  });

  it('JSON-fail bodies also count', async () => {
    // Send raw garbage body bypassing JSON.stringify — bypass makeReq.
    const garbageReq = (i) =>
      new Request('http://localhost/api/auth/temp-pin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json' + i,
      });
    for (let i = 0; i < 5; i++) {
      const res = await loginRoute.POST(garbageReq(i));
      assert.equal(res.status, 422, `json-fail ${i + 1} should be 422`);
    }
    // 6th well-formed call hits the limiter
    const sixth = await loginRoute.POST(
      makeReq({ path: '/api/auth/temp-pin/login', body: { pin: '9999' } }),
    );
    assert.equal(sixth.status, 429);
  });
});

// TRUST_PROXY off (default) — XFF must be ignored (no bucket rotation).
// TRUST_PROXY on  — re-import the route after flipping the env so the
// module-scope `const TRUST_PROXY` re-reads. Cache-bust via query.

describe('POST /api/auth/temp-pin/login — TRUST_PROXY off (default)', () => {
  beforeEach(() => {
    conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events;');
    if (typeof loginRoute._resetAttemptsForTest === 'function') {
      loginRoute._resetAttemptsForTest();
    }
  });

  it('x-forwarded-for is IGNORED — different XFF values still bucket together', async () => {
    // 5 attempts with different XFF headers → still hits the limit on
    // the 6th, because TRUST_PROXY=off means we ignore XFF.
    const ips = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'];
    for (let i = 0; i < 5; i++) {
      const res = await loginRoute.POST(
        makeReq({
          path: '/api/auth/temp-pin/login',
          body: { pin: '9999' },
          headers: { 'x-forwarded-for': ips[i] },
        }),
      );
      assert.equal(res.status, 401, `XFF=${ips[i]} should not get a fresh bucket`);
    }
    const sixth = await loginRoute.POST(
      makeReq({
        path: '/api/auth/temp-pin/login',
        body: { pin: '9999' },
        headers: { 'x-forwarded-for': '6.6.6.6' },
      }),
    );
    assert.equal(sixth.status, 429, '6th must be 429 — XFF spoofing must not rotate buckets');
  });
});

// ─────────────────────────────────────────────────────────────────
// TRUST_PROXY ON — different IPs are independent
// ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/temp-pin/login — TRUST_PROXY on (per-IP)', () => {
  let trustedRoute;

  before(async () => {
    process.env.LARIAT_TRUST_PROXY = '1';
    // Cache-bust the route so it re-reads TRUST_PROXY at module scope.
    trustedRoute = await import('../../app/api/auth/temp-pin/login/route.js?trustproxy=1');
  });

  after(() => {
    delete process.env.LARIAT_TRUST_PROXY;
  });

  beforeEach(() => {
    conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events;');
    if (typeof trustedRoute._resetAttemptsForTest === 'function') {
      trustedRoute._resetAttemptsForTest();
    }
  });

  it('burst from IP A does not rate-limit IP B', async () => {
    // Saturate IP A
    for (let i = 0; i < 5; i++) {
      const res = await trustedRoute.POST(
        makeReq({
          path: '/api/auth/temp-pin/login',
          body: { pin: '9999' },
          headers: { 'x-forwarded-for': '10.0.0.1' },
        }),
      );
      assert.equal(res.status, 401);
    }
    // 6th from A → 429
    const aSixth = await trustedRoute.POST(
      makeReq({
        path: '/api/auth/temp-pin/login',
        body: { pin: '9999' },
        headers: { 'x-forwarded-for': '10.0.0.1' },
      }),
    );
    assert.equal(aSixth.status, 429);
    // Fresh from B → 401, not 429
    const bFirst = await trustedRoute.POST(
      makeReq({
        path: '/api/auth/temp-pin/login',
        body: { pin: '9999' },
        headers: { 'x-forwarded-for': '10.0.0.2' },
      }),
    );
    assert.equal(bFirst.status, 401, 'IP B must not inherit IP A bucket');
  });
});
