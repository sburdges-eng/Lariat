/**
 * Read-only query layer over shows / shows_archive / tiktok_ideas.
 *
 * Stable contract: callers pass `today` (ISO date) explicitly so tests
 * are deterministic. Production callers default to today's date.
 */
import type Database from 'better-sqlite3';
import { pipelineStage, KNOWN_STAGES, type PipelineStage } from './showStatus';

type DB = Database.Database;

export interface ShowRow {
  id: number;
  band_name: string;
  show_date: string;
  price: number | null;
  door_tix: string | null;
  status: Record<string, string>;
  source_row: number;
}

export interface ArchiveRow {
  id: number;
  band_name: string;
  show_date: string;
  era_year: number | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rowToShow(r: any): ShowRow {
  return {
    id: r.id,
    band_name: r.band_name,
    show_date: r.show_date,
    price: r.price,
    door_tix: r.door_tix,
    status: r.status_json ? JSON.parse(r.status_json) : {},
    source_row: r.source_row,
  };
}

export function upcomingShows(
  db: DB,
  locationId: string,
  opts: { today?: string; weeks?: number } = {},
): ShowRow[] {
  const today = opts.today ?? todayIso();
  const weeks = opts.weeks ?? 5;
  const upper = addDays(today, weeks * 7);
  const rows = db
    .prepare(
      `SELECT * FROM shows
        WHERE location_id = ?
          AND show_date >= ?
          AND show_date <= ?
        ORDER BY show_date ASC, id ASC`,
    )
    .all(locationId, today, upper) as any[];
  return rows.map(rowToShow);
}

export function pipelineCounts(
  db: DB,
  locationId: string,
  opts: { today?: string; weeks?: number } = {},
): Record<PipelineStage, number> {
  const today = opts.today ?? todayIso();
  const counts: Record<string, number> = {};
  for (const s of KNOWN_STAGES) counts[s] = 0;
  const rows = upcomingShows(db, locationId, { today, weeks: opts.weeks ?? 52 });
  for (const r of rows) {
    const past = r.show_date < today;
    const stage = pipelineStage(r.status, past);
    counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return counts as Record<PipelineStage, number>;
}

export function archiveSearch(
  db: DB,
  locationId: string,
  opts: { q?: string; era?: number } = {},
): ArchiveRow[] {
  const clauses: string[] = ['location_id = ?'];
  const params: any[] = [locationId];
  if (opts.q && opts.q.trim()) {
    clauses.push('band_name LIKE ?');
    params.push(`%${opts.q.trim()}%`);
  }
  if (opts.era != null) {
    clauses.push('era_year = ?');
    params.push(opts.era);
  }
  const rows = db
    .prepare(
      `SELECT id, band_name, show_date, era_year
         FROM shows_archive
        WHERE ${clauses.join(' AND ')}
        ORDER BY show_date DESC, id DESC`,
    )
    .all(...params) as ArchiveRow[];
  return rows;
}

export function archiveEras(db: DB, locationId: string): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT era_year FROM shows_archive
        WHERE location_id = ? AND era_year IS NOT NULL
        ORDER BY era_year DESC`,
    )
    .all(locationId) as any[];
  return rows.map((r) => r.era_year);
}

export function getShowById(db: DB, locationId: string, id: number): ShowRow | null {
  const row = db
    .prepare('SELECT * FROM shows WHERE location_id = ? AND id = ?')
    .get(locationId, id) as any;
  return row ? rowToShow(row) : null;
}

export function nextUpcoming(
  db: DB,
  locationId: string,
  opts: { today?: string } = {},
): ShowRow | null {
  const today = opts.today ?? todayIso();
  const row = db
    .prepare(
      `SELECT * FROM shows
        WHERE location_id = ? AND show_date >= ?
        ORDER BY show_date ASC, id ASC LIMIT 1`,
    )
    .get(locationId, today) as any;
  return row ? rowToShow(row) : null;
}
