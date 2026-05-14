#!/usr/bin/env node
// Tests for scripts/cleanup-recipe-photos.mjs — retention sweep.
//
// Spec:
//   - Targets recipe_photos rows where deleted_at is older than 30 days.
//   - Dry-run mode (--dry-run) makes NO changes — no file delete, no
//     row delete.
//   - Live mode hard-deletes both the file on disk and the DB row.
//   - Idempotent: rows whose stored_path no longer exists are skipped
//     (still row-deleted) without throwing.
//   - Recent soft-deletes (< 30 days) are left alone.
//   - Live rows (deleted_at IS NULL) are never touched.
//
// Run: node --experimental-strip-types --test tests/js/test-cleanup-recipe-photos.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cleanup-photos-'));
process.chdir(TMP_DIR);
fs.mkdirSync(path.join(TMP_DIR, 'data', 'uploads', 'recipes'), { recursive: true });

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const testDb = db.getDb();

// Defer importing the script under test until each subtest so we can
// reset state between runs; the module has a runIfMain at the bottom
// but exports its functions for direct invocation under the tests.
const cleanup = await import('../../scripts/cleanup-recipe-photos.mjs');

after(() => {
  db.setDbPathForTest(null);
  process.chdir(ORIGINAL_CWD);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM recipe_photos;');
});

function seedRow({
  slug = 'test-recipe',
  location = 'default',
  storedPath,
  deletedAt = null,
} = {}) {
  const stmt = testDb.prepare(
    `INSERT INTO recipe_photos
       (recipe_slug, location_id, original_name, stored_path, mime,
        size_bytes, deleted_at)
     VALUES (?, ?, 'x.png', ?, 'image/png', 1, ?)`,
  );
  const r = stmt.run(slug, location, storedPath, deletedAt);
  return r.lastInsertRowid;
}

function writeFixture(name, bytes = Buffer.from('p')) {
  const abs = path.join(TMP_DIR, 'data', 'uploads', 'recipes', name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return abs;
}

// Pretty SQL-format datetime helper for deleted_at columns.
function sqlDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── Dry-run ──────────────────────────────────────────────────────

describe('cleanup-recipe-photos — dry-run', () => {
  it('does not delete file or row in dry-run mode', async () => {
    const file = writeFixture('test-recipe/dry-run.png');
    const id = seedRow({ storedPath: file, deletedAt: sqlDate(45) });

    const summary = await cleanup.runCleanup({ dryRun: true, retentionDays: 30 });

    assert.equal(summary.candidates, 1, 'one candidate row');
    assert.equal(summary.deletedFiles, 0, 'dry-run must not touch files');
    assert.equal(summary.deletedRows, 0, 'dry-run must not delete rows');

    assert.ok(fs.existsSync(file), 'file must still exist in dry-run');
    const row = testDb.prepare('SELECT id FROM recipe_photos WHERE id = ?').get(id);
    assert.ok(row, 'row must still exist in dry-run');
  });
});

// ── Live mode ─────────────────────────────────────────────────────

describe('cleanup-recipe-photos — live mode', () => {
  it('hard-deletes file and row when deleted_at is older than retention', async () => {
    const file = writeFixture('test-recipe/old.png');
    const id = seedRow({ storedPath: file, deletedAt: sqlDate(45) });

    const summary = await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    assert.equal(summary.candidates, 1);
    assert.equal(summary.deletedFiles, 1);
    assert.equal(summary.deletedRows, 1);

    assert.ok(!fs.existsSync(file), 'file must be removed');
    const row = testDb.prepare('SELECT id FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row, undefined, 'row must be removed');
  });

  it('leaves recent soft-deletes alone (within retention window)', async () => {
    const file = writeFixture('test-recipe/recent.png');
    const id = seedRow({ storedPath: file, deletedAt: sqlDate(15) });

    const summary = await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    assert.equal(summary.candidates, 0);
    assert.equal(summary.deletedFiles, 0);
    assert.equal(summary.deletedRows, 0);

    assert.ok(fs.existsSync(file), 'recent file must remain');
    const row = testDb.prepare('SELECT id FROM recipe_photos WHERE id = ?').get(id);
    assert.ok(row, 'recent row must remain');
  });

  it('never touches live rows (deleted_at IS NULL)', async () => {
    const file = writeFixture('test-recipe/live.png');
    const id = seedRow({ storedPath: file, deletedAt: null });

    const summary = await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    assert.equal(summary.candidates, 0);

    assert.ok(fs.existsSync(file), 'live file must remain');
    const row = testDb.prepare('SELECT id FROM recipe_photos WHERE id = ?').get(id);
    assert.ok(row, 'live row must remain');
  });

  it('idempotent — handles rows whose file is already gone', async () => {
    // Seed an old soft-deleted row but never write the file.
    const id = seedRow({
      storedPath: path.join(TMP_DIR, 'data', 'uploads', 'recipes', 'test-recipe', 'missing.png'),
      deletedAt: sqlDate(45),
    });

    const summary = await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    assert.equal(summary.candidates, 1);
    assert.equal(summary.deletedFiles, 0, 'nothing on disk to delete');
    // The row still hard-deletes (idempotent: skip-file ≠ skip-row).
    assert.equal(summary.deletedRows, 1, 'row must still be removed');
    assert.equal(summary.skippedMissing, 1, 'missing-file skip counted');

    const row = testDb.prepare('SELECT id FROM recipe_photos WHERE id = ?').get(id);
    assert.equal(row, undefined, 'row must be removed even when file is missing');
  });

  it('a second run is a no-op', async () => {
    const file = writeFixture('test-recipe/repeat.png');
    seedRow({ storedPath: file, deletedAt: sqlDate(45) });

    await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    const second = await cleanup.runCleanup({ dryRun: false, retentionDays: 30 });
    assert.equal(second.candidates, 0, 'second run must find nothing');
    assert.equal(second.deletedFiles, 0);
    assert.equal(second.deletedRows, 0);
  });
});
