#!/usr/bin/env node
// Manager PIN users: local editable manager auth beside the env override.
//
// Run: node --experimental-strip-types --test tests/js/test-manager-pins.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;

process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const conn = db.getDb();

const managerPins = await import('../../lib/managerPins.ts');
const pinRoute = await import('../../app/api/auth/pin/route.ts');
const managerPinRoute = await import('../../app/api/auth/manager-pins/route.js');

const MASTER_COOKIE = 'lariat_pin_ok=1';

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  process.env.LARIAT_PIN = '4242';
  delete process.env.LARIAT_PIN_SECRET;
  conn.exec('DELETE FROM manager_pin_users; DELETE FROM audit_events;');
});

function jsonReq(path, body, { method = 'POST', cookie = MASTER_COOKIE } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('manager PIN schema and helpers', { concurrency: false }, () => {
  it('creates the manager_pin_users table with hash-only storage columns', () => {
    const cols = conn.prepare(`PRAGMA table_info(manager_pin_users)`).all().map((r) => r.name);
    assert.deepEqual(cols, [
      'id',
      'location_id',
      'name',
      'pin_hash',
      'role',
      'is_active',
      'created_at',
      'updated_at',
      'disabled_at',
    ]);
  });

  it('creates active manager PIN users without storing the raw PIN', () => {
    const created = managerPins.createManagerPinUser({
      name: 'Sean',
      pin: '1357',
      role: 'owner',
      locationId: 'default',
    });

    assert.ok(created.id > 0);
    assert.equal(created.name, 'Sean');
    assert.equal(created.role, 'owner');
    assert.equal(created.is_active, true);
    assert.equal(created.pin, undefined);
    assert.equal(created.pin_hash, undefined);

    const row = conn
      .prepare(`SELECT pin_hash, name, role, is_active FROM manager_pin_users WHERE id = ?`)
      .get(created.id);
    assert.notEqual(row.pin_hash, '1357');
    assert.equal(row.name, 'Sean');
    assert.equal(row.role, 'owner');
    assert.equal(row.is_active, 1);

    const match = managerPins.findActiveManagerByPin('1357', 'default');
    assert.equal(match.id, created.id);
    assert.equal(match.pin_hash, undefined);
  });

  it('updates names and PINs, and disabled users no longer authenticate', () => {
    const created = managerPins.createManagerPinUser({
      name: 'Opener',
      pin: '2468',
      role: 'manager',
      locationId: 'default',
    });

    const updated = managerPins.updateManagerPinUser({
      id: created.id,
      name: 'Closing Manager',
      pin: '9753',
      role: 'owner',
      isActive: true,
      locationId: 'default',
    });
    assert.equal(updated.name, 'Closing Manager');
    assert.equal(updated.role, 'owner');
    assert.equal(managerPins.findActiveManagerByPin('2468', 'default'), null);
    assert.equal(managerPins.findActiveManagerByPin('9753', 'default').id, created.id);

    const disabled = managerPins.disableManagerPinUser(created.id, 'default');
    assert.equal(disabled.is_active, false);
    assert.equal(managerPins.findActiveManagerByPin('9753', 'default'), null);
  });
});

describe('POST /api/auth/pin accepts override and manager users', { concurrency: false }, () => {
  it('keeps LARIAT_PIN as the override path', async () => {
    const res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: '4242' }, { cookie: null }));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /lariat_pin_ok=/);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, source: 'override' });
  });

  it('accepts an active manager user PIN beside the override', async () => {
    const created = managerPins.createManagerPinUser({
      name: 'Sous',
      pin: '1357',
      role: 'manager',
      locationId: 'default',
    });

    const res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: '1357' }, { cookie: null }));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /lariat_pin_ok=/);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      source: 'manager_user',
      user: { id: created.id, name: 'Sous', role: 'manager' },
    });
  });

  it('rejects disabled manager users and stays fail-closed when no auth is configured', async () => {
    const created = managerPins.createManagerPinUser({
      name: 'Disabled',
      pin: '8080',
      role: 'manager',
      locationId: 'default',
    });
    managerPins.disableManagerPinUser(created.id, 'default');

    let res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: '8080' }, { cookie: null }));
    assert.equal(res.status, 401);

    delete process.env.LARIAT_PIN;
    conn.exec('DELETE FROM manager_pin_users;');
    res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: '8080' }, { cookie: null }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'PIN setup required' });
  });

  it('reports pin_enabled when either the override or an active manager user exists', async () => {
    let res = await pinRoute.GET();
    let body = await res.json();
    assert.equal(body.pin_enabled, true);
    assert.equal(body.pin_override, true);

    delete process.env.LARIAT_PIN;
    managerPins.createManagerPinUser({
      name: 'Only User',
      pin: '9090',
      role: 'owner',
      locationId: 'default',
    });

    res = await pinRoute.GET();
    body = await res.json();
    assert.equal(body.pin_enabled, true);
    assert.equal(body.pin_override, false);
    assert.equal(body.manager_pin_users, 1);

    conn.exec('DELETE FROM manager_pin_users;');
    res = await pinRoute.GET();
    body = await res.json();
    assert.equal(body.pin_enabled, false);
    assert.equal(body.manager_pin_users, 0);
  });
});

describe('/api/auth/manager-pins management API', { concurrency: false }, () => {
  it('requires the master PIN cookie', async () => {
    const res = await managerPinRoute.GET(
      jsonReq('/api/auth/manager-pins', undefined, { method: 'GET', cookie: null }),
    );
    assert.equal(res.status, 401);
  });

  it('creates, lists, updates, and disables manager PIN users without returning hashes', async () => {
    let res = await managerPinRoute.POST(
      jsonReq('/api/auth/manager-pins', {
        name: 'Lunch Manager',
        pin: '1111',
        role: 'manager',
      }),
    );
    assert.equal(res.status, 200);
    const created = await res.json();
    assert.equal(created.user.name, 'Lunch Manager');
    assert.equal(created.user.pin, undefined);
    assert.equal(created.user.pin_hash, undefined);

    res = await managerPinRoute.GET(jsonReq('/api/auth/manager-pins', undefined, { method: 'GET' }));
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].name, 'Lunch Manager');
    assert.equal(body.users[0].pin_hash, undefined);

    res = await managerPinRoute.PATCH(
      jsonReq('/api/auth/manager-pins', {
        id: created.user.id,
        name: 'Dinner Manager',
        pin: '2222',
        role: 'owner',
        is_active: true,
      }, { method: 'PATCH' }),
    );
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.user.name, 'Dinner Manager');
    assert.equal(body.user.role, 'owner');
    assert.equal(managerPins.findActiveManagerByPin('1111', 'default'), null);
    assert.equal(managerPins.findActiveManagerByPin('2222', 'default').id, created.user.id);

    res = await managerPinRoute.DELETE(
      jsonReq('/api/auth/manager-pins', { id: created.user.id }, { method: 'DELETE' }),
    );
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.user.is_active, false);
    assert.equal(managerPins.findActiveManagerByPin('2222', 'default'), null);
  });
});
