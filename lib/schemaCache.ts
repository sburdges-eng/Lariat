// lib/schemaCache.ts
//
// PRAGMA table_info cache for lib/syncApply.ts's getTableColumns.
// Extracted to its own module so lib/db.ts::initSchema can invalidate
// it after every schema mutation without creating a circular import
// (db.ts → syncApply.ts → syncFeed.ts → db.ts).
//
// Audit H2 (2026-05-14): under HMR / test harnesses, initSchema runs
// CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN on every DB
// acquisition. Without invalidation, the applier's cached column set
// silently drops newly-added columns from INSERTs forever.
//
// Audit H8: caching the negative case (table doesn't exist) prevents
// a peer flooding ops for a missing table from rerunning PRAGMA every
// tick.
//
// Imports: none beyond what callers carry. Pure state container.

import type { Database as DB } from 'better-sqlite3';

const COLUMNS_CACHE = new Map<string, ReadonlySet<string>>();
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export function getTableColumnsCached(
  db: DB,
  tableName: string,
): ReadonlySet<string> | null {
  const cached = COLUMNS_CACHE.get(tableName);
  if (cached !== undefined) {
    return cached.size === 0 ? null : cached;
  }
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    if (!rows.length) {
      COLUMNS_CACHE.set(tableName, EMPTY_SET);
      return null;
    }
    const set = new Set(rows.map((r) => r.name));
    COLUMNS_CACHE.set(tableName, set);
    return set;
  } catch {
    return null;
  }
}

/**
 * Invalidate the entire schema cache. Called from lib/db.ts initSchema
 * after every migration pass so column-add ALTERs propagate without a
 * process restart. Tests also use this directly.
 */
export function clearSchemaCache(): void {
  COLUMNS_CACHE.clear();
}
