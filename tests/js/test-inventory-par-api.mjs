#!/usr/bin/env node
// Integration tests for /api/inventory/par.
//
// Covers:
//   - POST upsert: insert vs. update by UNIQUE(location_id, ingredient, sku)
//   - POST 400 when ingredient is missing
//   - GET list: location scoping + category filter + ordering
//   - DELETE: removes the row, writes audit, 404 across locations
//
// Run: node --test tests/js/test-inventory-par-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-inv-par-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const parRoute = await import('../../app/api/inventory/par/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM inventory_par;');
});

function postPar(body) {
  return parRoute.POST(new Request('http://localhost/api/inventory/par', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function getPar(qs = '') {
  return parRoute.GET(new Request(`http://localhost/api/inventory/par${qs}`));
}

function deletePar(id, body = {}) {
  return parRoute.DELETE(new Request(`http://localhost/api/inventory/par?id=${id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/inventory/par — upsert', () => {
  it('inserts a new row and records an audit insert', async () => {
    const res = await postPar({
      ingredient: 'TOMATO, ROMA',
      sku: 'TOM01',
      vendor: 'Shamrock',
      par_qty: 30,
      par_unit: 'lb',
      category: 'Produce',
      cook_id: 'alice',
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.isInsert, true);
    assert.ok(json.id > 0);

    const row = testDb.prepare('SELECT * FROM inventory_par WHERE id = ?').get(json.id);
    assert.strictEqual(row.ingredient, 'TOMATO, ROMA');
    assert.strictEqual(row.sku, 'TOM01');
    assert.strictEqual(row.par_qty, 30);
    assert.strictEqual(row.category, 'Produce');

    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'inventory_par' AND entity_id = ? AND action = 'insert'`,
      )
      .get(json.id);
    assert.ok(audit, 'expected audit row for insert');
  });

  it('upserts on (location, ingredient, sku) and records audit update', async () => {
    const r1 = await postPar({ ingredient: 'AVOCADO', sku: 'AVO', par_qty: 12, par_unit: 'ea' });
    const j1 = await r1.json();

    const r2 = await postPar({ ingredient: 'AVOCADO', sku: 'AVO', par_qty: 18, par_unit: 'ea' });
    const j2 = await r2.json();
    assert.strictEqual(j2.id, j1.id, 'should reuse the existing row');
    assert.strictEqual(j2.isInsert, false);

    const rows = testDb.prepare('SELECT * FROM inventory_par WHERE ingredient=?').all('AVOCADO');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].par_qty, 18);

    const updateAudit = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity = 'inventory_par' AND entity_id = ? AND action = 'update'`,
      )
      .get(j1.id).c;
    assert.strictEqual(updateAudit, 1);
  });

  it('treats null/empty sku as the same slot', async () => {
    const r1 = await postPar({ ingredient: 'PARSLEY', par_qty: 2, par_unit: 'bunch' });
    const j1 = await r1.json();
    const r2 = await postPar({ ingredient: 'PARSLEY', sku: '', par_qty: 4, par_unit: 'bunch' });
    const j2 = await r2.json();
    assert.strictEqual(j2.id, j1.id);
    const rows = testDb.prepare('SELECT * FROM inventory_par WHERE ingredient=?').all('PARSLEY');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].par_qty, 4);
  });

  it('400 when ingredient is missing', async () => {
    const r = await postPar({ par_qty: 1 });
    assert.strictEqual(r.status, 400);
  });
});

describe('GET /api/inventory/par', () => {
  it('scopes by location and orders by category/ingredient', async () => {
    await postPar({ ingredient: 'ZUCCHINI', category: 'Produce', par_qty: 6, location_id: 'kitchen-a' });
    await postPar({ ingredient: 'BUTTER', category: 'Dairy', par_qty: 4, location_id: 'kitchen-a' });
    await postPar({ ingredient: 'PORK CHOP', category: 'Protein', par_qty: 10, location_id: 'kitchen-b' });

    const a = await getPar('?location=kitchen-a');
    const aJson = await a.json();
    assert.strictEqual(aJson.rows.length, 2);
    assert.strictEqual(aJson.rows[0].category, 'Dairy');
    assert.strictEqual(aJson.rows[0].ingredient, 'BUTTER');
    assert.strictEqual(aJson.rows[1].ingredient, 'ZUCCHINI');

    const b = await getPar('?location=kitchen-b');
    const bJson = await b.json();
    assert.strictEqual(bJson.rows.length, 1);
    assert.strictEqual(bJson.rows[0].ingredient, 'PORK CHOP');
  });

  it('filters by category', async () => {
    await postPar({ ingredient: 'BUTTER', category: 'Dairy' });
    await postPar({ ingredient: 'CHEESE', category: 'Dairy' });
    await postPar({ ingredient: 'KALE', category: 'Produce' });

    const r = await getPar('?category=Dairy');
    const j = await r.json();
    assert.strictEqual(j.rows.length, 2);
    assert.ok(j.rows.every(row => row.category === 'Dairy'));
  });
});

describe('DELETE /api/inventory/par', () => {
  it('removes the row and writes an audit event', async () => {
    const r = await postPar({ ingredient: 'CILANTRO', par_qty: 3 });
    const { id } = await r.json();

    const del = await deletePar(id, { cook_id: 'bo' });
    assert.strictEqual(del.status, 200);

    const remaining = testDb.prepare('SELECT * FROM inventory_par WHERE id=?').get(id);
    assert.strictEqual(remaining, undefined);

    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'inventory_par' AND entity_id = ? AND action = 'delete'`,
      )
      .get(id);
    assert.ok(audit, 'expected audit row for delete');
  });

  it('404 when deleting from the wrong location', async () => {
    const r = await postPar({ ingredient: 'GINGER', par_qty: 1, location_id: 'kitchen-a' });
    const { id } = await r.json();

    const del = await deletePar(id, { location_id: 'kitchen-b' });
    assert.strictEqual(del.status, 404);

    const stillThere = testDb.prepare('SELECT id FROM inventory_par WHERE id=?').get(id);
    assert.ok(stillThere, 'row must remain — wrong location should not delete');
  });
});
