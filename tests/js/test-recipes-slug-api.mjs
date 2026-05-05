#!/usr/bin/env node
// DB-persistence integration tests for /api/recipes/[slug] PUT.
//
// Sibling to test-recipe-api.mjs which covers auth/validation/file-audit.
// This file specifically asserts:
//   - The PUT writes a row to entities_recipes (slug + display_name +
//     yield_qty + yield_unit + location_id) on first save.
//   - A second PUT on the same slug UPDATES the existing entity row
//     (no duplicate insert).
//   - One audit_events row lands per PUT, in the SAME transaction
//     as the entity write (per docs/PATTERNS.md §3 — verified by
//     count delta).
//   - The recipes.json document round-trips through GET.
//   - PIN gate still rejects without a cookie (and produces no DB or
//     filesystem side-effect).
//
// Uses an in-memory SQLite via setDbPathForTest, plus a tmp cwd so the
// recipes.json rewrite lands in a sandbox dir.
//
// Run: node --experimental-strip-types --test tests/js/test-recipes-slug-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// next/headers cookies() mock has to load BEFORE the resolver picks
// up the route's relative imports.
register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

// chdir to a sandbox BEFORE importing lib/db so DB_PATH (captured at
// module load) resolves under TMP_DIR. Recipes.json lives under
// `${TMP_DIR}/data/cache/`.
const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipes-slug-'));
process.chdir(TMP_DIR);
fs.mkdirSync(path.join(TMP_DIR, 'data', 'cache'), { recursive: true });

const headersMock = await import('./next-headers-mock.mjs');
const db = await import('../../lib/db.ts');

db.setDbPathForTest(':memory:');
const testDb = db.getDb();

const route = await import('../../app/api/recipes/[slug]/route.js');
const { GET, PUT } = route;

after(() => {
  db.setDbPathForTest(null);
  process.chdir(ORIGINAL_CWD);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  headersMock.__setCookies(null);
  testDb.exec('DELETE FROM entities_recipes; DELETE FROM audit_events;');
  // Reset recipes.json between tests so the rewrite path is exercised
  // from a known starting state each time.
  const cachePath = path.join(TMP_DIR, 'data', 'cache', 'recipes.json');
  try { fs.unlinkSync(cachePath); } catch { /* not present */ }
});

const SLUG = 'house_ranch_dressing';

function putReq(body) {
  return new Request(`http://localhost/api/recipes/${SLUG}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(slug = SLUG) {
  return new Request(`http://localhost/api/recipes/${slug}`);
}

const VALID_BODY = {
  name: 'House Ranch Dressing',
  ingredients: [
    { item: 'buttermilk', qty: '1', unit: 'qt' },
    { item: 'mayonnaise', qty: '2', unit: 'cups' },
    { item: 'fresh dill', qty: '0.25', unit: 'cup' },
  ],
  procedures: ['Whisk buttermilk and mayo', 'Fold in herbs', 'Chill 1h'],
  allergens: ['Dairy', 'Eggs'],
  yield_qty: 6,
  yield_unit: 'cups',
};

function countEntities() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM entities_recipes').get().c;
}

