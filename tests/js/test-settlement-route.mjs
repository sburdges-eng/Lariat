#!/usr/bin/env node
// API route tests for /api/shows/[id]/deal and /api/shows/[id]/settlement.
//
// Run: node --experimental-strip-types --test tests/js/test-settlement-route.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

// PIN env must be set before importing pin.ts (it reads process.env at module init).
process.env.LARIAT_PIN = '1234';
process.env.LARIAT_PIN_SECRET = 'test-secret-do-not-use-in-prod';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM show_deals; DELETE FROM audit_events;`);
});

const dealRoute = await import('../../app/api/shows/[id]/deal/route.js');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

async function validCookie() {
  return signPinCookieValue('test-secret-do-not-use-in-prod');
}

function makeReq({ id, method, cookie, body }) {
  return new Request(`http://localhost/api/shows/${id}/deal`, {
    method,
    headers: cookie ? { cookie: `lariat_pin_ok=${cookie}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const validDeal = {
  guaranteeCents: 100000,
  vsPctAfterCosts: 0.85,
  costsOffTop: [{ label: 'Sound', cents: 5000 }],
  buyoutCents: 0,
};

describe('PUT /api/shows/[id]/deal — auth', () => {
  it('returns 401 with no cookie (curl-replay defense)', async () => {
    const req = makeReq({
      id: 1,
      method: 'PUT',
      body: { deal: validDeal },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 401);
  });
});

describe('PUT /api/shows/[id]/deal — validation', () => {
  it('rejects negative guarantee', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: { deal: { ...validDeal, guaranteeCents: -1 } },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 422);
  });

  it('rejects vsPctAfterCosts > 1', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: { deal: { ...validDeal, vsPctAfterCosts: 1.5 } },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 422);
  });

  it('accepts a valid deal and writes it', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: { deal: validDeal, cookId: 'cook-jane' },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const written = db.prepare(`SELECT * FROM show_deals`).all();
    assert.equal(written.length, 1);
    assert.equal(written[0].guarantee_cents, 100000);
  });
});

describe('GET /api/shows/[id]/deal', () => {
  it('returns null when no deal entered', async () => {
    const cookie = await validCookie();
    const req = makeReq({ id: 1, method: 'GET', cookie });
    const res = await dealRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deal, null);
  });
});
