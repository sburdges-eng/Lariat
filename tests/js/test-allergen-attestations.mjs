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
    });
    assert.ok(row);
    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'attested');
    assert.ok(s.latest);
    assert.equal(s.latest.attested_by, 'Dana');
    assert.equal(s.latest.note, 'verified against spec book');
    // The stored list is the server-computed heuristic set (normalized:
    // trimmed, lower-cased, de-duped, sorted). Client input is never stored.
    assert.deepEqual(s.latest.allergens, ['fish', 'milk', 'wheat']);
  });

  it('always stores the server heuristic list, never a client-supplied list', () => {
    // Critical #1: even if a caller passes a divergent allergen list, the
    // recorded row must be the current heuristic set — an attestation means
    // "I verified THIS (the heuristic) list", so it can never understate.
    lib.recordAttestation({
      recipe_slug: 'queso',
      attested_by: 'Dana',
      // @ts-expect-error — allergens is no longer an input; proves it is ignored.
      allergens: [],
    });
    const s = lib.getAttestationStatus('queso', 'default');
    assert.equal(s.status, 'attested');
    assert.deepEqual(s.latest.allergens, ['fish', 'milk', 'wheat']);
  });

  it('goes stale when the derived allergen output changes but ingredients do not', () => {
    // Critical #2: the heuristic/data version can change a recipe's allergen
    // OUTPUT without touching ingredient item names (e.g. a keyword-map
    // update). The fingerprint must cover the derived output so the manager's
    // signoff stales when the answer they verified could have changed.
    lib.recordAttestation({ recipe_slug: 'queso', attested_by: 'Dana' });
    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'attested');

    writeRecipes([
      { ...QUESO, allergens: ['fish', 'milk', 'wheat', 'sesame'] }, // same ingredients
      SALSA,
    ]);

    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'stale');
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

// ── lib: orphaned attestations (recipe removed) ───────────────────

describe('getAttestationStatuses() — recipe removed from cache', () => {
  it('still lists an attestation whose recipe is gone, as stale', () => {
    // Contract #2: the module contract says an attestation may outlive its
    // recipe and surfaces as 'stale'. The list path (slugs=null) must not
    // silently drop it just because the slug is no longer in recipes.json.
    lib.recordAttestation({ recipe_slug: 'salsa', attested_by: 'Dana' });
    writeRecipes([QUESO]); // salsa removed from the cache

    const all = lib.getAttestationStatuses(null, 'default');
    const salsa = all.find((r) => r.recipe_slug === 'salsa');
    assert.ok(salsa, 'orphaned attestation must remain visible');
    assert.equal(salsa.status, 'stale');
    assert.equal(salsa.name, 'salsa'); // slug stands in for the gone name
    assert.equal(salsa.latest.attested_by, 'Dana');
  });
});

// ── lib: heuristicAllergensFor ────────────────────────────────────

describe('heuristicAllergensFor()', () => {
  it('returns the normalized heuristic list for a known recipe', () => {
    assert.deepEqual(lib.heuristicAllergensFor('queso'), ['fish', 'milk', 'wheat']);
  });

  it('returns null for a recipe not in the cache', () => {
    assert.equal(lib.heuristicAllergensFor('ghost'), null);
  });
});

// ── lib: resolveAttestor (identity) ───────────────────────────────

describe('resolveAttestor()', () => {
  it('forces identity from a signed-in manager account, ignoring typed name', () => {
    const r = lib.resolveAttestor(
      { source: 'manager', id: 7, name: 'Marco Diaz', role: 'gm' },
      'not-marco',
    );
    assert.deepEqual(r, {
      attested_by: 'Marco Diaz',
      actor_id: '7',
      actor_source: 'manager_pin',
    });
  });

  it('keeps the typed name for the env-PIN override login (no account)', () => {
    const r = lib.resolveAttestor({ source: 'override' }, '  Dana  ');
    assert.deepEqual(r, {
      attested_by: 'Dana',
      actor_id: 'Dana',
      actor_source: 'manager_ui',
    });
  });

  it('keeps the typed name when the PIN gate is disabled (null actor)', () => {
    const r = lib.resolveAttestor(null, 'Dana');
    assert.equal(r.attested_by, 'Dana');
    assert.equal(r.actor_source, 'manager_ui');
  });

  it('yields a blank identity when override has no typed name', () => {
    const r = lib.resolveAttestor({ source: 'override' }, '   ');
    assert.equal(r.attested_by, '');
    assert.equal(r.actor_id, null);
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

  it('accepts an attestation with no allergen list and stores the heuristic', async () => {
    const res = await route.POST(postReq({ slug: 'queso', attested_by: 'Dana' }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.recipe.latest.allergens, ['fish', 'milk', 'wheat']);
  });

  it('rejects a submitted list that differs from the current heuristic (409)', async () => {
    // Critical #1: a direct API call that understates the allergen set must
    // NOT be able to mark the recipe attested. The server surfaces the
    // mismatch loudly rather than silently storing its own list.
    const res = await route.POST(
      postReq({ slug: 'queso', attested_by: 'Dana', allergens: ['milk'] }),
    );
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.deepEqual(body.current_allergens, ['fish', 'milk', 'wheat']);
    const count = db.prepare('SELECT COUNT(*) AS n FROM allergen_attestations').get();
    assert.equal(count.n, 0); // nothing written on a rejected mismatch
  });
});

// ── Route: cross-cutting contract (location, schemaVersion, orphans) ──

describe('POST location resolution', () => {
  it('resolves the location from the ?location= query when the body omits it', async () => {
    // High #1: GET reads ?location= but POST previously only read the body,
    // so a query-only client silently filed under "default". They must agree.
    const req = new Request(
      'http://localhost/api/allergens/attestations?location=north',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'lariat_pin_ok=1' },
        body: JSON.stringify({ slug: 'queso', attested_by: 'Dana' }),
      },
    );
    const res = await route.POST(req);
    assert.equal(res.status, 201);
    assert.equal(lib.getAttestationStatus('queso', 'north').status, 'attested');
    assert.equal(lib.getAttestationStatus('queso', 'default').status, 'unattested');
  });
});

describe('response envelopes carry schemaVersion', () => {
  it('stamps schemaVersion on the GET list and the POST 201', async () => {
    const getRes = await route.GET(getReq());
    const getBody = await getRes.json();
    assert.equal(getBody.schemaVersion, 'allergen_attestations_v1');

    const postRes = await route.POST(postReq({ slug: 'queso', attested_by: 'Dana' }));
    const postBody = await postRes.json();
    assert.equal(postBody.schemaVersion, 'allergen_attestations_v1');
  });
});

describe('GET single-slug for a removed recipe', () => {
  it('returns the orphaned attestation as stale instead of 404', async () => {
    // Contract #2 at the route: an attestation that outlived its recipe must
    // stay reachable (stale), matching the list path and the module contract.
    lib.recordAttestation({ recipe_slug: 'salsa', attested_by: 'Dana' });
    writeRecipes([QUESO]); // salsa removed

    const res = await route.GET(getReq('?slug=salsa'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recipes[0].status, 'stale');
    assert.equal(body.recipes[0].latest.attested_by, 'Dana');

    // A slug with neither a recipe nor an attestation is still a 404.
    const ghost = await route.GET(getReq('?slug=ghost'));
    assert.equal(ghost.status, 404);
  });
});
