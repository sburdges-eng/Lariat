// lib/dataDir.ts
//
// Single source of truth for resolving Lariat's on-disk data root.
//
// Background: lib/db.ts, lib/data.ts, lib/peerKeypair.ts, and
// scripts/weekly-settlement-digest.mjs all duplicated the same
// `LARIAT_DATA_DIR ? resolve : cwd/data` block. That worked but split
// the convention across four call sites — any drift would silently
// produce a split-brain (SQLite in dir A, JSON cache in dir B).
//
// Resolution rules (frozen — do NOT change without coordinating
// migrations in every caller):
//
//   1. Honor LARIAT_DATA_DIR when set (absolute or relative; we
//      path.resolve() it so a relative value resolves against cwd
//      at the call site).
//   2. Fall back to `<process.cwd()>/data` otherwise.
//
// `resolveDataDir()` reads `process.env.LARIAT_DATA_DIR` at every call
// rather than capturing it at module-load time. That lets test
// harnesses set the env var after import without juggling cache-busting
// dynamic imports (the pattern in test-data-cache-data-dir.mjs still
// works the same way — env-set then `?cb=` import — but new tests can
// also just toggle env between calls).
//
// Imports: `node:path` only. Must not depend on any other lib/ module
// so it stays safe to import from lib/db.ts (which is the root of the
// import graph).

import path from 'node:path';

export function resolveDataDir(): string {
  const env = process.env.LARIAT_DATA_DIR;
  if (env && env.trim()) return path.resolve(env);
  return path.join(process.cwd(), 'data');
}

/**
 * Resolve a path relative to the data dir. Convenience for callers that
 * want `<dataDir>/cache` or `<dataDir>/exports/X.html` without writing
 * the join every time.
 */
export function dataPath(...segments: string[]): string {
  return path.join(resolveDataDir(), ...segments);
}
