#!/usr/bin/env node
// Integration tests for the first-run setup flow (roadmap 3.4):
//   - lib/setupStatus.ts step detection (empty install → incomplete,
//     seeded data → complete, location-scoped where applicable)
//   - GET /api/setup/status JSON contract + no-store
//   - POST /api/locations seed/rename, validation, audit, idempotent replay
//
// Run: node --experimental-strip-types --test tests/js/test-setup-flow.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-setup-flow-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const TMP_CACHE = path.join(TMP_DIR, 'cache');
fs.mkdirSync(TMP_CACHE, { recursive: true });

const dbMod = await import('../../lib/db.ts');
const dataMod = await import('../../lib/data.ts');
const managerPinsMod = await import('../../lib/managerPins.ts');
const setupMod = await import('../../lib/setupStatus.ts');
const statusRoute = await import('../../app/api/setup/status/route.js');
const locationsRoute = await import('../../app/api/locations/route.js');

dbMod.setDbPathForTest(TMP_DB);
dataMod.setCacheRootForTest(TMP_CACHE);
const db = dbMod.getDb();

const SAVED_PIN = process.env.LARIAT_PIN;

after(() => {
  dbMod.setDbPathForTest(null);
  dataMod.setCacheRootForTest(null);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeRecipesCache(recipes) {
  fs.writeFileSync(path.join(TMP_CACHE, 'recipes.json'), JSON.stringify(recipes));
  // load() memoizes per file — flush by re-pointing the same root.
  dataMod.setCacheRootForTest(TMP_CACHE);
}

beforeEach(() => {
  delete process.env.LARIAT_PIN;
  for (const t of ['vendor_prices', 'toast_sales_daily', 'audit_events', 'idempotency_keys', 'manager_pin_users', 'locations']) {
    db.exec(`DELETE FROM ${t};`);
  }
  // Restore the automatic seed row written by lib/db.ts on a fresh DB.
  db.prepare(`INSERT INTO locations (id, name) VALUES ('default', 'The Lariat')`).run();
  writeRecipesCache([]);
});

function statusFor(loc = 'default') {
  return setupMod.getSetupStatus(loc);
}

function stepById(status, id) {
  const step = status.steps.find((s) => s.id === id);
  assert.ok(step, `missing step ${id}`);
  return step;
}

describe('getSetupStatus() — empty install', () => {
  it('reports every required step incomplete on a fresh DB with no PIN', () => {
    const status = statusFor();
    assert.equal(status.location_id, 'default');
    assert.equal(status.ready, false);
    for (const id of ['pin', 'location', 'vendor_prices', 'recipes']) {
      const step = stepById(status, id);
      assert.equal(step.complete, false, `${id} should be incomplete`);
      assert.equal(step.optional, false, `${id} should be required`);
    }
    const toast = stepById(status, 'toast');
    assert.equal(toast.complete, false);
    assert.equal(toast.optional, true);
    assert.equal(toast.detail.requires_credentials, true);
  });
});

describe('getSetupStatus() — per-step detection', () => {
  it('pin flips complete when LARIAT_PIN is set', () => {
    assert.equal(stepById(statusFor(), 'pin').complete, false);
    process.env.LARIAT_PIN = '4242';
    assert.equal(stepById(statusFor(), 'pin').complete, true);
    process.env.LARIAT_PIN = '   ';
    assert.equal(stepById(statusFor(), 'pin').complete, false, 'whitespace PIN is not configured');
  });

  it('pin flips complete when an active manager PIN user exists in the DB', () => {
    assert.equal(stepById(statusFor(), 'pin').complete, false);
    managerPinsMod.createManagerPinUser({ name: 'Chef Alex', pin: '4242' });
    assert.equal(stepById(statusFor(), 'pin').complete, true);
  });

  it('location is incomplete with only the auto-seeded default row', () => {
    assert.equal(stepById(statusFor(), 'location').complete, false);
  });

  it('location flips complete when the default row is renamed', () => {
    db.prepare(`UPDATE locations SET name = 'Cool River' WHERE id = 'default'`).run();
    const step = stepById(statusFor(), 'location');
    assert.equal(step.complete, true);
    assert.equal(step.detail.venue_name, 'Cool River');
    assert.equal(step.detail.venue_id, 'default');
  });

  it('location flips complete when a non-default location exists', () => {
    db.prepare(`INSERT INTO locations (id, name) VALUES ('uptown', 'Uptown Kitchen')`).run();
    const step = stepById(statusFor(), 'location');
    assert.equal(step.complete, true);
    assert.equal(step.detail.venue_id, 'uptown');
  });

  it('vendor_prices flips complete when rows exist for the location', () => {
    assert.equal(stepById(statusFor(), 'vendor_prices').complete, false);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, unit_price, location_id)
       VALUES ('Avocado', 'sysco', 1.25, 'default')`,
    ).run();
    const step = stepById(statusFor(), 'vendor_prices');
    assert.equal(step.complete, true);
    assert.equal(step.detail.count, 1);
  });

  it('vendor_prices is location-scoped — rows at another location do not count', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, unit_price, location_id)
       VALUES ('Avocado', 'sysco', 1.25, 'uptown')`,
    ).run();
    assert.equal(stepById(statusFor('default'), 'vendor_prices').complete, false);
    assert.equal(stepById(statusFor('uptown'), 'vendor_prices').complete, true);
  });

  it('recipes flips complete when the data cache has recipes', () => {
    assert.equal(stepById(statusFor(), 'recipes').complete, false);
    writeRecipesCache([{ slug: 'demi-glace', name: 'Demi-Glace' }]);
    const step = stepById(statusFor(), 'recipes');
    assert.equal(step.complete, true);
    assert.equal(step.detail.count, 1);
  });

  it('toast flips complete when toast_sales_daily has rows for the location', () => {
    db.prepare(
      `INSERT INTO toast_sales_daily (shift_date, net_sales, comparison_group, location_id)
       VALUES ('2026-06-01', 5000, 1, 'default')`,
    ).run();
    assert.equal(stepById(statusFor(), 'toast').complete, true);
    assert.equal(stepById(statusFor('uptown'), 'toast').complete, false);
  });

  it('ready requires all non-optional steps but not toast', () => {
    process.env.LARIAT_PIN = '4242';
    db.prepare(`UPDATE locations SET name = 'Cool River' WHERE id = 'default'`).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, unit_price, location_id)
       VALUES ('Lime', 0.4, 'default')`,
    ).run();
    writeRecipesCache([{ slug: 'pico', name: 'Pico de Gallo' }]);

    const status = statusFor();
    assert.equal(stepById(status, 'toast').complete, false);
    assert.equal(status.ready, true, 'optional toast must not block readiness');
  });
});

describe('GET /api/setup/status', () => {
  it('returns the status contract with no-store caching', async () => {
    process.env.LARIAT_PIN = '4242';
    const res = await statusRoute.GET(new Request('http://localhost/api/setup/status'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.location_id, 'default');
    assert.equal(typeof body.ready, 'boolean');
    assert.equal(Array.isArray(body.steps), true);
    assert.deepEqual(
      body.steps.map((s) => s.id),
      ['pin', 'location', 'vendor_prices', 'recipes', 'toast'],
    );
    assert.equal(body.steps.find((s) => s.id === 'pin').complete, true);
  });

  it('honors ?location= scoping', async () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, unit_price, location_id)
       VALUES ('Lime', 0.4, 'uptown')`,
    ).run();
    const res = await statusRoute.GET(
      new Request('http://localhost/api/setup/status?location=uptown'),
    );
    const body = await res.json();
    assert.equal(body.location_id, 'uptown');
    assert.equal(body.steps.find((s) => s.id === 'vendor_prices').complete, true);
  });
});

