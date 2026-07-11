#!/usr/bin/env node
// Backup integrity + restore drill (audit 2026-07-10 P0-5). The user-facing
// `npm run backup` must: resolve the REAL data dir (LARIAT_DATA_DIR, not a
// hardcoded repo path), take a consistent online snapshot, include the
// off-tree uploads (recipe photos + sick-note PHI), verify the copy, and be
// restore-testable. A backup that can't be restored isn't a backup.
//
// Run: node --experimental-strip-types --test tests/js/test-backup.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const { runBackup, runVerify, resolveBackupTargets } = await import('../../scripts/backup.mjs');

let work;
let dataDir;
let backupRoot;

function seedDataDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'lariat.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE locations (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE audit_events (id INTEGER PRIMARY KEY, entity TEXT);
    INSERT INTO locations VALUES ('default', 'Main');
    INSERT INTO audit_events (entity) VALUES ('seed');
  `);
  db.close();
  // Off-tree uploads: a recipe photo and a sick-note PHI file.
  fs.mkdirSync(path.join(dir, 'uploads', 'recipes', 'birria'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'uploads', 'recipes', 'birria', 'a.jpg'), 'JPEGDATA');
  fs.mkdirSync(path.join(dir, 'uploads', 'sick-notes', '7'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'uploads', 'sick-notes', '7', 'note.pdf'), 'PDFDATA');
  // Out-of-backup media key (outside uploads/) — only its fingerprint is recorded.
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'keys', 'sick-note-media.json'),
    JSON.stringify({
      v: 1,
      key_id: '404142434445464748494a4b4c4d4e4f',
      key: Buffer.alloc(32, 7).toString('base64'),
      created_at: '2026-07-10T00:00:00.000Z',
    }),
  );
}

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-backup-test-'));
  dataDir = path.join(work, 'data');
  backupRoot = path.join(work, 'backups');
  seedDataDir(dataDir);
});

after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe('resolveBackupTargets', () => {
  it('honors LARIAT_DATA_DIR instead of a hardcoded repo path', () => {
    const prev = process.env.LARIAT_DATA_DIR;
    process.env.LARIAT_DATA_DIR = dataDir;
    try {
      const t = resolveBackupTargets();
      assert.equal(t.dataDir, path.resolve(dataDir));
      assert.equal(t.dbPath, path.join(path.resolve(dataDir), 'lariat.db'));
    } finally {
      if (prev === undefined) delete process.env.LARIAT_DATA_DIR;
      else process.env.LARIAT_DATA_DIR = prev;
    }
  });
});

describe('runBackup', () => {
  it('snapshots the DB, includes uploads, and writes checksums + manifest', async () => {
    const { dest } = await runBackup({ dbPath: path.join(dataDir, 'lariat.db'), dataDir, backupRoot });

    assert.ok(fs.existsSync(path.join(dest, 'lariat.db')), 'db snapshot present');
    // consistent snapshot: opens clean and passes integrity_check
    const copy = new Database(path.join(dest, 'lariat.db'), { readonly: true });
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.prepare('SELECT COUNT(*) n FROM locations').get().n, 1);
    copy.close();

    assert.ok(fs.existsSync(path.join(dest, 'uploads', 'recipes', 'birria', 'a.jpg')), 'recipe photo copied');
    assert.ok(fs.existsSync(path.join(dest, 'uploads', 'sick-notes', '7', 'note.pdf')), 'sick-note PHI copied');
    assert.ok(fs.existsSync(path.join(dest, 'SHA256SUMS')), 'checksums written');
    assert.ok(fs.existsSync(path.join(dest, 'manifest.json')), 'manifest written');

    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
    assert.equal(manifest.source_data_dir, path.resolve(dataDir));
    assert.ok(manifest.includes_uploads, 'manifest records uploads were included');

    // Sick-note media key fingerprint (P0-6): the key file itself is NOT
    // copied into the backup (it lives outside uploads/), only its
    // fingerprint is recorded so a restore can detect a key mismatch.
    assert.match(manifest.sick_note_key_fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(
      manifest.sick_note_key_fingerprint,
      crypto.createHash('sha256').update(Buffer.alloc(32, 7)).digest('hex').slice(0, 16),
    );
  });

  it('fails loudly instead of reporting success when the DB is missing', async () => {
    await assert.rejects(
      () => runBackup({ dbPath: path.join(dataDir, 'nope.db'), dataDir, backupRoot }),
      /no database|not found/i,
    );
  });
});

describe('runVerify — the restore drill', () => {
  it('PASSES a good backup (restores + integrity + checksums + row counts)', async () => {
    const { dest } = await runBackup({ dbPath: path.join(dataDir, 'lariat.db'), dataDir, backupRoot });
    const result = await runVerify(dest);
    assert.equal(result.pass, true, JSON.stringify(result.checks, null, 2));
  });

  it('FAILS when the backed-up DB is corrupted (tamper detection)', async () => {
    const { dest } = await runBackup({ dbPath: path.join(dataDir, 'lariat.db'), dataDir, backupRoot });
    fs.writeFileSync(path.join(dest, 'lariat.db'), 'this is not a sqlite database');
    const result = await runVerify(dest);
    assert.equal(result.pass, false, 'corruption must be caught by the restore drill');
  });
});
