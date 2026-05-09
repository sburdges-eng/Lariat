#!/usr/bin/env node
// Pins the SameSite policy on the temp-PIN cookie issued by
// /api/auth/temp-pin/login. Mirrors the master-PIN cookie at
// app/api/auth/pin/route.js (SameSite=Strict).
//
// Background: docs/audit/2026-05-08-codebase-audit.md §1, security
// MEDIUM #3. The temp-PIN cookie shipped (PR #141) with SameSite=Lax;
// Lax permits top-level navigation POSTs from external origins, which
// — combined with no CSRF token on gated state-changing routes —
// means a manager who clicks an attacker link could trigger a gated
// mutation carrying their temp-PIN cookie. This test guards against
// silent regression back to Lax.
//
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-cookie-samesite.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const issueRoute = await import('../../app/api/auth/temp-pin/issue/route.js');
const loginRoute = await import('../../app/api/auth/temp-pin/login/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events;');
});

const PIN_COOKIE = 'lariat_pin_ok=1';

function makeReq({ method = 'GET', path = '/', body, withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

const futureIso = (minutesAhead = 60) =>
  new Date(Date.now() + minutesAhead * 60_000).toISOString();

async function issueAndLogin() {
  const issueRes = await issueRoute.POST(
    makeReq({
      method: 'POST',
      path: '/api/auth/temp-pin/issue',
      body: { label: 'SameSite Test', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
    }),
  );
  assert.equal(issueRes.status, 200, 'issue must succeed for the SameSite test setup');
  const { pin } = await issueRes.json();
  const loginRes = await loginRoute.POST(
    makeReq({
      method: 'POST',
      path: '/api/auth/temp-pin/login',
      body: { pin },
      withPin: false,
    }),
  );
  assert.equal(loginRes.status, 200, 'login must succeed for the SameSite test setup');
  return loginRes.headers.get('set-cookie') ?? '';
}

describe('temp-pin login cookie SameSite policy', () => {
  it('issues the temp-PIN cookie with SameSite=Strict (not Lax)', async () => {
    const setCookie = await issueAndLogin();
    assert.match(
      setCookie,
      /lariat_temp_pin_ok=/,
      'set-cookie should set the temp-PIN cookie',
    );
    assert.match(
      setCookie,
      /SameSite=Strict/,
      `temp-PIN cookie must use SameSite=Strict to mirror the master-PIN cookie; got: ${setCookie}`,
    );
    assert.doesNotMatch(
      setCookie,
      /SameSite=Lax/,
      `temp-PIN cookie must NOT use SameSite=Lax (audit 2026-05-08 §1 MEDIUM #3); got: ${setCookie}`,
    );
  });

  it('preserves HttpOnly, Path=/, and Max-Age attributes', async () => {
    const setCookie = await issueAndLogin();
    assert.match(setCookie, /HttpOnly/, 'cookie must remain HttpOnly');
    assert.match(setCookie, /Path=\//, 'cookie must keep Path=/');
    assert.match(setCookie, /Max-Age=\d+/, 'cookie must keep a Max-Age attribute');
    // 12-hour TTL = 43200s. Pin the exact value so a TTL change is a
    // deliberate, reviewed edit rather than a quiet drift.
    assert.match(
      setCookie,
      /Max-Age=43200/,
      `cookie Max-Age should be 12h (43200s); got: ${setCookie}`,
    );
  });
});
