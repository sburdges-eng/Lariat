#!/usr/bin/env node
// Integration tests for /api/auth/temp-pin/* (issue, list, revoke, login).
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-routes.mjs
//
// Uses the resolver to support .ts imports; in-memory SQLite via
// setDbPathForTest. PIN gate exercised via LARIAT_PIN env + the
// legacy unsigned `lariat_pin_ok=1` cookie (matches existing tests
// like test-event-ops-routes.mjs).

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
const listRoute = await import('../../app/api/auth/temp-pin/list/route.js');
const revokeRoute = await import('../../app/api/auth/temp-pin/revoke/route.js');
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

function makeReq({ method = 'GET', path = '/', body, withPin = true, idempotencyKey } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

const futureIso = (minutesAhead = 60) =>
  new Date(Date.now() + minutesAhead * 60_000).toISOString();
const pastIso = (minutesAgo = 60) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

// ── /issue ─────────────────────────────────────────────────────────

describe('POST /api/auth/temp-pin/issue', () => {
  it('returns 401 when master-PIN cookie is missing', async () => {
    const res = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'Sous chef Marco', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
        withPin: false,
      }),
    );
    assert.equal(res.status, 401);
  });

  it('mints a PIN, returns it ONCE, persists hash + audit row', async () => {
    const res = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'Sous chef Marco', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.id > 0);
    assert.match(json.pin, /^[0-9]{4}$/);
    assert.equal(json.label, 'Sous chef Marco');
    assert.deepEqual(json.scopes, ['beo.fire_at_edit']);
    // Hash stored, raw PIN never stored
    const row = conn.prepare(`SELECT pin_hash, label FROM temp_pins WHERE id = ?`).get(json.id);
    assert.ok(row);
    assert.notEqual(row.pin_hash, json.pin, 'pin_hash should not equal raw pin');
    assert.equal(row.label, 'Sous chef Marco');
    // Audit row written
    const audit = conn
      .prepare(`SELECT entity, action FROM audit_events WHERE entity = 'temp_pin' AND entity_id = ?`)
      .get(json.id);
    assert.deepEqual(audit, { entity: 'temp_pin', action: 'insert' });
  });

  it('rejects an unknown scope (422)', async () => {
    const res = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'X', expires_at: futureIso(), scopes: ['not.real'] },
      }),
    );
    assert.equal(res.status, 422);
  });

  it('rejects expires_at in the past (422)', async () => {
    const res = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'X', expires_at: pastIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    assert.equal(res.status, 422);
  });

  it('idempotent replay returns the same PIN, not a fresh one', async () => {
    const key = 'aaaaaaaaaaaaaaaa1';
    // expires_at is captured ONCE — request body must be byte-identical
    // for the idempotency wrapper's hash to match on replay.
    const fixed = futureIso();
    const body = { label: 'Once', expires_at: fixed, scopes: ['beo.fire_at_edit'] };
    const first = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body,
        idempotencyKey: key,
      }),
    );
    const second = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body,
        idempotencyKey: key,
      }),
    );
    const j1 = await first.json();
    const j2 = await second.json();
    assert.equal(j1.id, j2.id);
    assert.equal(j1.pin, j2.pin);
    // Only one row in temp_pins
    const count = conn.prepare(`SELECT COUNT(*) AS n FROM temp_pins`).get().n;
    assert.equal(count, 1);
  });
});

// ── /list ──────────────────────────────────────────────────────────

