#!/usr/bin/env node
// Integration tests for /api/recipes/[slug] — management-gated PUT
// endpoint + placeholder GET endpoint.
//
// The PUT handler:
//   - 403s when the `lariat_pin_ok` cookie is missing or not '1'
//   - 400s on missing/empty name or non-array ingredients
//   - 200s on valid payload, returns an audit entry
//   - 500s on malformed JSON body
//   - writes the audit entry via logAuditAction to data/audit/
//
// The GET handler is currently a placeholder (returns { success, slug }).
//
// Pattern mirrors test-checks-api.mjs: we import the route handler
// directly and call it with `Request` objects — no running server.
//
// Wrinkle: the PUT handler reads the PIN cookie via `cookies()` from
// `next/headers`, which only works inside a Next request-scope. The
// next-headers-mock-loader swaps that import for a local mock whose
// cookie jar we control via `__setCookies()` before each call.
//
// Run: node --test tests/js/test-recipe-api.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Order matters. next/headers redirect must resolve BEFORE the
// resolver.mjs gets a crack at extensionless specifiers. Either
// order works since they have disjoint matching domains, but this
// is the intentional read.
register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

// The auditLog module writes to `${process.cwd()}/data/audit/`. Point
// cwd at a throw-away dir BEFORE importing the route so the module
// captures it at load time (if it ever starts doing that) and so the
// jsonl file lands in the sandbox.
const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipe-api-'));
process.chdir(TMP_DIR);

const headersMock = await import('./next-headers-mock.mjs');
const route = await import('../../app/api/recipes/[slug]/route.js');

const { GET, PUT } = route;
const SLUG = 'test-recipe';

after(() => {
  process.chdir(ORIGINAL_CWD);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  headersMock.__setCookies(null);
});

// ── Helpers ──────────────────────────────────────────────────────

