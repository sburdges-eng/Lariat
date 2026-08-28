/**
 * SQLite connection: path resolution, pragmas, and the process-wide
 * cached handle. `getDb()` runs {@link initSchema} on first open.
 */
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { resolveDataDir } from '../dataDir.ts';
import { initSchema } from './schema/core.ts';

const DB_DIR = resolveDataDir();
const DB_PATH = path.join(DB_DIR, 'lariat.db');

/**
 * Test-only: returns the DB path this module resolved at load time.
 * tests/js/test-db-data-dir.mjs cache-busts THIS module (not the lib/db.ts
 * barrel — a re-export there keeps hitting the ESM module cache) to
 * recompute DB_PATH against the current LARIAT_DATA_DIR.
 * Production code never calls this.
 */
export function _resolveDbPathForTest(): string {
  return DB_PATH;
}

let _db: DB | null = null;
let _dbPathOverride: string | null = null;

/**
 * Test-only hook: point {@link getDb} at an arbitrary SQLite path (or
 * ':memory:') so a test can run against a scratch database without
 * poisoning `data/lariat.db`. Closes the current cached connection so
 * the next `getDb()` call reopens against the new path.
 *
 * Production code never calls this. Pass `null` to revert.
 */
export function setDbPathForTest(p: string | null): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
  _dbPathOverride = p;
}

export function getDb(): DB {
  if (_db) return _db;
  const target = _dbPathOverride ?? DB_PATH;
  // Only create the default data/ dir when using the production path;
  // tests using :memory: or a tmp file manage their own directory.
  if (target === DB_PATH && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  _db = new Database(target);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // ACID-D: fsync WAL on every commit so financial/personal data survives
  // power loss. ~1-5ms write penalty on SSD; imperceptible at BOH write rates.
  _db.pragma('synchronous = FULL');
  // WAL auto-checkpoint: passive checkpoint every 1000 pages (~4MB).
  // Prevents unbounded WAL growth during heavy write bursts.
  _db.pragma('wal_autocheckpoint = 1000');
  initSchema(_db);
  return _db;
}

export const DB_FILE = DB_PATH;
