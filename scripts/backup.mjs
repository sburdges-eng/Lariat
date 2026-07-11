#!/usr/bin/env node
// Verified, restore-tested backup of the live Lariat data dir (audit 2026-07-10
// P0-5). The previous version hardcoded <repo>/data/lariat.db, ignored
// LARIAT_DATA_DIR (which the desktop wrapper sets), copied the db + -wal + -shm
// as three separate, racing filesystem ops, verified nothing, and left out the
// off-tree uploads — so on a relocated install it could print "Backup complete"
// over a stale seed DB. This version:
//
//   • resolves the SAME data dir the app uses (lib/dataDir.ts SSOT);
//   • takes ONE consistent online snapshot via better-sqlite3's backup API —
//     safe even mid-write on a WAL database (no torn -wal/-shm sidecars);
//   • includes the off-tree uploads (recipe photos + sick-note PHI) and the
//     audit JSONL dir;
//   • runs PRAGMA integrity_check on the copy and refuses to report success
//     if it fails;
//   • writes SHA256SUMS + manifest.json;
//   • ships a restore drill (`verify`) that restores to a scratch dir and runs
//     integrity_check + foreign_key_check + a has-data spot-check.
//
// Usage:
//   npm run backup                    # take a verified backup
//   npm run backup -- verify <DIR>    # restore drill against a backup dir
//
// Env: LARIAT_DATA_DIR (source, honored via the SSOT), LARIAT_BACKUP_DIR
// (destination root; defaults to <repo>/backups).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveDataDir } from '../lib/dataDir.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function utcStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/** Resolve the source db + dest root the SAME way the app resolves its data. */
export function resolveBackupTargets() {
  const dataDir = resolveDataDir();
  const dbPath = path.join(dataDir, 'lariat.db');
  const backupRoot = process.env.LARIAT_BACKUP_DIR
    ? path.resolve(process.env.LARIAT_BACKUP_DIR)
    : path.join(ROOT, 'backups');
  return { dataDir, dbPath, backupRoot };
}

/**
 * Take a verified backup. Params default to the resolved targets so the CLI
 * and tests share one path. Throws (never reports success) if the DB is
 * missing or the snapshot fails integrity_check.
 */
export async function runBackup({ dbPath, dataDir, backupRoot, stamp } = {}) {
  const targets = resolveBackupTargets();
  dbPath = dbPath ?? targets.dbPath;
  dataDir = dataDir ?? targets.dataDir;
  backupRoot = backupRoot ?? targets.backupRoot;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`No database found at ${dbPath} — nothing to back up.`);
  }

  const ts = stamp ?? utcStamp();
  let dest = path.join(backupRoot, ts);
  if (fs.existsSync(dest)) dest = `${dest}-${process.pid}`;
  fs.mkdirSync(dest, { recursive: true });

  // 1. Consistent online snapshot — safe even mid-write on a WAL database.
  const src = new Database(dbPath, { readonly: true });
  try {
    await src.backup(path.join(dest, 'lariat.db'));
  } finally {
    src.close();
  }

  // 2. Off-tree assets: uploads (recipe photos + sick-note PHI) and audit JSONL.
  let includesUploads = false;
  const uploadsSrc = path.join(dataDir, 'uploads');
  if (fs.existsSync(uploadsSrc)) {
    fs.cpSync(uploadsSrc, path.join(dest, 'uploads'), { recursive: true });
    includesUploads = true;
  }
  let includesAudit = false;
  const auditSrc = path.join(dataDir, 'audit');
  if (fs.existsSync(auditSrc)) {
    fs.cpSync(auditSrc, path.join(dest, 'audit'), { recursive: true });
    includesAudit = true;
  }

  // 3. Verify the snapshot BEFORE claiming success.
  const check = new Database(path.join(dest, 'lariat.db'), { readonly: true });
  let integrity;
  try {
    integrity = check.pragma('integrity_check', { simple: true });
  } finally {
    check.close();
  }
  if (integrity !== 'ok') {
    throw new Error(`Backup snapshot failed integrity_check: ${integrity}`);
  }

  // 4. Checksums over every file in the backup.
  const files = walkFiles(dest).filter((f) => f !== 'SHA256SUMS' && f !== 'manifest.json');
  const sums = files.map((rel) => `${sha256File(path.join(dest, rel))}  ${rel}`).join('\n') + '\n';
  fs.writeFileSync(path.join(dest, 'SHA256SUMS'), sums);

  // 4b. Sick-note media key fingerprint (P0-6). The key file lives outside
  // uploads/ and is never copied into the backup — only its fingerprint is
  // recorded, so a restore can detect a key mismatch. Best-effort: any
  // failure to read/parse the key just leaves the fingerprint null.
  let sickNoteKeyFingerprint = null;
  try {
    const keyFile = path.join(dataDir, 'keys', 'sick-note-media.json');
    if (fs.existsSync(keyFile)) {
      const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (parsed && typeof parsed.key === 'string') {
        const raw = Buffer.from(parsed.key, 'base64');
        if (raw.length === 32) {
          sickNoteKeyFingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
        }
      }
    }
  } catch {
    /* leave null — provenance metadata only */
  }

  // 5. Manifest.
  const manifest = {
    created_utc: ts,
    source_data_dir: path.resolve(dataDir),
    source_db: path.resolve(dbPath),
    integrity_check: integrity,
    includes_uploads: includesUploads,
    includes_audit: includesAudit,
    sick_note_key_fingerprint: sickNoteKeyFingerprint,
    files: files.map((rel) => ({ path: rel, bytes: fs.statSync(path.join(dest, rel)).size })),
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { dest, integrity, files, includesUploads, includesAudit };
}

