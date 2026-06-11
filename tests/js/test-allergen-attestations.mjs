#!/usr/bin/env node
// Integration tests for lib/allergenAttestations.ts and
// /api/allergens/attestations — roadmap 3.3.
//
// Pins the attestation contract:
//   - attest → status flips 'unattested' → 'attested'
//   - recipe composition change (own ingredients OR sub-recipe tree)
//     → 'stale'
//   - a new attestation supersedes the old (append-only, latest wins)
//   - cross-location isolation
//   - POST is manager-PIN-gated (401 without the cookie)
//   - every attestation writes a matching audit_events row in the same
//     transaction
//
// PIN posture mirrors tests/js/test-recipe-api.mjs: LARIAT_PIN is forced
// on so pinRequiredForPic() is true; with LARIAT_PIN_SECRET unset the
// legacy unsigned 'lariat_pin_ok=1' cookie is accepted.
//
// Run: node --experimental-strip-types --test tests/js/test-allergen-attestations.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-allergen-attest-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const CACHE_DIR = path.join(TMP_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const dbMod = await import('../../lib/db.ts');
const dataMod = await import('../../lib/data.ts');
const lib = await import('../../lib/allergenAttestations.ts');
const route = await import('../../app/api/allergens/attestations/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  dataMod.setCacheRootForTest(null);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Recipe-cache fixtures ─────────────────────────────────────────
//
// writeRecipes() rewrites recipes.json then re-points the cache root,
// which flushes lib/data.ts's in-memory mtime cache — no utimes games.

function writeRecipes(recipes) {
  fs.writeFileSync(path.join(CACHE_DIR, 'recipes.json'), JSON.stringify(recipes, null, 2));
  dataMod.setCacheRootForTest(CACHE_DIR);
}

const SALSA = {
  slug: 'salsa',
  name: 'Blackened Tomato Salsa',
  ingredients: [{ item: 'Tomato' }, { item: 'Worcestershire' }],
  allergens: ['fish', 'wheat'],
};

const QUESO = {
  slug: 'queso',
  name: 'Queso',
  ingredients: [{ item: 'Milk' }, { item: 'Cheddar' }],
  allergens: ['fish', 'milk', 'wheat'],
  sub_recipes: ['salsa'],
};

function baseline() {
  writeRecipes([QUESO, SALSA]);
}

beforeEach(() => {
  db.exec('DELETE FROM allergen_attestations; DELETE FROM audit_events;');
  baseline();
});

// ── lib: status computation ───────────────────────────────────────

describe('getAttestationStatus()', () => {
  it('is unattested before any signoff', () => {
    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'unattested');
    assert.equal(s.latest, null);
    assert.equal(s.name, 'Queso');
    assert.deepEqual(s.heuristic_allergens, ['fish', 'milk', 'wheat']);
  });

  it('flips to attested after recordAttestation, with metadata', () => {
    const row = lib.recordAttestation({
      recipe_slug: 'queso',
      attested_by: 'Dana',
      note: 'verified against spec book',
      allergens: ['Milk', 'fish', 'wheat', 'milk '],
    });
    assert.ok(row);
    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'attested');
    assert.ok(s.latest);
    assert.equal(s.latest.attested_by, 'Dana');
    assert.equal(s.latest.note, 'verified against spec book');
    // Normalized: trimmed, lower-cased, de-duped, sorted.
    assert.deepEqual(s.latest.allergens, ['fish', 'milk', 'wheat']);
  });

  it('goes stale when the recipe ingredient composition changes', () => {
    lib.recordAttestation({ recipe_slug: 'queso', attested_by: 'Dana' });
    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'attested');

    writeRecipes([
      { ...QUESO, ingredients: [...QUESO.ingredients, { item: 'Flour' }] },
      SALSA,
    ]);

    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'stale');
    assert.equal(s.latest.attested_by, 'Dana'); // metadata survives staleness
  });

  it('goes stale when a SUB-recipe in the tree changes', () => {
    lib.recordAttestation({ recipe_slug: 'queso', attested_by: 'Dana' });

    writeRecipes([
      QUESO,
      { ...SALSA, ingredients: [...SALSA.ingredients, { item: 'Peanut oil' }] },
    ]);

    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'stale');
    // The unchanged-but-unattested sub-recipe stays unattested, not stale.
    assert.equal(lib.getAttestationStatus('salsa', 'default').status, 'unattested');
  });

  it('a new attestation supersedes the old one (append-only)', () => {
    lib.recordAttestation({ recipe_slug: 'queso', attested_by: 'Dana' });
    writeRecipes([
      { ...QUESO, ingredients: [...QUESO.ingredients, { item: 'Flour' }] },
      SALSA,
    ]);
    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'stale');

    lib.recordAttestation({ recipe_slug: 'queso', attested_by: 'Marco' });

    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'attested');
    assert.equal(s.latest.attested_by, 'Marco');

    // Both rows persist — corrections never UPDATE/DELETE.
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM allergen_attestations WHERE recipe_slug = 'queso'`)
      .get();
    assert.equal(count.n, 2);
  });

  it('isolates attestations per location', () => {
    lib.recordAttestation({
      recipe_slug: 'queso',
      location_id: 'kitchen-a',
      attested_by: 'Dana',
    });
    assert.equal(lib.getAttestationStatus('queso', 'kitchen-a').status, 'attested');
    assert.equal(lib.getAttestationStatus('queso', 'kitchen-b').status, 'unattested');
    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'unattested');
  });

  it('returns null from recordAttestation for an unknown recipe', () => {
    const row = lib.recordAttestation({ recipe_slug: 'nope', attested_by: 'Dana' });
    assert.equal(row, null);
    const count = db.prepare('SELECT COUNT(*) AS n FROM allergen_attestations').get();
    assert.equal(count.n, 0);
  });

  it('writes the audit_events row in the same transaction', () => {
    const row = lib.recordAttestation({
      recipe_slug: 'queso',
      location_id: 'kitchen-a',
      attested_by: 'Dana',
      note: 'spot check',
    });
    const audits = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'allergen_attestation'`)
      .all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entity_id, row.id);
    assert.equal(audits[0].action, 'insert');
    assert.equal(audits[0].actor_cook_id, 'Dana');
    assert.equal(audits[0].location_id, 'kitchen-a');
    const payload = JSON.parse(audits[0].payload_json);
    assert.equal(payload.recipe_slug, 'queso');
    assert.equal(payload.recipe_fingerprint, row.recipe_fingerprint);
  });
});

