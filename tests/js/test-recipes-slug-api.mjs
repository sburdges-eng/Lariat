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

// next-headers-mock-loader is preserved (some legacy code paths still
// import next/headers); resolver.mjs handles extensionless specifiers.
register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

// Force the PIN gate ON for these tests regardless of host env so the
// 403 paths exercise the same code path production hits. With
// LARIAT_PIN_SECRET unset, hasValidPinCookie accepts the legacy
// unsigned 'lariat_pin_ok=1' cookie.
const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

// chdir to a sandbox BEFORE importing lib/db so DB_PATH (captured at
// module load) resolves under TMP_DIR. Recipes.json lives under
// `${TMP_DIR}/data/cache/`.
const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipes-slug-'));
process.chdir(TMP_DIR);
fs.mkdirSync(path.join(TMP_DIR, 'data', 'cache'), { recursive: true });

const db = await import('../../lib/db.ts');

db.setDbPathForTest(':memory:');
const testDb = db.getDb();

const route = await import('../../app/api/recipes/[slug]/route.js');
const { GET, PUT } = route;

after(() => {
  db.setDbPathForTest(null);
  process.chdir(ORIGINAL_CWD);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM entities_recipes; DELETE FROM audit_events;');
  // Reset recipes.json between tests so the rewrite path is exercised
  // from a known starting state each time.
  const cachePath = path.join(TMP_DIR, 'data', 'cache', 'recipes.json');
  try { fs.unlinkSync(cachePath); } catch { /* not present */ }
});

const SLUG = 'house_ranch_dressing';

// Default: ship the legacy unsigned PIN cookie so most tests are
// authenticated. PIN-gate negative tests pass `{ withAuth: false }` or
// `{ cookieValue: '0' }` to exercise the 403 path.
function putReq(body, { withAuth = true, cookieValue } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookieValue !== undefined) {
    headers.cookie = `lariat_pin_ok=${cookieValue}`;
  } else if (withAuth) {
    headers.cookie = 'lariat_pin_ok=1';
  }
  return new Request(`http://localhost/api/recipes/${SLUG}`, {
    method: 'PUT',
    headers,
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
    const res = await PUT(putReq(VALID_BODY, { withAuth: false }), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countEntities(), before.ent);
    assert.strictEqual(countAuditForRecipe(), before.aud);
  });

  it('403 with wrong cookie value writes nothing', async () => {
    const res = await PUT(putReq(VALID_BODY, { cookieValue: '0' }), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countEntities(), 0);
    assert.strictEqual(countAuditForRecipe(), 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT — DB persistence on first save
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — DB persistence', () => {
  // putReq defaults to withAuth=true; cookie ships automatically.

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
// PUT — category persistence (regression: PUT used to hardcode
// category: null into the entities_recipes upsert AND drop it from
// the recipes.json doc, so management edits could never set — and
// always wiped — a recipe's category)
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — category persistence', () => {
  it('persists body.category to entities_recipes and the recipe doc', async () => {
    const res = await PUT(
      putReq({ ...VALID_BODY, category: 'dressing' }),
      { params: { slug: SLUG } },
    );
    assert.strictEqual(res.status, 200);

    const row = testDb
      .prepare('SELECT category FROM entities_recipes WHERE slug = ?')
      .get(SLUG);
    assert.strictEqual(row.category, 'dressing');

    // Doc store carries it too — GET round-trips.
    const getRes = await GET(getReq(), { params: { slug: SLUG } });
    const getBody = await getRes.json();
    assert.strictEqual(getBody.recipe.category, 'dressing');
  });

  it('preserves an existing category when the caller round-trips it (the RecipeEditForm contract)', async () => {
    await PUT(putReq({ ...VALID_BODY, category: 'dressing' }), { params: { slug: SLUG } });

    // Simulate the edit form: GET the doc, echo category back in the PUT.
    const getRes = await GET(getReq(), { params: { slug: SLUG } });
    const loaded = (await getRes.json()).recipe;
    const second = await PUT(
      putReq({ ...VALID_BODY, name: 'House Ranch Dressing v2', category: loaded.category }),
      { params: { slug: SLUG } },
    );
    assert.strictEqual(second.status, 200);

    const row = testDb
      .prepare('SELECT category, display_name FROM entities_recipes WHERE slug = ?')
      .get(SLUG);
    assert.strictEqual(row.category, 'dressing', 'category survives the second save');
    assert.strictEqual(row.display_name, 'House Ranch Dressing v2');
  });

  it('omitted category = null (same semantic as yield_qty/station/source)', async () => {
    await PUT(putReq({ ...VALID_BODY, category: 'dressing' }), { params: { slug: SLUG } });
    // A PUT that omits category clears it — preservation is the
    // CALLER's job via GET→echo pass-through, matching how the route
    // treats its other preservable fields post-#511.
    const res = await PUT(putReq(VALID_BODY), { params: { slug: SLUG } });
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT category FROM entities_recipes WHERE slug = ?')
      .get(SLUG);
    assert.strictEqual(row.category, null);
  });

  it('trims, length-caps at 64, and nulls non-string/blank categories', async () => {
    await PUT(putReq({ ...VALID_BODY, category: '  entree  ' }), { params: { slug: SLUG } });
    let row = testDb.prepare('SELECT category FROM entities_recipes WHERE slug = ?').get(SLUG);
    assert.strictEqual(row.category, 'entree', 'trimmed');

    await PUT(putReq({ ...VALID_BODY, category: 'x'.repeat(200) }), { params: { slug: SLUG } });
    row = testDb.prepare('SELECT category FROM entities_recipes WHERE slug = ?').get(SLUG);
    assert.strictEqual(row.category, 'x'.repeat(64), 'clipped to 64');

    await PUT(putReq({ ...VALID_BODY, category: 42 }), { params: { slug: SLUG } });
    row = testDb.prepare('SELECT category FROM entities_recipes WHERE slug = ?').get(SLUG);
    assert.strictEqual(row.category, null, 'non-string coerced to null');

    await PUT(putReq({ ...VALID_BODY, category: '   ' }), { params: { slug: SLUG } });
    row = testDb.prepare('SELECT category FROM entities_recipes WHERE slug = ?').get(SLUG);
    assert.strictEqual(row.category, null, 'blank coerced to null');
  });
});

// ─────────────────────────────────────────────────────────────────
// GET — round-trip through the cache file
// ─────────────────────────────────────────────────────────────────

describe('GET /api/recipes/[slug] — round-trip', () => {
  // putReq defaults to withAuth=true; cookie ships automatically.

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
