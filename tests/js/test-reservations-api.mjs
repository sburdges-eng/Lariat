#!/usr/bin/env node
// Integration tests for /api/reservations (POST/GET) and
// /api/reservations/[id] (PATCH/DELETE).
//
// Covers:
//   - POST creates a row + audit ('insert')
//   - POST 400 on empty party_name
//   - POST 400 on party_size outside 1..50
//   - POST 400 on missing reservation_at
//   - GET filters by date (YYYY-MM-DD prefix on reservation_at)
//   - GET filters by status
//   - GET orders by reservation_at ASC, id ASC
//   - GET location-scopes (kitchen-a row absent at kitchen-b)
//   - PATCH { seat: true } → seated + seated_at + table_id update
//   - PATCH { complete: true } → completed + completed_at + audit row
//   - PATCH { cancel: true } → cancelled
//   - PATCH { no_show: true } → no_show
//   - PATCH plain field edit → audit fires, status unchanged
//   - PATCH 400 when nothing would change
//   - PATCH 404 when row in another location
//   - PATCH multiple verbs → 400 'multiple verbs'
//   - DELETE removes row + delete audit
//   - DELETE 404 when already gone
//
// Run: node --test tests/js/test-reservations-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-reservations-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/reservations/route.js');
const idRoute = await import('../../app/api/reservations/[id]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM reservations;');
  testDb.exec(`DELETE FROM audit_events WHERE entity='reservations';`);
});

