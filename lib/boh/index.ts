// Lookup helpers for the BOH ops packet at /boh.
//
// Sheet tier is the single source of truth for who can open a sheet.
// middleware.js gates the manager paths and tests/js/test-boh-pin-coverage.mjs
// asserts the two stay in step, so adding a manager sheet here without
// gating it fails the build rather than quietly exposing vendor pricing.

import type { BohSheet, BohTier, BohBlock, RichText } from './types.ts';
import { BOH_SHEETS } from './sheets.generated.ts';

export type { BohSheet, BohTier };
export { BOH_SHEETS };

/** One day of a rotation: the day name and one tickable task per station. */
export interface TaskMatrixDay {
  id: string;
  day: string;
  tasks: { id: string; station: string; text: RichText }[];
}

/**
 * Reshape a grid into a card per row, or return null if it is not a
 * day-by-station matrix of tasks: a row label in the first column and
 * nothing but tick boxes after it.
 *
 * The deep-clean rotation is the one table in the packet that cannot be
 * read on a phone as a table — five columns of sentence-length tasks means
 * scrolling sideways to find your station mid-shift. The board stacks
 * those into a card per day. Every other grid is narrow enough, or carries
 * written-in values that only line up as a table, so it stays one.
 */
export function taskMatrixDays(block: BohBlock): TaskMatrixDay[] | null {
  if (block.kind !== 'grid') return null;
  if (block.columns.length < 3 || block.rows.length === 0) return null;

  const days: TaskMatrixDay[] = [];
  for (const row of block.rows) {
    const [label, ...stations] = row.cells;
    if (!label || label.kind !== 'text' || label.text.trim() === '') return null;
    if (stations.length === 0) return null;

    const tasks: TaskMatrixDay['tasks'] = [];
    for (const [i, cell] of stations.entries()) {
      if (cell.kind !== 'check') return null;
      tasks.push({ id: cell.id, station: block.columns[i + 1] ?? '', text: cell.text });
    }
    days.push({ id: row.id, day: label.text, tasks });
  }
  return days;
}

/** Whether the board should stack this grid into day cards. */
export function isTaskMatrix(block: BohBlock): boolean {
  return taskMatrixDays(block) !== null;
}

/** Route prefix for the packet. */
export const BOH_BASE = '/boh';

/**
 * @param slug sheet slug, e.g. "prep-par"
 */
export function bohPath(slug: string): string {
  return `${BOH_BASE}/${slug}`;
}

export function getSheet(slug: string): BohSheet | null {
  return BOH_SHEETS.find((s) => s.slug === slug) ?? null;
}

export function sheetsByTier(tier: BohTier): BohSheet[] {
  return BOH_SHEETS.filter((s) => s.tier === tier);
}

/** Paths that must sit behind the manager PIN. Consumed by the gate test. */
export const MANAGER_SHEET_PATHS: string[] = sheetsByTier('manager').map((s) => bohPath(s.slug));

/** Paths that must stay open so a cook can read their own line paper. */
export const COOK_SHEET_PATHS: string[] = sheetsByTier('cook').map((s) => bohPath(s.slug));

/**
 * Storage key for one sheet on one service date. Scoping to the date means
 * a sheet opened the next morning starts clean without anyone resetting it.
 */
export function sheetStorageKey(slug: string, serviceDate: string): string {
  return `lariat.boh.${slug}.${serviceDate}`;
}

const VENUE_TIME_ZONE = 'America/Denver';
const SERVICE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The date the sheet belongs to, in the venue's own day — deliberately
 * local rather than the UTC slice `todayISO()` returns.
 *
 * A UTC date rolls over at 6pm Mountain, which would hand a cook a blank
 * dinner day plan in the middle of dinner service. The venue date rolls
 * at Colorado midnight, so a sheet lasts the shift.
 *
 * Nothing here reads the database: the line book is reference paper and
 * must still open when SQLite is unhealthy.
 */
export function serviceDateISO(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    SERVICE_DATE_FORMATTER.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  return `${year}-${month}-${day}`;
}