function postLocations(body, headers = {}) {
  return locationsRoute.POST(
    new Request('http://localhost/api/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/locations', () => {
  it('requires the manager PIN once the PIN gate is configured', async () => {
    managerPinsMod.createManagerPinUser({ name: 'Chef Alex', pin: '4242' });
    const res = await postLocations({ name: 'Cool River' });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'PIN required');
  });

  it('renames the default venue and posts an update audit row', async () => {
    const res = await postLocations({ name: 'Cool River' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, id: 'default', name: 'Cool River', created: false });

    const row = db.prepare(`SELECT name FROM locations WHERE id = 'default'`).get();
    assert.equal(row.name, 'Cool River');

    const audits = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'locations'`)
      .all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'update');
    assert.equal(audits[0].location_id, 'default');
    const payload = JSON.parse(audits[0].payload_json);
    assert.equal(payload.name, 'Cool River');
    assert.equal(payload.previous_name, 'The Lariat');
  });

  it('creates a new location when an explicit id is given', async () => {
    const res = await postLocations({ id: 'uptown', name: 'Uptown Kitchen' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, id: 'uptown', name: 'Uptown Kitchen', created: true });

    const audits = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'locations'`)
      .all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'insert');
    assert.equal(audits[0].location_id, 'uptown');
  });

  it('rejects a missing name', async () => {
    const res = await postLocations({ name: '   ' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /name required/);
  });

  it('rejects a malformed id', async () => {
    const res = await postLocations({ id: 'Not A Slug!', name: 'Venue' });
    assert.equal(res.status, 400);
  });

  it('rejects a non-JSON body', async () => {
    const res = await locationsRoute.POST(
      new Request('http://localhost/api/locations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    assert.equal(res.status, 400);
  });

  it('replays idempotently — same key returns the cached response, one audit row', async () => {
    const key = 'setup-flow-idem-key-0001';
    const first = await postLocations({ name: 'Cool River' }, { 'idempotency-key': key });
    assert.equal(first.status, 200);
    const firstBody = await first.json();

    const replay = await postLocations({ name: 'Cool River' }, { 'idempotency-key': key });
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.deepEqual(replayBody, firstBody);

    const audits = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'locations'`)
      .get();
    assert.equal(audits.c, 1, 'replay must not write a second audit row');
  });

  it('completes the location setup step after the POST', async () => {
    assert.equal(stepById(statusFor(), 'location').complete, false);
    await postLocations({ name: 'Cool River' });
    const step = stepById(statusFor(), 'location');
    assert.equal(step.complete, true);
    assert.equal(step.detail.venue_name, 'Cool River');
  });
});
