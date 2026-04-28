#!/usr/bin/env node
// Integration tests for /api/dining-tables (POST/GET) and
// /api/dining-tables/[id] (PATCH/DELETE).
//
// Covers:
//   - POST creates a row + audit ('insert')
//   - POST 400 on missing id
//   - POST 400 on missing name
//   - POST 400 on capacity = 0 or 51
//   - POST 400 on bad status
//   - POST 409 on duplicate (location_id, id)
//   - GET orders by id ASC
//   - GET location-scopes (kitchen-a row absent at kitchen-b)
//   - PATCH status (whitelist) — 200 on valid, 400 on bad
//   - PATCH plain field edit (rename) → audit fires
//   - PATCH 400 when nothing would change
//   - PATCH 404 when row in another location
//   - PATCH combined status + name in one call updates both
//   - DELETE removes row + delete audit
//   - DELETE 404 when already gone
//
// Run: node --test tests/js/test-dining-tables-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-dining-tables-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/dining-tables/route.js');
const idRoute = await import('../../app/api/dining-tables/[id]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM dining_tables;');
  testDb.exec(`DELETE FROM audit_events WHERE entity='dining_tables';`);
});

function postReq(body) {
  return new Request('http://localhost/api/dining-tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/dining-tables${qs}`);
}

function patchReq(id, body) {
  return idRoute.PATCH(
    new Request(`http://localhost/api/dining-tables/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(id) } },
  );
}

function delReq(id, qs = '') {
  return idRoute.DELETE(
    new Request(`http://localhost/api/dining-tables/${id}${qs}`, { method: 'DELETE' }),
    { params: { id: String(id) } },
  );
}

async function createTable(overrides = {}) {
  const body = {
    id: 'T1',
    name: 'Window 1',
    capacity: 4,
    cook_id: 'alice',
    ...overrides,
  };
  const res = await route.POST(postReq(body));
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const j = await res.json();
  assert.strictEqual(j.id, body.id);
  return body.id;
}

describe('POST /api/dining-tables', () => {
  it('creates a row + insert audit event', async () => {
    const id = await createTable({ id: 'T2', name: 'Patio 2', capacity: 6 });
    const row = testDb
      .prepare('SELECT * FROM dining_tables WHERE id=? AND location_id=?')
      .get(id, 'default');
    assert.ok(row);
    assert.strictEqual(row.id, 'T2');
    assert.strictEqual(row.name, 'Patio 2');
    assert.strictEqual(row.capacity, 6);
    assert.strictEqual(row.status, 'open');
    assert.strictEqual(row.x, 0);
    assert.strictEqual(row.y, 0);
    assert.strictEqual(row.w, 1);
    assert.strictEqual(row.h, 1);

    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='dining_tables' AND action='insert'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(a, 'expected insert audit event');
    assert.strictEqual(a.entity_id, 0);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.id, 'T2');
    assert.strictEqual(payload.name, 'Patio 2');
    assert.strictEqual(payload.capacity, 6);
    assert.strictEqual(payload.status, 'open');
  });

  it('respects custom x/y/w/h and status', async () => {
    await createTable({
      id: 'T9', name: 'Bar 9', x: 10, y: 5.5, w: 2, h: 3, status: 'closed',
    });
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get('T9');
    assert.strictEqual(row.x, 10);
    assert.strictEqual(row.y, 5.5);
    assert.strictEqual(row.w, 2);
    assert.strictEqual(row.h, 3);
    assert.strictEqual(row.status, 'closed');
  });

  it('400 when id is missing/empty/whitespace', async () => {
    const r1 = await route.POST(postReq({ name: 'X' }));
    assert.strictEqual(r1.status, 400);
    const j1 = await r1.json();
    assert.strictEqual(j1.error, 'id required');
    const r2 = await route.POST(postReq({ id: '   ', name: 'X' }));
    assert.strictEqual(r2.status, 400);
  });

  it('400 when name is missing/empty', async () => {
    const r1 = await route.POST(postReq({ id: 'T1' }));
    assert.strictEqual(r1.status, 400);
    const j1 = await r1.json();
    assert.strictEqual(j1.error, 'name required');
    const r2 = await route.POST(postReq({ id: 'T1', name: '   ' }));
    assert.strictEqual(r2.status, 400);
  });

  it('400 when capacity = 0 or 51', async () => {
    const r0 = await route.POST(postReq({ id: 'T1', name: 'X', capacity: 0 }));
    assert.strictEqual(r0.status, 400);
    const j0 = await r0.json();
    assert.strictEqual(j0.error, 'capacity must be 1..50');
    const r51 = await route.POST(postReq({ id: 'T1', name: 'X', capacity: 51 }));
    assert.strictEqual(r51.status, 400);
  });

  it('400 on bad status', async () => {
    const res = await route.POST(postReq({
      id: 'T1', name: 'X', status: 'on_fire',
    }));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.strictEqual(j.error, 'bad status');
  });

  it('409 on duplicate (location_id, id)', async () => {
    await createTable({ id: 'T1', name: 'first' });
    const dup = await route.POST(postReq({ id: 'T1', name: 'second' }));
    assert.strictEqual(dup.status, 409);
    const j = await dup.json();
    assert.strictEqual(j.error, 'id already in use');
    // Same id at a different location should be fine (composite PK).
    const otherLoc = await route.POST(postReq({
      id: 'T1', name: 'first elsewhere', location_id: 'kitchen-b',
    }));
    assert.strictEqual(otherLoc.status, 200);
  });
});

describe('GET /api/dining-tables', () => {
  it('orders by id ASC', async () => {
    await createTable({ id: 'T2', name: 'b' });
    await createTable({ id: 'T10', name: 'c' });
    await createTable({ id: 'T1', name: 'a' });
    const res = await route.GET(getReq());
    const j = await res.json();
    const ids = j.rows.map((r) => r.id);
    // Lexicographic ASC on TEXT column: T1, T10, T2
    assert.deepStrictEqual(ids, ['T1', 'T10', 'T2']);
  });

  it('scopes by location', async () => {
    await createTable({ id: 'T1', name: 'A', location_id: 'kitchen-a' });
    await createTable({ id: 'T1', name: 'B', location_id: 'kitchen-b' });
    const resA = await route.GET(getReq('?location=kitchen-a'));
    const jA = await resA.json();
    assert.strictEqual(jA.rows.length, 1);
    assert.strictEqual(jA.rows[0].name, 'A');
    const resB = await route.GET(getReq('?location=kitchen-b'));
    const jB = await resB.json();
    assert.strictEqual(jB.rows.length, 1);
    assert.strictEqual(jB.rows[0].name, 'B');
  });
});

describe('PATCH /api/dining-tables/:id', () => {
  it('status transition (open → seated) writes audit + from/to', async () => {
    const id = await createTable();
    const res = await patchReq(id, { status: 'seated', cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row.status, 'seated');

    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='dining_tables' AND action='update'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(a);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.id, id);
    assert.strictEqual(payload.from_status, 'open');
    assert.strictEqual(payload.to_status, 'seated');
  });

  it('400 on bad status', async () => {
    const id = await createTable();
    const res = await patchReq(id, { status: 'on_fire', cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.strictEqual(j.error, 'bad status');
    // Row is unchanged.
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row.status, 'open');
  });

  it('rename updates name + audit, status unchanged', async () => {
    const id = await createTable({ id: 'T1', name: 'old' });
    const res = await patchReq(id, { name: 'new name', cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row.name, 'new name');
    assert.strictEqual(row.status, 'open');
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='dining_tables' AND action='update'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(a);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.from_status, 'open');
    assert.strictEqual(payload.to_status, 'open');
  });

  it('400 when nothing would change', async () => {
    const id = await createTable();
    const res = await patchReq(id, { cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.strictEqual(j.error, 'no change');
  });

  it('404 when row in another location', async () => {
    const id = await createTable({ id: 'T1', location_id: 'kitchen-a' });
    const res = await patchReq(id, {
      status: 'seated',
      cook_id: 'alice',
      location_id: 'kitchen-b',
    });
    assert.strictEqual(res.status, 404);
  });

  it('combined status + name in one call updates both', async () => {
    const id = await createTable({ id: 'T1', name: 'old' });
    const res = await patchReq(id, {
      status: 'dirty',
      name: 'renamed',
      cook_id: 'alice',
    });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row.status, 'dirty');
    assert.strictEqual(row.name, 'renamed');
  });

  it('capacity update with valid value', async () => {
    const id = await createTable({ id: 'T1', capacity: 4 });
    const res = await patchReq(id, { capacity: 8, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row.capacity, 8);
  });

  it('400 on capacity out of range', async () => {
    const id = await createTable({ id: 'T1', capacity: 4 });
    const res = await patchReq(id, { capacity: 0, cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.strictEqual(j.error, 'capacity must be 1..50');
  });
});

describe('DELETE /api/dining-tables/:id', () => {
  it('removes the row and writes a delete audit event', async () => {
    const id = await createTable();
    const res = await delReq(id, '?cook_id=alice');
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM dining_tables WHERE id=?').get(id);
    assert.strictEqual(row, undefined);
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='dining_tables' AND action='delete'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(a);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.id, id);
  });

  it('404 when row already gone', async () => {
    const res = await delReq('NOPE');
    assert.strictEqual(res.status, 404);
  });

  it('404 when row exists at another location', async () => {
    await createTable({ id: 'T1', location_id: 'kitchen-a' });
    const res = await delReq('T1', '?location=kitchen-b');
    assert.strictEqual(res.status, 404);
    // Row at kitchen-a still present.
    const row = testDb
      .prepare('SELECT * FROM dining_tables WHERE id=? AND location_id=?')
      .get('T1', 'kitchen-a');
    assert.ok(row);
  });
});
