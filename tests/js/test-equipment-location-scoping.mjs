#!/usr/bin/env node
// Equipment routes — location scoping via the canonical helpers.
//
// Found via the 2026-05-02 breaker audit (Section 3 P2 #1):
//   docs/agentic/findings/2026-05-02-equipment-routes-bypass-location-helpers.md
//
// Pre-fix the four equipment routes (route.ts, schedule, parts,
// maintenance) read searchParams.get('location_id') directly and
// missed the canonical `?location=` alias and whitespace trim.
// This file pins the contract that they now use lib/location.ts:
//
//   - body { location: 'south' } → row writes location_id='south'
//     (the canonical alias `location` is honored, not just `location_id`)
//   - GET ?location=south → reads scoped to 'south'
//   - missing location → DEFAULT_LOCATION_ID ('default')
//
// Run: node --experimental-strip-types --test tests/js/test-equipment-location-scoping.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-eq-loc-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const equipment = await import('../../app/api/equipment/route.ts');
const schedule = await import('../../app/api/equipment/schedule/route.ts');
const parts = await import('../../app/api/equipment/parts/route.ts');
const maintenance = await import('../../app/api/equipment/maintenance/route.ts');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM equipment;
    DELETE FROM equipment_maintenance_schedule;
    DELETE FROM equipment_parts;
    DELETE FROM equipment_maintenance;
  `);
});

function postReq(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(url) {
  return new Request(url, { method: 'GET' });
}

describe('equipment route — body alias `location` honored', () => {
  it('POST body { location: "south" } writes location_id="south"', async () => {
    const res = await equipment.POST(
      postReq('http://localhost/api/equipment', {
        name: 'Reach-in cooler #1',
        category: 'Refrigeration',
        location: 'south',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'south');
  });

  it('POST body { location_id: "north" } writes location_id="north"', async () => {
    const res = await equipment.POST(
      postReq('http://localhost/api/equipment', {
        name: 'Walk-in freezer',
        category: 'Refrigeration',
        location_id: 'north',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'north');
  });

  it('POST body with no location → DEFAULT_LOCATION_ID', async () => {
    const res = await equipment.POST(
      postReq('http://localhost/api/equipment', {
        name: 'Combi oven',
        category: 'Cooking',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'default');
  });

  it('whitespace in body location_id is trimmed', async () => {
    const res = await equipment.POST(
      postReq('http://localhost/api/equipment', {
        name: 'Prep table',
        category: 'Prep',
        location_id: '  south  ',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'south');
  });
});

describe('equipment route — GET ?location alias scopes correctly', () => {
  it('?location=south returns only south rows (canonical alias)', async () => {
    testDb
      .prepare(
        `INSERT INTO equipment (name, category, location_id, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .run('Reach-in', 'Refrigeration', 'south');
    testDb
      .prepare(
        `INSERT INTO equipment (name, category, location_id, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .run('Combi', 'Cooking', 'north');

    const res = await equipment.GET(
      getReq('http://localhost/api/equipment?location=south'),
    );
    const rows = await res.json();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].location_id, 'south');
    assert.strictEqual(rows[0].name, 'Reach-in');
  });

  it('?location_id=north returns only north rows', async () => {
    testDb
      .prepare(
        `INSERT INTO equipment (name, category, location_id, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .run('Reach-in', 'Refrigeration', 'south');
    testDb
      .prepare(
        `INSERT INTO equipment (name, category, location_id, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .run('Combi', 'Cooking', 'north');

    const res = await equipment.GET(
      getReq('http://localhost/api/equipment?location_id=north'),
    );
    const rows = await res.json();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].location_id, 'north');
  });
});

describe('equipment/schedule route — same contract', () => {
  it('POST body { location: "south" } writes location_id="south"', async () => {
    testDb
      .prepare(
        `INSERT INTO equipment (id, name, category, location_id, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .run(7, 'Combi', 'Cooking', 'south');

    const res = await schedule.POST(
      postReq('http://localhost/api/equipment/schedule', {
        equipment_id: 7,
        task: 'Replace filter',
        frequency: 'monthly',
        location: 'south',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment_maintenance_schedule ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'south');
  });
});

describe('equipment/parts route — same contract', () => {
  it('POST body { location: "south" } writes location_id="south"', async () => {
    testDb
      .prepare(
        `INSERT INTO equipment (id, name, category, location_id, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .run(7, 'Combi', 'Cooking', 'south');

    const res = await parts.POST(
      postReq('http://localhost/api/equipment/parts', {
        equipment_id: 7,
        part_number: 'OEM-12345',
        description: 'Door gasket',
        location: 'south',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment_parts ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'south');
  });
});

describe('equipment/maintenance route — same contract', () => {
  it('POST body { location: "south" } writes location_id="south"', async () => {
    testDb
      .prepare(
        `INSERT INTO equipment (id, name, category, location_id, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .run(7, 'Combi', 'Cooking', 'south');

    const res = await maintenance.POST(
      postReq('http://localhost/api/equipment/maintenance', {
        equipment_id: 7,
        service_date: '2026-05-02',
        type: 'Repair',
        cost: 250,
        location: 'south',
      }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT location_id FROM equipment_maintenance ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.location_id, 'south');
  });
});
