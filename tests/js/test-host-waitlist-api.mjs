#!/usr/bin/env node
// Integration tests for /api/host/waitlist (GET + POST) and
// /api/host/waitlist/[id] (PATCH).
// Run: node --experimental-strip-types --test tests/js/test-host-waitlist-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const listRoute = await import('../../app/api/host/waitlist/route.js');
const idRoute = await import('../../app/api/host/waitlist/[id]/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec(`DELETE FROM waitlist_parties;`);
});

const PIN_COOKIE = 'lariat_pin_ok=1';

function makeReq({ method = 'GET', path = '/api/host/waitlist', body, withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

// ── GET ─────────────────────────────────────────────────────────

describe('GET /api/host/waitlist', () => {
  it('returns 401 without PIN', async () => {
    const res = await listRoute.GET(makeReq({ withPin: false }));
    assert.equal(res.status, 401);
  });

  it('returns empty parties + zeroed summary when no rows', async () => {
    const res = await listRoute.GET(makeReq({}));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.parties, []);
    assert.equal(j.summary.waiting, 0);
  });
});

// ── POST ────────────────────────────────────────────────────────

describe('POST /api/host/waitlist', () => {
  it('returns 401 without PIN', async () => {
    const res = await listRoute.POST(
      makeReq({ method: 'POST', body: { party_name: 'X', party_size: 2 }, withPin: false }),
    );
    assert.equal(res.status, 401);
  });

  it('returns 400 on missing party_name', async () => {
    const res = await listRoute.POST(
      makeReq({ method: 'POST', body: { party_size: 2 } }),
    );
    assert.equal(res.status, 400);
  });

  it('returns 400 on non-positive party_size', async () => {
    const res = await listRoute.POST(
      makeReq({ method: 'POST', body: { party_name: 'X', party_size: 0 } }),
    );
    assert.equal(res.status, 400);
  });

  it('inserts party and returns 201 with row', async () => {
    const res = await listRoute.POST(
      makeReq({
        method: 'POST',
        body: { party_name: 'Hendricks', party_size: 4, phone: '555-1212' },
      }),
    );
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.party.party_name, 'Hendricks');
    assert.equal(j.party.party_size, 4);
    assert.equal(j.party.phone, '555-1212');
    assert.equal(j.party.status, 'waiting');
    assert.ok(j.party.id > 0);
    assert.ok(j.party.joined_at);
  });

  it('honors location_id from body', async () => {
    await listRoute.POST(
      makeReq({
        method: 'POST',
        body: { party_name: 'Other Loc', party_size: 2, location_id: 'other' },
      }),
    );
    const otherCount = conn
      .prepare(`SELECT COUNT(*) AS c FROM waitlist_parties WHERE location_id = 'other'`)
      .get().c;
    assert.equal(otherCount, 1);
  });
});

// ── PATCH ───────────────────────────────────────────────────────

async function addParty({ name = 'Test', size = 2 } = {}) {
  const res = await listRoute.POST(
    makeReq({ method: 'POST', body: { party_name: name, party_size: size } }),
  );
  const j = await res.json();
  return j.party.id;
}

describe('PATCH /api/host/waitlist/[id]', () => {
  it('returns 401 without PIN', async () => {
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: '/api/host/waitlist/1', body: { status: 'seated' }, withPin: false }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 401);
  });

  it('returns 404 on unknown id', async () => {
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: '/api/host/waitlist/9999', body: { status: 'seated' } }),
      { params: { id: '9999' } },
    );
    assert.equal(res.status, 404);
  });

  it('returns 400 on bad/missing status', async () => {
    const id = await addParty();
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: `/api/host/waitlist/${id}`, body: { status: 'arrived' } }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 400);
  });

  it('transitions waiting → seated and stamps seated_at', async () => {
    const id = await addParty({ name: 'Big Party', size: 6 });
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: `/api/host/waitlist/${id}`, body: { status: 'seated' } }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.party.status, 'seated');
    assert.ok(j.party.seated_at);
  });

  it('transitions waiting → left and stamps left_at', async () => {
    const id = await addParty();
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: `/api/host/waitlist/${id}`, body: { status: 'left' } }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.party.status, 'left');
    assert.ok(j.party.left_at);
  });

  it('returns 409 when re-transitioning a seated party', async () => {
    const id = await addParty();
    await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: `/api/host/waitlist/${id}`, body: { status: 'seated' } }),
      { params: { id: String(id) } },
    );
    const res = await idRoute.PATCH(
      makeReq({ method: 'PATCH', path: `/api/host/waitlist/${id}`, body: { status: 'left' } }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 409);
  });
});