function putReq(body, { rawBody } = {}) {
  return new Request(`http://localhost/api/recipes/${SLUG}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

function getReq() {
  return new Request(`http://localhost/api/recipes/${SLUG}`);
}

const ctx = { params: { slug: SLUG } };

const VALID_BODY = {
  name: 'Test Recipe',
  ingredients: [{ item: 'Flour', quantity: '2', unit: 'cups' }],
  procedures: ['Step 1', 'Step 2'],
  allergens: ['Gluten'],
};

// ─────────────────────────────────────────────────────────────────
// PUT — auth gate
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — auth gate', () => {
  it('403 when the lariat_pin_ok cookie is absent', async () => {
    // No __setCookies → empty jar
    const res = await PUT(putReq(VALID_BODY), ctx);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('403 when lariat_pin_ok is not "1"', async () => {
    headersMock.__setCookies({ lariat_pin_ok: '0' });
    const res = await PUT(putReq(VALID_BODY), ctx);
    assert.strictEqual(res.status, 403);
  });

  it('403 when lariat_pin_ok is some other truthy value', async () => {
    // Pins the strict-equality-with-"1" check. Prevents a regression
    // where someone relaxes the gate to pinOk?.value (truthy).
    headersMock.__setCookies({ lariat_pin_ok: 'yes' });
    const res = await PUT(putReq(VALID_BODY), ctx);
    assert.strictEqual(res.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT — validation (400)
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — payload validation', () => {
  beforeEach(() => {
    headersMock.__setCookies({ lariat_pin_ok: '1' });
  });

  it('400 when name is empty string', async () => {
    const res = await PUT(putReq({ ...VALID_BODY, name: '' }), ctx);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Recipe name is required/);
  });

  it('400 when name is whitespace only', async () => {
    const res = await PUT(putReq({ ...VALID_BODY, name: '   ' }), ctx);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Recipe name is required/);
  });

  it('400 when name is missing', async () => {
    const { name, ...rest } = VALID_BODY;
    void name;
    const res = await PUT(putReq(rest), ctx);
    assert.strictEqual(res.status, 400);
  });

  it('400 when ingredients is not an array', async () => {
    const res = await PUT(putReq({ ...VALID_BODY, ingredients: 'not an array' }), ctx);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Ingredients must be an array/);
  });

  it('400 when ingredients is missing (treated as non-array)', async () => {
    const { ingredients, ...rest } = VALID_BODY;
    void ingredients;
    const res = await PUT(putReq(rest), ctx);
    assert.strictEqual(res.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT — success path + audit entry shape
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — success path', () => {
  beforeEach(() => {
    headersMock.__setCookies({ lariat_pin_ok: '1' });
  });

  it('200 with audit entry on valid payload', async () => {
    const res = await PUT(putReq(VALID_BODY), ctx);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.slug, SLUG);
    assert.ok(body.audit, 'response must carry an audit entry');
    assert.strictEqual(body.audit.action, 'recipe_edit');
    assert.strictEqual(body.audit.slug, SLUG);
    assert.ok(body.audit.timestamp, 'audit entry must be timestamped');
    // Parseable ISO timestamp.
    assert.ok(!Number.isNaN(Date.parse(body.audit.timestamp)));
    assert.deepStrictEqual(body.audit.changes, {
      name: 'Test Recipe',
      procedures_length: 2,
      allergens_count: 1,
      ingredients_count: 1,
    });
  });

  it('audit.changes counts reflect the submitted payload', async () => {
    const res = await PUT(
      putReq({
        name: 'Bigger Recipe',
        ingredients: [
          { item: 'a', quantity: '1', unit: 'cup' },
          { item: 'b', quantity: '2', unit: 'cup' },
          { item: 'c', quantity: '3', unit: 'cup' },
        ],
        procedures: ['p1', 'p2', 'p3', 'p4'],
        allergens: ['Dairy', 'Eggs'],
      }),
      ctx
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.audit.changes, {
      name: 'Bigger Recipe',
      procedures_length: 4,
      allergens_count: 2,
      ingredients_count: 3,
    });
  });

  it('tolerates missing procedures/allergens arrays (defaults to zero counts)', async () => {
    const res = await PUT(
      putReq({ name: 'Sparse', ingredients: [] }),
      ctx
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.audit.changes, {
      name: 'Sparse',
      procedures_length: 0,
      allergens_count: 0,
      ingredients_count: 0,
    });
  });

  it('appends a JSONL row to data/audit/management-actions.jsonl', async () => {
    await PUT(putReq(VALID_BODY), ctx);
    const logPath = path.join(TMP_DIR, 'data', 'audit', 'management-actions.jsonl');
    assert.ok(fs.existsSync(logPath), `audit log file should exist at ${logPath}`);
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(last.action, 'recipe_edit');
    assert.strictEqual(last.slug, SLUG);
    assert.ok(last.id, 'audit row gets an id from logAuditAction');
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT — malformed JSON → 500 "Failed to update recipe: ..."
// ─────────────────────────────────────────────────────────────────

describe('PUT /api/recipes/[slug] — malformed body', () => {
  it('500 with error message when body is not valid JSON', async () => {
    headersMock.__setCookies({ lariat_pin_ok: '1' });
    const res = await PUT(putReq(null, { rawBody: 'invalid json {' }), ctx);
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.ok(body.error);
    assert.match(body.error, /Failed to update recipe/);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET — placeholder endpoint
// ─────────────────────────────────────────────────────────────────

describe('GET /api/recipes/[slug]', () => {
  it('returns 200 with slug echo (no auth required)', async () => {
    // No cookies set — GET should not care.
    const res = await GET(getReq(), ctx);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.slug, SLUG);
    assert.ok(body.message, 'GET placeholder surfaces a message for discoverability');
  });

  it('echoes the slug from the route context', async () => {
    const res = await GET(getReq(), { params: { slug: 'different-slug' } });
    const body = await res.json();
    assert.strictEqual(body.slug, 'different-slug');
  });
});
