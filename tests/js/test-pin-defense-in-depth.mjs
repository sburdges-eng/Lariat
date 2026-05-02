#!/usr/bin/env node
// Defense-in-depth — every API route under SENSITIVE_PREFIXES must
// re-check the PIN cookie in-route, not rely solely on the middleware.
//
// Pre-fix, 10 routes were matcher-protected only (costing, analytics,
// menu-engineering, beo, audit/log, compute/status). One of those —
// /api/audit/log — also had a broken legacy cookie check (`value !== '1'`)
// that silently rejected the HMAC-signed cookie format introduced in
// lib/pinCookie.ts.
//
// Captured at:
//   docs/agentic/findings/2026-05-02-pin-gate-defense-in-depth-missing.md
//
// This test pins:
//   1. Every listed route returns 401 (or 403 for legacy audit/log) when
//      called without the cookie.
//   2. With a valid HMAC cookie, the route does NOT 401 — it gets to
//      run its real handler (status varies by handler).
//   3. With LARIAT_PIN unset, the gate is OFF (LAN-trust mode) — every
//      route returns non-401.
//
// Run: node --experimental-strip-types --test tests/js/test-pin-defense-in-depth.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-pin-did-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-32-bytes-of-entropy-x';

const db = await import('../../lib/db.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

db.setDbPathForTest(TMP_DB);
db.getDb();

// Lazy-imported so setDbPathForTest has run before any route module
// captures a handle.
const ROUTES = [
  { path: 'app/api/costing/route.js',                             method: 'GET' },
  { path: 'app/api/costing/depletion-exceptions/route.js',        method: 'GET' },
  { path: 'app/api/costing/pack-changes/route.js',                method: 'GET' },
  { path: 'app/api/costing/pack-changes/route.js',                method: 'POST' },
  { path: 'app/api/analytics/route.js',                           method: 'GET' },
  { path: 'app/api/menu-engineering/route.js',                    method: 'GET' },
  { path: 'app/api/menu-engineering/margin-deltas/route.js',      method: 'GET' },
  { path: 'app/api/beo/route.js',                                 method: 'GET' },
  { path: 'app/api/beo/route.js',                                 method: 'POST' },
  { path: 'app/api/beo/prep-history/route.js',                    method: 'GET' },
  { path: 'app/api/audit/log/route.js',                           method: 'GET' },
  { path: 'app/api/compute/status/route.js',                      method: 'GET' },
  { path: 'app/api/compute/status/route.js',                      method: 'POST' },
];

const handlers = {};
for (const r of ROUTES) {
  if (!handlers[r.path]) {
    handlers[r.path] = await import('../../' + r.path);
  }
}

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  // The schema's there from setDbPathForTest; nothing to clean per test
  // because handlers are read-only or write-then-rollback in the no-PIN
  // 401 path. But clear audit_events so audit/log doesn't pile up.
  try {
    db.getDb().exec('DELETE FROM audit_events');
  } catch { /* schema may not be fully present in some test orderings */ }
});

function makeReq(method, url, { cookie } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (method === 'POST') headers.set('content-type', 'application/json');
  return new Request(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify({ id: 1, action: 'event', title: 't' }) : undefined,
  });
}

function urlFor(p) {
  // Strip "app", drop "/route.js"
  return 'http://localhost' + p.replace(/^app/, '').replace(/\/route\.js$/, '');
}

async function callHandler(routePath, method, req) {
  const mod = handlers[routePath];
  const fn = mod[method];
  // Pass a stub `params` for any future dynamic-segment route added here.
  return fn(req, { params: {} });
}

describe('PIN gate defense-in-depth — every sensitive route 401s without cookie', () => {
  for (const { path: routePath, method } of ROUTES) {
    it(`${method} ${routePath} returns 401 without cookie`, async () => {
      const url = urlFor(routePath);
      const req = makeReq(method, url);
      const res = await callHandler(routePath, method, req);
      // audit/log used to return 403; the fix standardizes on 401
      // to match every other PIN-gated route. Accept either to allow
      // a transitional reviewer sweep.
      assert.ok(
        res.status === 401 || res.status === 403,
        `${method} ${routePath} returned ${res.status}; expected 401 (preferred) or 403`,
      );
    });
  }
});

describe('PIN gate defense-in-depth — valid HMAC cookie does NOT 401', () => {
  for (const { path: routePath, method } of ROUTES) {
    it(`${method} ${routePath} does not 401 with a valid PIN cookie`, async () => {
      const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
      const cookie = `lariat_pin_ok=${signed}`;
      const url = urlFor(routePath);
      const req = makeReq(method, url, { cookie });
      const res = await callHandler(routePath, method, req);
      // With cookie, route runs its real handler. We don't assert on
      // the success status (varies — some routes 200, some 400 because
      // the stub body is wrong shape, some 500 because tables are empty).
      // We assert ONLY that we're past the PIN gate.
      assert.notStrictEqual(
        res.status, 401,
        `${method} ${routePath} returned 401 with valid cookie — gate is rejecting legitimate users`,
      );
      assert.notStrictEqual(
        res.status, 403,
        `${method} ${routePath} returned 403 with valid cookie — likely a legacy 'value !== "1"' check that doesn't validate the HMAC`,
      );
    });
  }
});

describe('PIN gate defense-in-depth — LARIAT_PIN unset = LAN-trust mode = no gate', () => {
  it('every route returns non-401 when LARIAT_PIN is unset', async () => {
    const savedPin = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
    try {
      for (const { path: routePath, method } of ROUTES) {
        const url = urlFor(routePath);
        const req = makeReq(method, url);
        const res = await callHandler(routePath, method, req);
        assert.notStrictEqual(
          res.status, 401,
          `${method} ${routePath} 401d in LAN-trust mode (LARIAT_PIN unset)`,
        );
      }
    } finally {
      process.env.LARIAT_PIN = savedPin;
    }
  });
});
