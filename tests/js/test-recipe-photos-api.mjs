#!/usr/bin/env node
// Integration tests for /api/recipes/[slug]/photos and
// /api/recipes/[slug]/photos/[id]{,/raw}.
//
// Pattern mirrors test-recipes-slug-api.mjs:
//   - sandboxed cwd so data/uploads/recipes/ lands in a tmp dir and
//     the file-audit jsonl is sandboxed too
//   - in-memory SQLite via setDbPathForTest(':memory:')
//   - direct invocation of the App Router handlers with `Request`
//     objects — no live server
//
// Coverage:
//   - POST without PIN cookie -> 401/403 (PIN gate)
//   - POST with PIN + 87-byte PNG -> 201, file lands on disk, row in
//     recipe_photos with correct mime/size_bytes/cook_id
//   - POST with text/plain -> 415
//   - POST with empty body -> 400
//   - POST exceeding MAX_PHOTO_BYTES -> 413
//   - GET list returns the row; soft-deleted rows are hidden
//   - DELETE soft-deletes; the file stays on disk (audit trail)
//   - GET raw 200 with correct content-type before delete
//   - GET raw 404 after delete
//
// Run: node --experimental-strip-types --test tests/js/test-recipe-photos-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

// Force PIN gate ON for these tests; with LARIAT_PIN_SECRET unset, the
// legacy unsigned 'lariat_pin_ok=1' cookie is accepted by hasPinCookie.
const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

// chdir to a sandbox BEFORE importing lib/db so DB_PATH (captured at
// module load) resolves under TMP_DIR and storePhoto writes under
// `${TMP_DIR}/data/uploads/recipes/`.
const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipe-photos-api-'));
process.chdir(TMP_DIR);

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const testDb = db.getDb();

const collection = await import('../../app/api/recipes/[slug]/photos/route.js');
const item = await import('../../app/api/recipes/[slug]/photos/[id]/route.js');
const raw = await import('../../app/api/recipes/[slug]/photos/[id]/raw/route.js');

const { GET: listGET, POST: collectionPOST } = collection;
const { DELETE: itemDELETE } = item;
const { GET: rawGET } = raw;

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

// ── Helpers ──────────────────────────────────────────────────────

// Minimal 1×1 transparent PNG payload (~67 bytes including signature).
// Real PNG signature so any future content sniff stays happy. We pad
// caller-side to hit an explicit 87-byte total because the task spec
// names that size in the acceptance criteria.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, // width=1
  0x00, 0x00, 0x00, 0x01, // height=1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, ...
  0x1f, 0x15, 0xc4, 0x89, // IHDR CRC
  0x00, 0x00, 0x00, 0x0d, // IDAT length
  0x49, 0x44, 0x41, 0x54, // "IDAT"
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05,
  0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4e, 0x44, // "IEND"
  0xae, 0x42, 0x60, 0x82, // IEND CRC
]);

// Pad to exactly 87 bytes so the spec's "87-byte PNG" line up.
function pngFixture() {
  const target = 87;
  if (PNG_SIGNATURE.byteLength >= target) return PNG_SIGNATURE.subarray(0, target);
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(target - PNG_SIGNATURE.byteLength)]);
}

function makeForm({ file, mime, filename, caption, cookId } = {}) {
  const form = new FormData();
  if (file !== null && file !== undefined) {
    const blob = new Blob([file], { type: mime });
    form.append('file', blob, filename || 'photo.png');
  }
  if (caption != null) form.append('caption', caption);
  if (cookId != null) form.append('cook_id', cookId);
  return form;
}

function postReq({ form, withAuth = true, cookieValue } = {}) {
  const headers = {};
  if (cookieValue !== undefined) headers.cookie = `lariat_pin_ok=${cookieValue}`;
  else if (withAuth) headers.cookie = 'lariat_pin_ok=1';
  return new Request(`http://localhost/api/recipes/${SLUG}/photos`, {
    method: 'POST',
    headers,
    body: form,
  });
}

function getReq() {
  return new Request(`http://localhost/api/recipes/${SLUG}/photos`);
}

function deleteReq(id, { withAuth = true } = {}) {
  const headers = {};
  if (withAuth) headers.cookie = 'lariat_pin_ok=1';
  return new Request(`http://localhost/api/recipes/${SLUG}/photos/${id}`, {
    method: 'DELETE',
    headers,
  });
}

function rawReq(id) {
  return new Request(`http://localhost/api/recipes/${SLUG}/photos/${id}/raw`);
}

const ctxSlug = { params: { slug: SLUG } };
function ctxItem(id) { return { params: { slug: SLUG, id: String(id) } }; }

// ── PIN gate ─────────────────────────────────────────────────────

describe('POST /api/recipes/[slug]/photos — PIN gate', () => {
  it('rejects request without PIN cookie', async () => {
    const res = await collectionPOST(
      postReq({ form: makeForm({ file: pngFixture(), mime: 'image/png' }), withAuth: false }),
      ctxSlug,
    );
    assert.ok(res.status === 401 || res.status === 403,
      `expected 401/403 for missing PIN, got ${res.status}`);

    const rows = testDb.prepare('SELECT COUNT(*) AS n FROM recipe_photos').get();
    assert.equal(rows.n, 0, 'no row should be inserted without auth');
  });
});

// ── Happy path: POST + on-disk + DB row ──────────────────────────

