#!/usr/bin/env node
// Contract test for temp-PIN scope adoption batch 2 (sick-worker, certifications,
// stage, specials/saved). Mirrors test-beo-pin-gate-fixes.mjs but smoke-only —
// the per-route mutation contracts are covered by the existing test files
// (test-sick-worker-api, test-specials-saved-api, etc). This file just proves
// the gate accepts the right scope and rejects the wrong one.
//
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-scopes-batch-2.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const tempPin = await import('../../lib/tempPin.ts');
const tempPinCookie = await import('../../lib/tempPinCookie.ts');
const sickWorkerRoute = await import('../../app/api/sick-worker/route.js');
const certsRoute = await import('../../app/api/certifications/route.js');
const stageRoute = await import('../../app/api/shows/[id]/stage/route.js');
const specialsListRoute = await import('../../app/api/specials/saved/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins;');
});

const futureIso = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();

async function tempPinCookieHeader(scopes) {
  const id = Number(
    conn.prepare(
      `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
       VALUES ('default', ?, ?, ?, ?)`,
    ).run(tempPin.hashPin('5678'), 'Test', tempPin.serializeScopes(scopes), futureIso()).lastInsertRowid,
  );
  const value = await tempPinCookie.signTempPinCookieValue(id, undefined);
  return `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}`;
}

function makeReq({ method = 'GET', path = '/', body, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

// ── pic.sick_worker ────────────────────────────────────────────────

describe('pic.sick_worker scope', () => {
  // GET is not gated (read of active reports is open). Gate fires on POST.
  it('POST /api/sick-worker accepts temp PIN scoped pic.sick_worker (passes gate)', async () => {
    const cookie = await tempPinCookieHeader(['pic.sick_worker']);
    const res = await sickWorkerRoute.POST(
      makeReq({ method: 'POST', path: '/api/sick-worker', body: {}, cookie }),
    );
    // Past gate → body validation rejects (400/422), NOT auth (401/403).
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  it('POST /api/sick-worker rejects temp PIN of wrong scope', async () => {
    const cookie = await tempPinCookieHeader(['pic.staff_certs']);
    const res = await sickWorkerRoute.POST(
      makeReq({ method: 'POST', path: '/api/sick-worker', body: {}, cookie }),
    );
    assert.equal(res.status, 403);
  });
});

// ── pic.staff_certs ────────────────────────────────────────────────

describe('pic.staff_certs scope', () => {
  // GET is not gated. Gate fires on POST/PATCH.
  it('POST /api/certifications accepts temp PIN scoped pic.staff_certs (passes gate)', async () => {
    const cookie = await tempPinCookieHeader(['pic.staff_certs']);
    const res = await certsRoute.POST(
      makeReq({ method: 'POST', path: '/api/certifications', body: {}, cookie }),
    );
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  it('POST /api/certifications rejects temp PIN of wrong scope', async () => {
    const cookie = await tempPinCookieHeader(['menu.specials_edit']);
    const res = await certsRoute.POST(
      makeReq({ method: 'POST', path: '/api/certifications', body: {}, cookie }),
    );
    assert.equal(res.status, 403);
  });
});

// ── event.stage_setup ──────────────────────────────────────────────

describe('event.stage_setup scope', () => {
  it('GET /api/shows/[id]/stage accepts temp PIN scoped event.stage_setup', async () => {
    const cookie = await tempPinCookieHeader(['event.stage_setup']);
    const res = await stageRoute.GET(
      makeReq({ method: 'GET', path: '/api/shows/1/stage', cookie }),
      { params: { id: '1' } },
    );
    assert.notEqual(res.status, 401);
  });

  it('GET /api/shows/[id]/stage rejects temp PIN of wrong scope', async () => {
    const cookie = await tempPinCookieHeader(['pic.sick_worker']);
    const res = await stageRoute.GET(
      makeReq({ method: 'GET', path: '/api/shows/1/stage', cookie }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 401);
  });
});

// ── menu.specials_edit ─────────────────────────────────────────────

describe('menu.specials_edit scope', () => {
  it('GET /api/specials/saved accepts temp PIN scoped menu.specials_edit', async () => {
    const cookie = await tempPinCookieHeader(['menu.specials_edit']);
    const res = await specialsListRoute.GET(
      makeReq({ method: 'GET', path: '/api/specials/saved', cookie }),
    );
    assert.notEqual(res.status, 401);
  });

  it('GET /api/specials/saved rejects temp PIN of wrong scope', async () => {
    const cookie = await tempPinCookieHeader(['event.box_office']);
    const res = await specialsListRoute.GET(
      makeReq({ method: 'GET', path: '/api/specials/saved', cookie }),
    );
    assert.equal(res.status, 401);
  });
});

// ── No-temp-PIN regression: master cookie still works ──────────────

describe('master PIN cookie still works (no regression)', () => {
  const MASTER = 'lariat_pin_ok=1';
  it('POST /api/sick-worker — master cookie passes the new gate', async () => {
    const res = await sickWorkerRoute.POST(
      makeReq({ method: 'POST', path: '/api/sick-worker', body: {}, cookie: MASTER }),
    );
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });
  it('POST /api/certifications — master cookie passes the new gate', async () => {
    const res = await certsRoute.POST(
      makeReq({ method: 'POST', path: '/api/certifications', body: {}, cookie: MASTER }),
    );
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });
});