describe('GET /api/auth/temp-pin/list', () => {
  it('returns 401 without master PIN', async () => {
    const res = await listRoute.GET(
      makeReq({ method: 'GET', path: '/api/auth/temp-pin/list', withPin: false }),
    );
    assert.equal(res.status, 401);
  });

  it('lists active pins with metadata but never the hash', async () => {
    await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'Active', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    const res = await listRoute.GET(makeReq({ method: 'GET', path: '/api/auth/temp-pin/list' }));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.pins));
    assert.equal(json.pins.length, 1);
    const p = json.pins[0];
    assert.equal(p.label, 'Active');
    assert.deepEqual(p.scopes, ['beo.fire_at_edit']);
    assert.ok(p.expires_at);
    assert.equal(p.pin_hash, undefined, 'list response must NEVER include pin_hash');
    assert.equal(p.pin, undefined, 'list response must NEVER include raw pin');
  });

  it('omits revoked pins by default', async () => {
    const issueRes = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'WillRevoke', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    const { id } = await issueRes.json();
    await revokeRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/revoke', body: { id } }),
    );
    const res = await listRoute.GET(makeReq({ method: 'GET', path: '/api/auth/temp-pin/list' }));
    const json = await res.json();
    assert.equal(json.pins.length, 0);
  });

  it('omits expired pins', async () => {
    // Issue with past expires — but /issue rejects past expires. So
    // poke directly into the DB for this case.
    conn
      .prepare(
        `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
         VALUES ('default', 'deadbeef', 'Expired', '["beo.fire_at_edit"]', ?)`,
      )
      .run(pastIso());
    const res = await listRoute.GET(makeReq({ method: 'GET', path: '/api/auth/temp-pin/list' }));
    const json = await res.json();
    assert.equal(json.pins.length, 0);
  });
});

// ── /revoke ────────────────────────────────────────────────────────

describe('POST /api/auth/temp-pin/revoke', () => {
  it('returns 401 without master PIN', async () => {
    const res = await revokeRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/revoke', body: { id: 1 }, withPin: false }),
    );
    assert.equal(res.status, 401);
  });

  it('marks the row revoked and writes an audit event', async () => {
    const issueRes = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: { label: 'X', expires_at: futureIso(), scopes: ['beo.fire_at_edit'] },
      }),
    );
    const { id } = await issueRes.json();
    const res = await revokeRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/revoke', body: { id } }),
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT revoked_at FROM temp_pins WHERE id = ?`).get(id);
    assert.ok(row.revoked_at);
    const audit = conn
      .prepare(`SELECT action FROM audit_events WHERE entity='temp_pin' AND entity_id=? AND action='update'`)
      .get(id);
    assert.ok(audit, 'revoke should write an update audit row');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await revokeRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/revoke', body: { id: 99999 } }),
    );
    assert.equal(res.status, 404);
  });
});

// ── /login ─────────────────────────────────────────────────────────

describe('POST /api/auth/temp-pin/login', () => {
  async function issueOne(overrides = {}) {
    const res = await issueRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/auth/temp-pin/issue',
        body: {
          label: overrides.label ?? 'Login Test',
          expires_at: overrides.expires_at ?? futureIso(),
          scopes: overrides.scopes ?? ['beo.fire_at_edit'],
        },
      }),
    );
    return res.json();
  }

  it('exchanges a valid PIN for a temp_pin_ok cookie', async () => {
    const { pin } = await issueOne();
    const res = await loginRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/login', body: { pin }, withPin: false }),
    );
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /lariat_temp_pin_ok=/);
    const json = await res.json();
    assert.ok(json.id > 0);
    assert.deepEqual(json.scopes, ['beo.fire_at_edit']);
  });

  it('rejects an unknown PIN with 401 (no info leak)', async () => {
    const res = await loginRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/login', body: { pin: '0000' }, withPin: false }),
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.id, undefined);
    assert.equal(json.scopes, undefined);
  });

  it('rejects an expired PIN', async () => {
    // Insert directly so we can backdate the expires_at.
    conn
      .prepare(
        `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
         VALUES ('default', ?, 'Expired', '["beo.fire_at_edit"]', ?)`,
      )
      .run(
        // SHA-256('9999')
        '888df25ae35772424a560c7152a1de794440e0ea5cfee62828333a456a506e05',
        pastIso(),
      );
    const res = await loginRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/login', body: { pin: '9999' }, withPin: false }),
    );
    assert.equal(res.status, 401);
  });

  it('rejects a revoked PIN', async () => {
    const { pin, id } = await issueOne();
    await revokeRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/revoke', body: { id } }),
    );
    const res = await loginRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/login', body: { pin }, withPin: false }),
    );
    assert.equal(res.status, 401);
  });

  it('rejects a malformed PIN (3 digits) with 422', async () => {
    const res = await loginRoute.POST(
      makeReq({ method: 'POST', path: '/api/auth/temp-pin/login', body: { pin: '123' }, withPin: false }),
    );
    assert.equal(res.status, 422);
  });
});
