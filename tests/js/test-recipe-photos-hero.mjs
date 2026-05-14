#!/usr/bin/env node
// Integration tests for the is_hero pin feature on /api/recipes/[slug]/photos/[id].
//
// Spec:
//   - recipe_photos has an additive `is_hero INTEGER NOT NULL DEFAULT 0`
//     column (added via migrateLegacyColumns; never edit existing DDL).
//   - PATCH /api/recipes/[slug]/photos/[id] { is_hero: true } sets the
//     target row's is_hero=1 and zeroes every other row for the same
//     (location_id, recipe_slug) in one transaction.
//   - PATCH is PIN-gated (same gate as POST/DELETE).
//   - Sets emit a management-action audit row with
//     action='recipe_photo_set_hero'.
//   - Hero pin is scoped to (location_id, recipe_slug) — setting hero
//     in one location must not change another location's pin.
//   - Setting { is_hero: false } unsets without auto-promoting another.
//
// Run: node --experimental-strip-types --test tests/js/test-recipe-photos-hero.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipe-photos-hero-'));
process.chdir(TMP_DIR);

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const testDb = db.getDb();

const item = await import('../../app/api/recipes/[slug]/photos/[id]/route.js');
const { PATCH: itemPATCH } = item;

const SLUG = 'test-recipe';

after(() => {
  db.setDbPathForTest(null);
  process.chdir(ORIGINAL_CWD);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM recipe_photos;');
});

function patchReq(slug, id, body, { withAuth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withAuth) headers.cookie = 'lariat_pin_ok=1';
  return new Request(`http://localhost/api/recipes/${slug}/photos/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

function ctxItem(slug, id) { return { params: { slug, id: String(id) } }; }

function seedPhoto({ slug = SLUG, location = 'default', stored = '/dev/null', isHero = 0 } = {}) {
  const stmt = testDb.prepare(
    `INSERT INTO recipe_photos
       (recipe_slug, location_id, original_name, stored_path, mime, size_bytes, is_hero)
     VALUES (?, ?, 'x.png', ?, 'image/png', 1, ?)`,
  );
  const r = stmt.run(slug, location, stored, isHero);
  return r.lastInsertRowid;
}

// ── Schema additive migration ────────────────────────────────────

describe('schema migration', () => {
  it('recipe_photos has an additive is_hero column with default 0', () => {
    const cols = testDb.prepare('PRAGMA table_info(recipe_photos)').all();
    const hero = cols.find((c) => c.name === 'is_hero');
    assert.ok(hero, 'is_hero column should exist after migration');
    assert.equal(hero.notnull, 1, 'is_hero must be NOT NULL');
    // SQLite reports dflt_value as the literal text from the DDL.
    assert.ok(hero.dflt_value === '0' || hero.dflt_value === 0, 'is_hero default must be 0');
  });
});

// ── PIN gate ─────────────────────────────────────────────────────

describe('PATCH PIN gate', () => {
  it('rejects without PIN cookie', async () => {
    const id = seedPhoto();
    const res = await itemPATCH(
      patchReq(SLUG, id, { is_hero: true }, { withAuth: false }),
      ctxItem(SLUG, id),
    );
    assert.ok(res.status === 401 || res.status === 403,
      `expected 401/403, got ${res.status}`);
  });
});

// ── Set hero zeroes peers; atomic ────────────────────────────────

describe('PATCH { is_hero: true } pins one and clears peers', () => {
  it('sets target.is_hero=1 and zeroes every other row in same (location, slug)', async () => {
    const a = seedPhoto({ stored: '/a' });
    const b = seedPhoto({ stored: '/b', isHero: 1 }); // pre-existing hero
    const c = seedPhoto({ stored: '/c' });

    const res = await itemPATCH(
      patchReq(SLUG, c, { is_hero: true }),
      ctxItem(SLUG, c),
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);

    const rows = testDb
      .prepare('SELECT id, is_hero FROM recipe_photos WHERE recipe_slug = ? AND location_id = ? ORDER BY id')
      .all(SLUG, 'default');
    const byId = new Map(rows.map((r) => [Number(r.id), r.is_hero]));
    assert.equal(byId.get(Number(a)), 0, 'peer A must be cleared');
    assert.equal(byId.get(Number(b)), 0, 'previous hero B must be cleared');
    assert.equal(byId.get(Number(c)), 1, 'target C must be hero');
  });

  it('is scoped to (location_id, recipe_slug) — other locations untouched', async () => {
    const aDefault = seedPhoto({ location: 'default' });
    const aOther = seedPhoto({ location: 'denver', isHero: 1 });

    const res = await itemPATCH(
      patchReq(SLUG, aDefault, { is_hero: true }),
      ctxItem(SLUG, aDefault),
    );
    assert.equal(res.status, 200);

    const other = testDb
      .prepare('SELECT is_hero FROM recipe_photos WHERE id = ?')
      .get(aOther);
    assert.equal(other.is_hero, 1, 'a different location must not be touched');
  });

  it('is scoped to recipe_slug — peer recipe under same location untouched', async () => {
    const a = seedPhoto({ slug: 'recipe-a' });
    const b = seedPhoto({ slug: 'recipe-b', isHero: 1 });
    const res = await itemPATCH(
      patchReq('recipe-a', a, { is_hero: true }),
      ctxItem('recipe-a', a),
    );
    assert.equal(res.status, 200);
    const peer = testDb.prepare('SELECT is_hero FROM recipe_photos WHERE id = ?').get(b);
    assert.equal(peer.is_hero, 1, 'a different recipe under same location must not be touched');
  });
});

// ── Unset hero ───────────────────────────────────────────────────

describe('PATCH { is_hero: false } unsets without auto-promoting', () => {
  it('clears the target hero and leaves no row as hero', async () => {
    const a = seedPhoto({ isHero: 1 });
    const b = seedPhoto();
    const res = await itemPATCH(
      patchReq(SLUG, a, { is_hero: false }),
      ctxItem(SLUG, a),
    );
    assert.equal(res.status, 200);
    const heroes = testDb
      .prepare('SELECT COUNT(*) AS n FROM recipe_photos WHERE recipe_slug = ? AND is_hero = 1')
      .get(SLUG);
    assert.equal(heroes.n, 0, 'no row should remain hero after explicit unset');
  });
});

// ── 404 for missing/soft-deleted row ─────────────────────────────

describe('PATCH unknown id', () => {
  it('returns 404 when the photo id does not exist', async () => {
    const res = await itemPATCH(
      patchReq(SLUG, 999999, { is_hero: true }),
      ctxItem(SLUG, 999999),
    );
    assert.equal(res.status, 404);
  });
});

// ── At-most-one hero per (location, slug) ────────────────────────

describe('invariant — at most one hero per (location, slug)', () => {
  it('after repeated set calls, exactly one row remains hero', async () => {
    const a = seedPhoto();
    const b = seedPhoto();
    const c = seedPhoto();

    await itemPATCH(patchReq(SLUG, a, { is_hero: true }), ctxItem(SLUG, a));
    await itemPATCH(patchReq(SLUG, b, { is_hero: true }), ctxItem(SLUG, b));
    await itemPATCH(patchReq(SLUG, c, { is_hero: true }), ctxItem(SLUG, c));

    const rows = testDb
      .prepare('SELECT id, is_hero FROM recipe_photos WHERE recipe_slug = ? ORDER BY id')
      .all(SLUG);
    const heroes = rows.filter((r) => r.is_hero === 1);
    assert.equal(heroes.length, 1, 'exactly one hero must remain');
    assert.equal(Number(heroes[0].id), Number(c), 'last set wins');
  });
});