/**
 * Restore drill: restore the DB copy to a scratch dir and prove it opens,
 * passes integrity_check + foreign_key_check, and holds data — plus verify
 * every file against SHA256SUMS. Returns { pass, checks }.
 */
export async function runVerify(dir) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  if (!fs.existsSync(dir)) {
    add('backup_dir', false, `not found: ${dir}`);
    return { pass: false, checks };
  }

  // 1. Checksums.
  const sumsPath = path.join(dir, 'SHA256SUMS');
  if (fs.existsSync(sumsPath)) {
    let allMatch = true;
    let detail = '';
    for (const line of fs.readFileSync(sumsPath, 'utf8').split('\n')) {
      const m = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (!m) continue;
      const fp = path.join(dir, m[2]);
      if (!fs.existsSync(fp) || sha256File(fp) !== m[1]) {
        allMatch = false;
        detail = `mismatch/missing: ${m[2]}`;
        break;
      }
    }
    add('checksums', allMatch, detail);
  } else {
    add('checksums', false, 'SHA256SUMS missing');
  }

  // 2. Restore the DB to a scratch path and check it there.
  const dbCopy = path.join(dir, 'lariat.db');
  if (fs.existsSync(dbCopy)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-restore-'));
    let db;
    try {
      const restored = path.join(tmp, 'restored.db');
      fs.copyFileSync(dbCopy, restored);
      db = new Database(restored, { readonly: true });
      const ic = db.pragma('integrity_check', { simple: true });
      add('integrity_check', ic === 'ok', String(ic));
      const fk = db.pragma('foreign_key_check');
      add('foreign_key_check', fk.length === 0, fk.length ? `${fk.length} violations` : '');
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name);
      let rows = 0;
      for (const t of tables) rows += db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
      add('has_data', rows > 0, `${rows} rows across ${tables.length} tables`);
    } catch (e) {
      add('restore', false, e instanceof Error ? e.message : String(e));
    } finally {
      db?.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    add('restore', false, 'lariat.db missing from backup');
  }

  // 3. Uploads present if the manifest says they were included.
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.includes_uploads) {
        add('uploads', fs.existsSync(path.join(dir, 'uploads')), 'manifest recorded uploads');
      }
    } catch {
      add('manifest', false, 'manifest.json unreadable');
    }
  }

  return { pass: checks.every((c) => c.ok), checks };
}

async function cli() {
  const [, , mode, arg] = process.argv;

  if (mode === 'verify') {
    if (!arg) {
      console.error('usage: npm run backup -- verify <BACKUP_DIR>');
      process.exit(2);
    }
    const { pass, checks } = await runVerify(arg);
    for (const c of checks) {
      console.info(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    console.info(pass ? 'backup verify: PASS' : 'backup verify: FAIL');
    process.exit(pass ? 0 : 1);
  }

  try {
    const { dest, includesUploads } = await runBackup();
    console.info(
      `Backup complete — verified snapshot at ${path.relative(ROOT, dest)}${includesUploads ? ' (incl. uploads)' : ''}`,
    );
    console.info(`Restore drill: npm run backup -- verify "${dest}"`);
  } catch (e) {
    console.error(`Backup FAILED: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli();
}