function postReq(body) {
  return new Request('http://localhost/api/reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/reservations${qs}`);
}

function patchReq(id, body) {
  return idRoute.PATCH(
    new Request(`http://localhost/api/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(id) } },
  );
}

function delReq(id, qs = '') {
  return idRoute.DELETE(
    new Request(`http://localhost/api/reservations/${id}${qs}`, { method: 'DELETE' }),
    { params: { id: String(id) } },
  );
}

async function createRes(overrides = {}) {
  const body = {
    party_name: 'Smith',
    party_size: 4,
    reservation_at: '2026-04-25 18:30',
    cook_id: 'alice',
    ...overrides,
  };
  const res = await route.POST(postReq(body));
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const j = await res.json();
  assert.ok(j.id > 0);
  return j.id;
}

describe('POST /api/reservations', () => {
  it('creates a row + insert audit event', async () => {
    const id = await createRes({ party_name: 'Garcia', party_size: 6 });
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.ok(row);
    assert.strictEqual(row.party_name, 'Garcia');
    assert.strictEqual(row.party_size, 6);
    assert.strictEqual(row.status, 'booked');
    assert.strictEqual(row.source, 'manual');
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='reservations' AND entity_id=? AND action='insert'`,
      )
      .get(id);
    assert.ok(a, 'expected insert audit event');
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.party_name, 'Garcia');
    assert.strictEqual(payload.party_size, 6);
  });

  it('400 when party_name is empty/whitespace', async () => {
    const r1 = await route.POST(postReq({ party_name: '', party_size: 2, reservation_at: '2026-04-25 19:00' }));
    assert.strictEqual(r1.status, 400);
    const r2 = await route.POST(postReq({ party_name: '   ', party_size: 2, reservation_at: '2026-04-25 19:00' }));
    assert.strictEqual(r2.status, 400);
  });

  it('400 when party_size = 0 or 51', async () => {
    const r0 = await route.POST(postReq({ party_name: 'X', party_size: 0, reservation_at: '2026-04-25 19:00' }));
    assert.strictEqual(r0.status, 400);
    const r51 = await route.POST(postReq({ party_name: 'X', party_size: 51, reservation_at: '2026-04-25 19:00' }));
    assert.strictEqual(r51.status, 400);
  });

  it('400 when reservation_at missing', async () => {
    const res = await route.POST(postReq({ party_name: 'X', party_size: 2 }));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(j.error, /reservation_at/);
  });
});

describe('GET /api/reservations', () => {
  it('filters by date (prefix match on reservation_at)', async () => {
    await createRes({ party_name: 'A', reservation_at: '2026-04-24 18:00' });
    await createRes({ party_name: 'B', reservation_at: '2026-04-25 18:00' });
    await createRes({ party_name: 'C', reservation_at: '2026-04-25 20:30' });
    const res = await route.GET(getReq('?date=2026-04-25'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 2);
    const names = j.rows.map((r) => r.party_name);
    assert.deepStrictEqual(names, ['B', 'C']);
  });

  it('filters by status', async () => {
    const idA = await createRes({ party_name: 'A' });
    await createRes({ party_name: 'B' });
    await patchReq(idA, { cancel: true, cook_id: 'alice' });
    const res = await route.GET(getReq('?status=cancelled'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].party_name, 'A');
  });

  it('orders by reservation_at ASC, id ASC', async () => {
    const id1 = await createRes({ party_name: 'late', reservation_at: '2026-04-25 21:00' });
    const id2 = await createRes({ party_name: 'early-a', reservation_at: '2026-04-25 18:00' });
    const id3 = await createRes({ party_name: 'early-b', reservation_at: '2026-04-25 18:00' });
    const res = await route.GET(getReq('?date=2026-04-25'));
    const j = await res.json();
    const ids = j.rows.map((r) => r.id);
    assert.deepStrictEqual(ids, [id2, id3, id1]);
  });

  it('scopes by location', async () => {
    await createRes({ party_name: 'kA', location_id: 'kitchen-a' });
    await createRes({ party_name: 'kB', location_id: 'kitchen-b' });
    const resA = await route.GET(getReq('?location=kitchen-a'));
    const jA = await resA.json();
    assert.strictEqual(jA.rows.length, 1);
    assert.strictEqual(jA.rows[0].party_name, 'kA');
    const resB = await route.GET(getReq('?location=kitchen-b'));
    const jB = await resB.json();
    assert.strictEqual(jB.rows.length, 1);
    assert.strictEqual(jB.rows[0].party_name, 'kB');
  });
});

describe('PATCH /api/reservations/:id', () => {
  it('seat → status=seated, seated_at populated, table_id updated', async () => {
    const id = await createRes();
    const res = await patchReq(id, { seat: true, table_id: 'T7', cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.status, 'seated');
    assert.ok(row.seated_at, 'seated_at should be set');
    assert.strictEqual(row.table_id, 'T7');
  });

  it('complete → completed + completed_at + audit records from/to', async () => {
    const id = await createRes();
    await patchReq(id, { seat: true, cook_id: 'alice' });
    const res = await patchReq(id, { complete: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.status, 'completed');
    assert.ok(row.completed_at);
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='reservations' AND entity_id=? AND action='update'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(id);
    assert.ok(a);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.from_status, 'seated');
    assert.strictEqual(payload.to_status, 'completed');
    assert.strictEqual(payload.verb, 'complete');
  });

  it('cancel → status=cancelled', async () => {
    const id = await createRes();
    const res = await patchReq(id, { cancel: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.status, 'cancelled');
    assert.ok(row.completed_at);
  });

  it('no_show → status=no_show', async () => {
    const id = await createRes();
    const res = await patchReq(id, { no_show: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.status, 'no_show');
    assert.ok(row.completed_at);
  });

  it('plain field edit (party_size) → audit fires, status unchanged', async () => {
    const id = await createRes({ party_size: 4 });
    const res = await patchReq(id, { party_size: 6, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.party_size, 6);
    assert.strictEqual(row.status, 'booked');
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='reservations' AND entity_id=? AND action='update'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(id);
    assert.ok(a);
    const payload = JSON.parse(a.payload_json);
    assert.strictEqual(payload.from_status, 'booked');
    assert.strictEqual(payload.to_status, 'booked');
  });

  it('400 when no fields would change', async () => {
    const id = await createRes();
    const res = await patchReq(id, { cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
  });

  it('404 when row in another location', async () => {
    const id = await createRes({ location_id: 'kitchen-a' });
    const res = await patchReq(id, {
      complete: true,
      cook_id: 'alice',
      location_id: 'kitchen-b',
    });
    assert.strictEqual(res.status, 404);
  });

  it('multiple verbs → 400 multiple verbs', async () => {
    const id = await createRes();
    const res = await patchReq(id, { seat: true, complete: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.strictEqual(j.error, 'multiple verbs');
  });

  it('seat with side field edit (notes) coexists', async () => {
    const id = await createRes();
    const res = await patchReq(id, {
      seat: true,
      table_id: 'T3',
      notes: 'window seat',
      cook_id: 'alice',
    });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row.status, 'seated');
    assert.strictEqual(row.table_id, 'T3');
    assert.strictEqual(row.notes, 'window seat');
  });
});

describe('DELETE /api/reservations/:id', () => {
  it('removes the row and writes a delete audit event', async () => {
    const id = await createRes();
    const res = await delReq(id);
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    assert.strictEqual(row, undefined);
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='reservations' AND entity_id=? AND action='delete'`,
      )
      .get(id);
    assert.ok(a);
  });

  it('404 when row already gone', async () => {
    const res = await delReq(99999);
    assert.strictEqual(res.status, 404);
  });
});