// ── Route: GET ────────────────────────────────────────────────────

function getReq(qs = '') {
  return new Request(`http://localhost/api/allergens/attestations${qs}`);
}

function postReq(body, { withAuth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withAuth) headers.cookie = 'lariat_pin_ok=1';
  return new Request('http://localhost/api/allergens/attestations', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('GET /api/allergens/attestations', () => {
  it('lists every recipe with its attestation status', async () => {
    lib.recordAttestation({ recipe_slug: 'salsa', attested_by: 'Dana' });

    const res = await route.GET(getReq());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.location_id, 'default');
    const bySlug = new Map(body.recipes.map((r) => [r.recipe_slug, r]));
    assert.equal(bySlug.get('queso').status, 'unattested');
    assert.equal(bySlug.get('salsa').status, 'attested');
    assert.equal(bySlug.get('salsa').latest.attested_by, 'Dana');
  });

  it('supports single-slug lookup and 404s on unknown slugs', async () => {
    const ok = await route.GET(getReq('?slug=queso'));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.recipes.length, 1);
    assert.equal(body.recipes[0].recipe_slug, 'queso');

    const missing = await route.GET(getReq('?slug=ghost'));
    assert.equal(missing.status, 404);
  });
});

// ── Route: POST (PIN-gated) ───────────────────────────────────────

describe('POST /api/allergens/attestations', () => {
  it('401s without the manager PIN cookie', async () => {
    const res = await route.POST(
      postReq({ slug: 'queso', attested_by: 'Dana' }, { withAuth: false }),
    );
    assert.equal(res.status, 401);
    const count = db.prepare('SELECT COUNT(*) AS n FROM allergen_attestations').get();
    assert.equal(count.n, 0);
  });

  it('records the attestation with the cookie present', async () => {
    const res = await route.POST(
      postReq({
        slug: 'queso',
        attested_by: 'Dana',
        note: 'line check',
        allergens: ['milk', 'fish', 'wheat'],
      }),
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.recipe.status, 'attested');
    assert.equal(body.recipe.latest.attested_by, 'Dana');
    assert.deepEqual(body.recipe.latest.allergens, ['fish', 'milk', 'wheat']);

    const audits = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE entity = 'allergen_attestation'`)
      .get();
    assert.equal(audits.n, 1);
  });

  it('400s on missing slug / attested_by, 404s on unknown recipe', async () => {
    assert.equal((await route.POST(postReq({ attested_by: 'Dana' }))).status, 400);
    assert.equal((await route.POST(postReq({ slug: 'queso' }))).status, 400);
    assert.equal(
      (await route.POST(postReq({ slug: 'ghost', attested_by: 'Dana' }))).status,
      404,
    );
  });
});
