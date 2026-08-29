// Pure helpers for the BOH ops packet at /boh — no sheet data.
//
// This module exists to keep the line book out of the browser bundle.
// `lib/boh/index.ts` imports BOH_SHEETS (the whole printed packet, both
// tiers) and evaluates MANAGER_SHEET_PATHS/COOK_SHEET_PATHS at module
// scope, so that import can never be tree-shaken. A `'use client'` file
// that reached the barrel for one string helper therefore shipped every
// manager sheet — Sysco account number, vendor reps and their phone
// numbers, named private-event customers — into a chunk served on the two
// deliberately-open routes (/boh and /boh/[sheet]), with no PIN in the way
// and public/sw.js caching it for offline reading.
//
// So: anything a client component needs lives here, and nothing here may
// import ./sheets.generated.ts. tests/js/test-boh-pin-coverage.mjs walks
// the import graph of every 'use client' file and fails if one reaches the
// sheet data again.
//
// Server components and tests can keep importing the barrel — it
// re-exports everything below, so this split moved no call site that did
// not need moving.

import type { BohBlock, RichText } from './types.ts';
import { serviceDate } from '../serviceDate.ts';

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

/**
 * Storage key for one sheet on one service date. Scoping to the date means
 * a sheet opened the next morning starts clean without anyone resetting it.
 *
 * The exact string is load-bearing: it names what a cook has already
 * ticked on their own phone. Changing its shape orphans every tick on
 * every device for the current service date, so it moved here verbatim.
 */
export function sheetStorageKey(slug: string, day: string): string {
  return `lariat.boh.${slug}.${day}`;
}

/**
 * The date the sheet belongs to — the venue service day (02:00–02:00
 * America/Denver), named by the date it started.
 *
 * Delegates to `serviceDate()` so the line book rolls with every other
 * board. A UTC date rolls over at 6pm Mountain; a midnight-only venue
 * date still hands a cook closing at 01:00 tomorrow's blank sheet.
 *
 * Nothing here reads the database: the line book is reference paper and
 * must still open when SQLite is unhealthy.
 */
export function serviceDateISO(now: Date = new Date()): string {
  return serviceDate(now);
}
