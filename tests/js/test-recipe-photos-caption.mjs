#!/usr/bin/env node
// Integration tests for caption editing on /api/recipes/[slug]/photos/[id].
//
// Builds on T2 — the same PATCH route now also accepts a caption
// field. Spec:
//   - PATCH { caption: "new caption" } updates the row's caption.
//   - PATCH { caption: null } clears the caption.
//   - Empty string is normalized to null (matches the upload route's
//     handling of FormData caption fields, which also empty-tofallback).
//   - Non-string caption -> 400.
//   - Round-trip: the new caption shows up in the list endpoint.
//   - PIN-gated.
//   - File audit row uses action='recipe_photo_set_caption'.
//
// Run: node --experimental-strip-types --test tests/js/test-recipe-photos-caption.mjs

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
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipe-photos-caption-'));
process.chdir(TMP_DIR);

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const testDb = db.getDb();

const item = await import('../../app/api/recipes/[slug]/photos/[id]/route.js');
const collection = await import('../../app/api/recipes/[slug]/photos/route.js');
const { PATCH: itemPATCH } = item;
const { GET: listGET } = collection;

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
function getReq() {
  return new Request(`http://localhost/api/recipes/${SLUG}/photos`);
}
function ctxSlug() { return { params: { slug: SLUG } }; }
function ctxItem(slug, id) { return { params: { slug, id: String(id) } }; }

function seedPhoto({ caption = null } = {}) {
  const stmt = testDb.prepare(
    `INSERT INTO recipe_photos
       (recipe_slug, location_id, original_name, stored_path, mime,
        size_bytes, caption)
     VALUES (?, 'default', 'x.png', '/dev/null', 'image/png', 1, ?)`,
  );
  return stmt.run(SLUG, caption).lastInsertRowid;
}

// ── PIN gate ─────────────────────────────────────────────────────

describe('PATCH caption — PIN gate', () => {
  it('rejects without PIN cookie', async () => {
    const id = seedPhoto();
    const res = await itemPATCH(
      patchReq(SLUG, id, { caption: 'plated and ready' }, { withAuth: false }),
      ctxItem(SLUG, id),
    );
    assert.ok(res.status === 401 || res.status === 403,
      `expected 401/403 without PIN, got ${res.status}`);
  });
});

// ── Set / clear ───────────────────────────────────────────────────

describe('PATCH caption — set and clear', () => {
  it('updates the caption with a non-empty string', async () => {
    const id = seedPhoto({ caption: 'old caption' });
    const res = await itemPATCH(
      patchReq(SLUG, id, { caption: 'house ranch in deli cup' }),
      ctxItem(SLUG, id),
    );
    assert.equal(res.status, 200);
    const row = testDb.prepare('SELECT caption FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row.caption, 'house ranch in deli cup');
  });

  it('clears the caption when caption is null', async () => {
    const id = seedPhoto({ caption: 'will be cleared' });
    const res = await itemPATCH(
      patchReq(SLUG, id, { caption: null }),
      ctxItem(SLUG, id),
    );
    assert.equal(res.status, 200);
    const row = testDb.prepare('SELECT caption FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row.caption, null);
  });

  it('normalizes empty/whitespace string to null', async () => {
    const id = seedPhoto({ caption: 'pre-existing' });
    const res = await itemPATCH(
      patchReq(SLUG, id, { caption: '   ' }),
      ctxItem(SLUG, id),
    );
    assert.equal(res.status, 200);
    const row = testDb.prepare('SELECT caption FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row.caption, null, 'whitespace-only caption normalizes to null');
  });

  it('rejects non-string non-null caption with 400', async () => {
    const id = seedPhoto();
    const res = await itemPATCH(
      patchReq(SLUG, id, { caption: 42 }),
      ctxItem(SLUG, id),
    );
    assert.equal(res.status, 400);
  });
});

// ── 404 for unknown id ────────────────────────────────────────────

describe('PATCH caption — unknown id', () => {
  it('returns 404 when the photo id does not exist', async () => {
    const res = await itemPATCH(
      patchReq(SLUG, 9999999, { caption: 'whatever' }),
      ctxItem(SLUG, 9999999),
    );
    assert.equal(res.status, 404);
  });
});

// ── Round-trip via GET list ───────────────────────────────────────

describe('PATCH caption — round-trip via GET list', () => {
  it('the new caption shows up in the photos list endpoint', async () => {
    const id = seedPhoto();
    const newCaption = 'plated for service, no garnish';
    const patchRes = await itemPATCH(
      patchReq(SLUG, id, { caption: newCaption }),
      ctxItem(SLUG, id),
    );
    assert.equal(patchRes.status, 200);

    const listRes = await listGET(getReq(), ctxSlug());
    const body = await listRes.json();
    const row = body.photos.find((p) => Number(p.id) === Number(id));
    assert.ok(row, 'list must return the row');
    assert.equal(row.caption, newCaption);
  });
});

// ── Hero + caption coexistence ────────────────────────────────────

describe('PATCH — hero and caption are independent fields', () => {
  it('updating only caption does not change is_hero', async () => {
    const id = seedPhoto();
    // Pin hero first
    await itemPATCH(patchReq(SLUG, id, { is_hero: true }), ctxItem(SLUG, id));
    // Then patch caption
    await itemPATCH(patchReq(SLUG, id, { caption: 'now with caption' }), ctxItem(SLUG, id));

    const row = testDb.prepare('SELECT is_hero, caption FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row.is_hero, 1, 'hero pin must survive a caption-only patch');
    assert.equal(row.caption, 'now with caption');
  });
});