function countAuditForRecipe() {
  return testDb
    .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'recipes'`)
    .get().c;
}

// ─────────────────────────────────────────────────────────────────
// PIN gate — no DB or filesystem side effect when cookie is missing
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — PIN gate produces no side effect', () => {
  it('403 without cookie writes neither entity nor audit row', async () => {
    const before = { ent: countEntities(), aud: countAuditForRecipe() };
    const res = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countEntities(), before.ent);
    assert.strictEqual(countAuditForRecipe(), before.aud);
  });

  it('403 with wrong cookie value writes nothing', async () => {
    headersMock.__setCookies({ lariat_pin_ok: '0' });
    const res = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countEntities(), 0);
    assert.strictEqual(countAuditForRecipe(), 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT — DB persistence on first save
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — DB persistence', () => {
  beforeEach(() => {
    headersMock.__setCookies({ lariat_pin_ok: '1' });
  });

  it('200 + writes one row to entities_recipes with slug + name + yield', async () => {
    assert.strictEqual(countEntities(), 0);
    const res = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.slug, SLUG);
    assert.ok(body.entity_uuid, 'response carries the new entity uuid');
    assert.strictEqual(body.created, true);

    assert.strictEqual(countEntities(), 1);
    const row = testDb
      .prepare('SELECT * FROM entities_recipes WHERE slug = ?')
      .get(SLUG);
    assert.ok(row, 'row exists for slug');
    assert.strictEqual(row.display_name, 'House Ranch Dressing');
    assert.strictEqual(row.yield_qty, 6);
    assert.strictEqual(row.yield_unit, 'cups');
    assert.strictEqual(row.location_id, 'default');
    assert.strictEqual(row.uuid, body.entity_uuid);
  });

  it('emits exactly one audit_events row in the same transaction as the entity write', async () => {
    const before = countAuditForRecipe();
    const res = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 200);
    const after = countAuditForRecipe();
    assert.strictEqual(after - before, 1, 'audit count delta = 1');

    const audit = testDb
      .prepare(
        `SELECT entity, action, actor_source, payload_json, location_id
           FROM audit_events
          WHERE entity = 'recipes'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.strictEqual(audit.entity, 'recipes');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'management_ui');
    assert.strictEqual(audit.location_id, 'default');
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.slug, SLUG);
    assert.strictEqual(payload.display_name, 'House Ranch Dressing');
    assert.strictEqual(payload.changes.ingredients_count, 3);
    assert.strictEqual(payload.changes.allergens_count, 2);
    assert.strictEqual(payload.changes.procedures_length, 3);
  });

  it('a second PUT on the same slug UPDATES (no duplicate row, action=update)', async () => {
    const first = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(first.status, 200);
    const firstBody = await first.json();
    assert.strictEqual(firstBody.created, true);
    assert.strictEqual(countEntities(), 1);

    const second = await PUT(
      putReq({ ...VALID_BODY, name: 'House Ranch Dressing v2', yield_qty: 8 }),
      { params: { slug: SLUG } },
    );
    assert.strictEqual(second.status, 200);
    const secondBody = await second.json();
    assert.strictEqual(secondBody.created, false);
    assert.strictEqual(secondBody.entity_uuid, firstBody.entity_uuid);

    assert.strictEqual(countEntities(), 1, 'still exactly one row');
    const row = testDb
      .prepare('SELECT display_name, yield_qty FROM entities_recipes WHERE slug = ?')
      .get(SLUG);
    assert.strictEqual(row.display_name, 'House Ranch Dressing v2');
    assert.strictEqual(row.yield_qty, 8);

    // Two audit rows total — the insert from PUT #1 + the update
    // from PUT #2.
    assert.strictEqual(countAuditForRecipe(), 2);
    const lastAction = testDb
      .prepare(`SELECT action FROM audit_events WHERE entity = 'recipes' ORDER BY id DESC LIMIT 1`)
      .get().action;
    assert.strictEqual(lastAction, 'update');
  });

  it('honors location_id from the body so per-site recipes stay separate', async () => {
    const a = await PUT(
      putReq({ ...VALID_BODY, location_id: 'siteA' }),
      { params: { slug: SLUG } },
    );
    const b = await PUT(
      putReq({ ...VALID_BODY, location_id: 'siteB', name: 'Site B Ranch' }),
      { params: { slug: SLUG } },
    );
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.strictEqual(countEntities(), 2);
    const rows = testDb
      .prepare('SELECT location_id, display_name FROM entities_recipes WHERE slug = ? ORDER BY location_id')
      .all(SLUG);
    assert.deepStrictEqual(rows.map(r => r.location_id), ['siteA', 'siteB']);
    assert.strictEqual(rows[1].display_name, 'Site B Ranch');
  });

  it('400 on missing name does not write any row', async () => {
    const res = await PUT(putReq({ ingredients: [] }), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countEntities(), 0);
    assert.strictEqual(countAuditForRecipe(), 0);
  });

  it('400 on non-array ingredients does not write any row', async () => {
    const res = await PUT(
      putReq({ name: 'X', ingredients: 'oops' }),
      { params: { slug: SLUG } },
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countEntities(), 0);
    assert.strictEqual(countAuditForRecipe(), 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET — round-trip through the cache file
// ─────────────────────────────────────────────────────────────────

describe('GET /api/recipes/[slug] — round-trip', () => {
  beforeEach(() => {
    headersMock.__setCookies({ lariat_pin_ok: '1' });
  });

  it('returns the recipe doc that the most recent PUT persisted', async () => {
    await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });

    const res = await GET(getReq(), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.slug, SLUG);
    assert.ok(body.recipe, 'recipe payload present');
    assert.strictEqual(body.recipe.slug, SLUG);
    assert.strictEqual(body.recipe.name, 'House Ranch Dressing');
    assert.deepStrictEqual(body.recipe.ingredients, VALID_BODY.ingredients);
    assert.deepStrictEqual(body.recipe.procedures, VALID_BODY.procedures);
    assert.deepStrictEqual(body.recipe.allergens, VALID_BODY.allergens);
    assert.strictEqual(body.recipe.yield_qty, 6);
    assert.strictEqual(body.recipe.yield_unit, 'cups');
  });

  it('returns recipe: null when the slug is not in cache', async () => {
    const res = await GET(getReq('does-not-exist'), { params: { slug: 'does-not-exist' } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.slug, 'does-not-exist');
    assert.strictEqual(body.recipe, null);
  });
});