describe('POST /api/recipes/[slug]/photos — happy path', () => {
  it('writes file to disk and row to DB on 87-byte PNG', async () => {
    const buf = pngFixture();
    assert.equal(buf.byteLength, 87, 'fixture must be exactly 87 bytes');

    const res = await collectionPOST(
      postReq({
        form: makeForm({
          file: buf,
          mime: 'image/png',
          filename: 'plated.png',
          cookId: 'cook-42',
        }),
      }),
      ctxSlug,
    );
    assert.equal(res.status, 201, `expected 201, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.mime, 'image/png');
    assert.equal(body.size_bytes, 87);

    const row = testDb
      .prepare('SELECT * FROM recipe_photos WHERE id = ?')
      .get(body.id);
    assert.ok(row, 'DB row should exist after upload');
    assert.equal(row.mime, 'image/png');
    assert.equal(row.size_bytes, 87);
    assert.equal(row.uploaded_by_cook_id, 'cook-42');
    assert.equal(row.recipe_slug, SLUG);
    assert.equal(row.location_id, 'default');

    const st = fs.statSync(row.stored_path);
    assert.ok(st.isFile(), 'photo file should exist on disk');
    assert.equal(st.size, 87, 'on-disk size should match the upload bytes');
  });
});

// ── Validation errors ────────────────────────────────────────────

describe('POST /api/recipes/[slug]/photos — validation', () => {
  it('returns 415 for unsupported mime', async () => {
    const res = await collectionPOST(
      postReq({
        form: makeForm({
          file: Buffer.from('hello world'),
          mime: 'text/plain',
          filename: 'note.txt',
        }),
      }),
      ctxSlug,
    );
    assert.equal(res.status, 415, `expected 415, got ${res.status}`);
    const rows = testDb.prepare('SELECT COUNT(*) AS n FROM recipe_photos').get();
    assert.equal(rows.n, 0, 'no row should be inserted on 415');
  });

  it('returns 400 for empty file body', async () => {
    const res = await collectionPOST(
      postReq({
        form: makeForm({
          file: Buffer.alloc(0),
          mime: 'image/png',
          filename: 'empty.png',
        }),
      }),
      ctxSlug,
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  it('returns 413 when payload exceeds MAX_PHOTO_BYTES', async () => {
    const lib = await import('../../lib/recipePhotos.ts');
    const oversized = Buffer.alloc(lib.MAX_PHOTO_BYTES + 1, 0xab);
    // Stamp the PNG signature on the front so the mime check passes
    // and we reach the size check.
    PNG_SIGNATURE.copy(oversized, 0);
    const res = await collectionPOST(
      postReq({
        form: makeForm({
          file: oversized,
          mime: 'image/png',
          filename: 'huge.png',
        }),
      }),
      ctxSlug,
    );
    assert.equal(res.status, 413, `expected 413, got ${res.status}`);
  });
});

// ── GET list + soft-delete visibility ─────────────────────────────

describe('GET /api/recipes/[slug]/photos', () => {
  it('returns the row after upload and hides soft-deleted rows', async () => {
    // Upload one photo
    const post = await collectionPOST(
      postReq({
        form: makeForm({ file: pngFixture(), mime: 'image/png', filename: 'a.png' }),
      }),
      ctxSlug,
    );
    const { id } = await post.json();

    const listed = await listGET(getReq(), ctxSlug);
    const listedBody = await listed.json();
    assert.equal(listedBody.photos.length, 1);
    assert.equal(listedBody.photos[0].id, id);

    // Soft-delete via DELETE handler
    const del = await itemDELETE(deleteReq(id), ctxItem(id));
    assert.equal(del.status, 200);

    const listed2 = await listGET(getReq(), ctxSlug);
    const listed2Body = await listed2.json();
    assert.equal(listed2Body.photos.length, 0, 'soft-deleted row must not be listed');
  });
});

// ── DELETE soft-deletes; file stays on disk ──────────────────────

describe('DELETE /api/recipes/[slug]/photos/[id]', () => {
  it('soft-deletes the row but leaves the file on disk (audit trail)', async () => {
    const post = await collectionPOST(
      postReq({
        form: makeForm({ file: pngFixture(), mime: 'image/png', filename: 'b.png' }),
      }),
      ctxSlug,
    );
    const { id } = await post.json();

    const row = testDb.prepare('SELECT stored_path FROM recipe_photos WHERE id = ?').get(id);
    assert.ok(fs.existsSync(row.stored_path), 'file should exist pre-delete');

    const del = await itemDELETE(deleteReq(id), ctxItem(id));
    assert.equal(del.status, 200);

    // Row is soft-deleted (deleted_at set) but still present.
    const after = testDb.prepare('SELECT deleted_at FROM recipe_photos WHERE id = ?').get(id);
    assert.ok(after && after.deleted_at, 'deleted_at should be stamped');

    // File on disk MUST remain — soft-delete is audit-preserving.
    assert.ok(fs.existsSync(row.stored_path), 'file must stay on disk after soft-delete');
  });

  it('returns 404 when the id is missing or already soft-deleted', async () => {
    const res = await itemDELETE(deleteReq(99999), ctxItem(99999));
    assert.equal(res.status, 404);
  });
});

// ── GET raw — 200 before delete, 404 after ───────────────────────

describe('GET /api/recipes/[slug]/photos/[id]/raw', () => {
  it('200s with correct content-type before delete; 404s after', async () => {
    const post = await collectionPOST(
      postReq({
        form: makeForm({ file: pngFixture(), mime: 'image/png', filename: 'c.png' }),
      }),
      ctxSlug,
    );
    const { id } = await post.json();

    const before = await rawGET(rawReq(id), ctxItem(id));
    assert.equal(before.status, 200);
    assert.equal(before.headers.get('content-type'), 'image/png');

    await itemDELETE(deleteReq(id), ctxItem(id));

    const afterDel = await rawGET(rawReq(id), ctxItem(id));
    assert.equal(afterDel.status, 404, 'raw GET must 404 after soft-delete');
  });
});
