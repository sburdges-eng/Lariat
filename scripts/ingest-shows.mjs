#!/usr/bin/env node
/**
 * Node wrapper for the Python shows-xlsx parser. Owns the DB transaction,
 * mirroring scripts/ingest-costing.mjs (DELETE+INSERT keyed on location_id).
 *
 * Usage: npm run ingest:shows [-- <xlsx-path>]
 *
 * Exit codes:
 *   0 ok / partial
 *   2 xlsx_not_found (from Python)
 *   3 xlsx_locked   (from Python)
 *   4 parse_error   (from Python)
 *   5 db error
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { logAuditAction } from '../lib/auditLog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARSER = path.join(__dirname, 'ingest_shows_xlsx.py');
const DEFAULT_XLSX = path.join(
  ROOT, 'drive-event-ops-dl', "Lariat_Shows_MKT_Plan(Lauren's_Ingestion_Dice).xlsx",
);

/**
 * Public test entry-point: ingest a parsed payload into the given DB handle.
 * Caller owns the DB lifecycle. Throws on programming errors (corrupt
 * payload, DB error); never throws for "Lauren wrote weird text" cases —
 * those are surfaced via dropped[] + status='partial'.
 */
export function ingestShowsFromJson(db, payload, locationId = 'default') {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ingestShowsFromJson: payload must be an object');
  }
  const { shows = [], shows_archive = [], tiktok_ideas = [], dropped = [] } = payload;

  const rowsIn =
    shows.length + shows_archive.length + tiktok_ideas.length + (dropped?.length ?? 0);

  const runInsert = db.prepare(
    `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
     VALUES ('shows', datetime('now','subsec'), 'running', ?)`,
  );
  const runId = Number(runInsert.run(rowsIn).lastInsertRowid);

  const finalize = (status, rowsOut) => {
    try {
      db.prepare(
        `UPDATE ingest_runs
            SET finished_at = datetime('now','subsec'),
                status      = ?,
                rows_out    = ?
          WHERE id = ?`,
      ).run(status, rowsOut ?? null, runId);
    } catch {
      /* never mask the real error */
    }
  };

  const summary = { shows: 0, shows_archive: 0, tiktok_ideas: 0, dropped: dropped.length };

  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM shows         WHERE location_id = ?').run(locationId);
      db.prepare('DELETE FROM shows_archive WHERE location_id = ?').run(locationId);
      db.prepare('DELETE FROM tiktok_ideas  WHERE location_id = ?').run(locationId);

      const insShow = db.prepare(`
        INSERT INTO shows
          (location_id, band_name, show_date, price, door_tix, status_json,
           source_row, ingested_at, ingest_run_id)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of shows) {
        if (!r.band_name || !r.show_date) {
          throw new Error(
            `ingestShowsFromJson: shows row missing required fields at source_row=${r.source_row}`,
          );
        }
        insShow.run(
          locationId, r.band_name, r.show_date, r.price ?? null, r.door_tix ?? null,
          JSON.stringify(r.status ?? {}), Number(r.source_row ?? 0), runId,
        );
        summary.shows += 1;
      }

      const insArc = db.prepare(`
        INSERT INTO shows_archive
          (location_id, band_name, show_date, era_year, source_row, ingested_at, ingest_run_id)
        VALUES (?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of shows_archive) {
        if (!r.band_name || !r.show_date) {
          throw new Error(
            `ingestShowsFromJson: archive row missing required fields at source_row=${r.source_row}`,
          );
        }
        insArc.run(
          locationId, r.band_name, r.show_date, r.era_year ?? null,
          Number(r.source_row ?? 0), runId,
        );
        summary.shows_archive += 1;
      }

      const insTt = db.prepare(`
        INSERT INTO tiktok_ideas
          (location_id, idea, video_content, staff_needed, props, notes,
           source_row, ingested_at, ingest_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of tiktok_ideas) {
        if (!r.idea) {
          throw new Error(
            `ingestShowsFromJson: tiktok row missing idea at source_row=${r.source_row}`,
          );
        }
        insTt.run(
          locationId, r.idea, r.video_content ?? null, r.staff_needed ?? null,
          r.props ?? null, r.notes ?? null, Number(r.source_row ?? 0), runId,
        );
        summary.tiktok_ideas += 1;
      }
    });
    tx();
  } catch (err) {
    finalize('failed', null);
    throw err;
  }

  const rowsOut = summary.shows + summary.shows_archive + summary.tiktok_ideas;
  const status = (dropped?.length ?? 0) > 0 ? 'partial' : 'ok';
  finalize(status, rowsOut);

  logAuditAction({
    action: 'shows-xlsx-ingest',
    run_id: runId,
    location_id: locationId,
    counts: summary,
    dropped: dropped.slice(0, 200), // cap for log hygiene
  });

  return summary;
}

/* ── CLI entrypoint ─────────────────────────────────────────────────── */
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const xlsx = process.argv[2] || DEFAULT_XLSX;
  let json;
  try {
    json = execFileSync('python3', [PARSER, xlsx], { encoding: 'utf8' });
  } catch (e) {
    const out = (e.stdout || '').toString();
    process.stderr.write(out || e.message);
    process.exit(e.status ?? 4);
  }
  const payload = JSON.parse(json);
  const db = new Database(DB_FILE);
  initSchema(db);
  let summary;
  try {
    summary = ingestShowsFromJson(db, payload, 'default');
  } catch (e) {
    process.stderr.write(`shows ingest failed: ${e.message}\n`);
    process.exit(5);
  } finally {
    db.close();
  }
  const droppedN = (payload.dropped || []).length;
  process.stdout.write(
    `shows: ${summary.shows}  archive: ${summary.shows_archive}  tiktok: ${summary.tiktok_ideas}` +
    (droppedN ? `  dropped: ${droppedN} (see data/audit/management-actions.jsonl)` : '') +
    '\n',
  );
}
