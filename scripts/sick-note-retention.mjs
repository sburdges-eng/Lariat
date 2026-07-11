// scripts/sick-note-retention.mjs
// Report-only: identifies sick-note documents past the 2-year retention window.
// NEVER deletes — deletion is a PIN-gated one-click action in the native app (audit P0-6).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { resolveDataDir } from '../lib/dataDir.ts';

export const RETENTION_DAYS = 730;

export function cutoffISO(now = new Date(), days = RETENTION_DAYS) {
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

export function runRetentionReport({ now = new Date(), dbPath, dataDir } = {}) {
  const dir = dataDir ?? resolveDataDir();
  const resolvedDbPath = dbPath ?? path.join(dir, 'lariat.db');
  // A wholly-missing DB file (fresh install, cron running before first boot) must
  // report zero rather than throw SQLITE_CANTOPEN — this job is report-only and
  // is expected to run unattended on a cron rail.
  if (!fs.existsSync(resolvedDbPath)) {
    return { cutoff: cutoffISO(now), retentionDays: RETENTION_DAYS, overdueCount: 0, overdue: [] };
  }
  const db = new Database(resolvedDbPath, { readonly: true });
  try {
    const cutoff = cutoffISO(now);
    const hasTable = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='sick_note_documents'`).get();
    if (!hasTable) return { cutoff, retentionDays: RETENTION_DAYS, overdueCount: 0, overdue: [] };
    // Report-only job: a malformed uploaded_at string-compares against the ISO
    // cutoff and can land on either side, surfacing bad rows for a human to
    // inspect. This intentionally differs from the native repo's fail-open
    // polarity (SickNoteRetention.isOverdue) — no behavior change here.
    const rows = db.prepare(
      `SELECT id, report_id, location_id, file_path, uploaded_at
         FROM sick_note_documents WHERE uploaded_at <= ? ORDER BY uploaded_at`).all(cutoff);
    const overdue = rows.map((r) => ({
      ...r,
      present: fs.existsSync(path.join(dir, 'uploads', r.file_path)),
    }));
    return { cutoff, retentionDays: RETENTION_DAYS, overdueCount: overdue.length, overdue };
  } finally {
    db.close();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runRetentionReport();
  // Durable evidence via run-job's ingest_runs bookkeeping + captured stdout.
  console.log(JSON.stringify({
    kind: 'sick-note-retention', retention_days: r.retentionDays, cutoff: r.cutoff,
    overdue: r.overdueCount, missing_files: r.overdue.filter((d) => !d.present).length,
  }));
  process.exit(0);
}
