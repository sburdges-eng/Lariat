#!/usr/bin/env node
// Hard-delete soft-deleted recipe_photos older than the retention window.
//
// Soft-delete (DELETE /api/recipes/:slug/photos/:id) only stamps
// `deleted_at` — files stay on disk and the row stays in the table.
// That preserves audit trail / undo for a window. After the window,
// retention housekeeping runs here:
//
//   - Find rows where deleted_at is older than RETENTION_DAYS days.
//   - Remove the file from data/uploads/recipes/ (if it still exists).
//   - DELETE the row from recipe_photos.
//
// Idempotent: rows whose stored_path no longer exists still row-delete
// (the file was already cleaned up out-of-band). Recent soft-deletes
// (< window) and live rows (deleted_at IS NULL) are never touched.
//
// Usage:
//   node scripts/cleanup-recipe-photos.mjs           # live mode
//   node scripts/cleanup-recipe-photos.mjs --dry-run # report, no changes
//   npm run cleanup:recipe-photos
//   npm run cleanup:recipe-photos -- --dry-run

import { unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from '../lib/db.ts';

const RETENTION_DAYS = 30;

/**
 * Run one sweep. Returns a summary object suitable for printing or for
 * test assertions:
 *   {
 *     candidates: <rows matched by the retention filter>,
 *     deletedFiles: <files removed from disk>,
 *     deletedRows: <DB rows removed>,
 *     skippedMissing: <candidates whose file was already gone>,
 *     dryRun: <boolean>,
 *   }
 *
 * In dry-run mode, deletedFiles / deletedRows are 0 — the sweep only
 * reports what *would* be removed.
 */
export async function runCleanup({ dryRun = false, retentionDays = RETENTION_DAYS } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const candidates = db
    .prepare(
      `SELECT id, stored_path
         FROM recipe_photos
        WHERE deleted_at IS NOT NULL
          AND deleted_at < ?`,
    )
    .all(cutoff);

  let deletedFiles = 0;
  let deletedRows = 0;
  let skippedMissing = 0;

  if (dryRun) {
    // Count what would be done; touch nothing.
    for (const row of candidates) {
      if (!existsSync(row.stored_path)) skippedMissing += 1;
    }
    return {
      candidates: candidates.length,
      deletedFiles,
      deletedRows,
      skippedMissing,
      dryRun: true,
    };
  }

  const deleteStmt = db.prepare('DELETE FROM recipe_photos WHERE id = ?');
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      if (existsSync(row.stored_path)) {
        try {
          unlinkSync(row.stored_path);
          deletedFiles += 1;
        } catch {
          // Surface skipped — but row delete still proceeds. Leaving
          // the row behind would just mean we re-try forever.
          skippedMissing += 1;
        }
      } else {
        skippedMissing += 1;
      }
      const r = deleteStmt.run(row.id);
      if (r.changes > 0) deletedRows += 1;
    }
  });
  tx(candidates);

  return {
    candidates: candidates.length,
    deletedFiles,
    deletedRows,
    skippedMissing,
    dryRun: false,
  };
}

// Run when invoked as a script (not when imported under tests).
const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  runCleanup({ dryRun, retentionDays: RETENTION_DAYS })
    .then((s) => {
      const mode = s.dryRun ? '[dry-run] ' : '';
      console.log(
        `${mode}candidates=${s.candidates} files=${s.deletedFiles} rows=${s.deletedRows} skipped=${s.skippedMissing}`,
      );
    })
    .catch((err) => {
      console.error('cleanup failed:', err);
      process.exit(1);
    });
}
