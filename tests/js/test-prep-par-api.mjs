#!/usr/bin/env node
// Integration tests for /api/prep-par.
//
// Covers:
//   - POST upsert: insert vs. update by UNIQUE(location_id, station_id, recipe_slug, ingredient)
//   - POST 400 when both recipe_slug and ingredient are empty
//   - POST ingredient-target row (ingredient set, recipe_slug '')
//   - GET list: location scoping + station_id filter + ordering
//   - DELETE: removes the row, writes audit, 404 across locations
//
// Run: node --test tests/js/test-prep-par-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-prep-par-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const prepParRoute = await import('../../app/api/prep-par/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM prep_par;');
});

function postPar(body) {
  return prepParRoute.POST(new Request('http://localhost/api/prep-par', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function getPar(qs = '') {
  return prepParRoute.GET(new Request(`http://localhost/api/prep-par${qs}`));
}

function deletePar(id, body = {}) {
  return prepParRoute.DELETE(new Request(`http://localhost/api/prep-par?id=${id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/prep-par — upsert recipe-target', () => {
  it('inserts a recipe-target row and returns {ok,id,isInsert:true}', async () => {
    const res = await postPar({
      station_id: 'grill',
      recipe_slug: 'ribeye-8oz',
      target_qty: 12,
      unit: 'portions',
      sort_order: 1,
      cook_id: 'alice',
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.isInsert, true);
    assert.ok(json.id > 0);

    const row = testDb.prepare('SELECT * FROM prep_par WHERE id = ?').get(json.id);
    assert.strictEqual(row.station_id, 'grill');
    assert.strictEqual(row.recipe_slug, 'ribeye-8oz');
    assert.strictEqual(row.ingredient, '');
    assert.strictEqual(row.target_qty, 12);
    assert.strictEqual(row.unit, 'portions');

    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'prep_par' AND entity_id = ? AND action = 'insert'`,
      )
      .get(json.id);
    assert.ok(audit, 'expected audit row for insert');
  });

  it('upserts on (location, station, recipe_slug, ingredient) and records audit update', async () => {
    const r1 = await postPar({
      station_id: 'saute',
      recipe_slug: 'chicken-breast',
      target_qty: 10,
      unit: 'portions',
    });
    const j1 = await r1.json();
    assert.strictEqual(j1.isInsert, true);

    const r2 = await postPar({
      station_id: 'saute',
      recipe_slug: 'chicken-breast',
      target_qty: 20,
      unit: 'portions',
    });
    const j2 = await r2.json();
    assert.strictEqual(j2.id, j1.id, 'should reuse existing row');
    assert.strictEqual(j2.isInsert, false);

    const rows = testDb.prepare('SELECT * FROM prep_par WHERE recipe_slug=?').all('chicken-breast');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].target_qty, 20);

    const updateAudit = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity = 'prep_par' AND entity_id = ? AND action = 'update'`,
      )
      .get(j1.id).c;
    assert.strictEqual(updateAudit, 1);
  });

  it('400 when both recipe_slug and ingredient are empty', async () => {
    const r = await postPar({ station_id: 'fryer', target_qty: 5 });
    assert.strictEqual(r.status, 400);
    const json = await r.json();
    assert.ok(json.error, 'should have error message');
  });

  it('inserts an ingredient-target row (ingredient set, recipe_slug empty)', async () => {
    const res = await postPar({
      station_id: 'cold',
      ingredient: 'roma tomatoes',
      target_qty: 20,
      unit: 'lbs',
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.isInsert, true);

    const row = testDb.prepare('SELECT * FROM prep_par WHERE id = ?').get(json.id);
    assert.strictEqual(row.ingredient, 'roma tomatoes');
    assert.strictEqual(row.recipe_slug, '');
    assert.strictEqual(row.target_qty, 20);
  });
});

describe('GET /api/prep-par', () => {
  it('returns rows scoped to the requested location', async () => {
    await postPar({ recipe_slug: 'salad', target_qty: 5, location_id: 'kitchen-a' });
    await postPar({ recipe_slug: 'soup', target_qty: 3, location_id: 'kitchen-b' });

    const a = await getPar('?location=kitchen-a');
    const aJson = await a.json();
    assert.strictEqual(aJson.rows.length, 1);
    assert.strictEqual(aJson.rows[0].recipe_slug, 'salad');
  });

  it('does NOT return another location\'s rows', async () => {
    await postPar({ recipe_slug: 'private-dish', target_qty: 8, location_id: 'kitchen-a' });

    const b = await getPar('?location=kitchen-b');
    const bJson = await b.json();
    assert.strictEqual(bJson.rows.length, 0, 'kitchen-b should not see kitchen-a rows');
  });

  it('filters by station_id', async () => {
    await postPar({ station_id: 'grill', recipe_slug: 'steak', target_qty: 10 });
    await postPar({ station_id: 'fryer', recipe_slug: 'fries', target_qty: 20 });
    await postPar({ station_id: 'grill', ingredient: 'salt', target_qty: 5 });

    const r = await getPar('?station_id=grill');
    const j = await r.json();
    assert.strictEqual(j.rows.length, 2);
    assert.ok(j.rows.every(row => row.station_id === 'grill'));
  });

  it('orders by station_id, sort_order, recipe_slug, ingredient', async () => {
    await postPar({ station_id: 'saute', recipe_slug: 'pasta', sort_order: 2, target_qty: 5 });
    await postPar({ station_id: 'grill', recipe_slug: 'steak', sort_order: 1, target_qty: 10 });
    await postPar({ station_id: 'saute', recipe_slug: 'risotto', sort_order: 1, target_qty: 3 });

    const r = await getPar();
    const j = await r.json();
    // grill comes before saute alphabetically
    assert.strictEqual(j.rows[0].station_id, 'grill');
    assert.strictEqual(j.rows[1].station_id, 'saute');
    assert.strictEqual(j.rows[1].recipe_slug, 'risotto'); // sort_order 1 before 2
    assert.strictEqual(j.rows[2].recipe_slug, 'pasta');
  });
});

describe('DELETE /api/prep-par', () => {
  it('removes the row and writes an audit event', async () => {
    const r = await postPar({ recipe_slug: 'demo-dish', target_qty: 5 });
    const { id } = await r.json();

    const del = await deletePar(id, { cook_id: 'bo' });
    assert.strictEqual(del.status, 200);
    const delJson = await del.json();
    assert.strictEqual(delJson.ok, true);

    const remaining = testDb.prepare('SELECT * FROM prep_par WHERE id=?').get(id);
    assert.strictEqual(remaining, undefined);

    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'prep_par' AND entity_id = ? AND action = 'delete'`,
      )
      .get(id);
    assert.ok(audit, 'expected audit row for delete');
  });

  it('404 when deleting from the wrong location', async () => {
    const r = await postPar({ recipe_slug: 'location-scoped', target_qty: 3, location_id: 'kitchen-a' });
    const { id } = await r.json();

    const del = await deletePar(id, { location_id: 'kitchen-b' });
    assert.strictEqual(del.status, 404);

    const stillThere = testDb.prepare('SELECT id FROM prep_par WHERE id=?').get(id);
    assert.ok(stillThere, 'row must remain — wrong location should not delete');
  });

  it('400 when id is invalid', async () => {
    const del = await deletePar('abc');
    assert.strictEqual(del.status, 400);
  });
});
