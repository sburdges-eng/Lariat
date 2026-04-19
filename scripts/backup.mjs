#!/usr/bin/env node
// Backup lariat.db (and WAL/SHM if present) to backups/ with a timestamp.
//
// Usage:
//   npm run backup
//   node scripts/backup.mjs
//
// Output:
//   backups/lariat_2026-04-15_14-30.db
//   backups/lariat_2026-04-15_14-30.db-wal   (if present)
//   backups/lariat_2026-04-15_14-30.db-shm   (if present)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const BACKUPS = path.join(ROOT, 'backups');

const DB_NAME = 'lariat.db';
const EXTENSIONS = ['', '-wal', '-shm'];

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function main() {
  const dbPath = path.join(DATA, DB_NAME);
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath} — nothing to back up.`);
    process.exit(1);
  }

  if (!fs.existsSync(BACKUPS)) {
    fs.mkdirSync(BACKUPS, { recursive: true });
  }

  const ts = stamp();
  let copied = 0;

  for (const ext of EXTENSIONS) {
    const src = path.join(DATA, DB_NAME + ext);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(BACKUPS, `lariat_${ts}.db${ext}`);
    fs.copyFileSync(src, dest);
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`  ✓ ${path.relative(ROOT, dest)}  (${kb} KB)`);
    copied++;
  }

  console.log(`\nBackup complete — ${copied} file(s) saved to backups/`);
}

main();
