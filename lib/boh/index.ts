// Lookup helpers for the BOH ops packet at /boh.
//
// Sheet tier is the single source of truth for who can open a sheet.
// middleware.js gates the manager paths and tests/js/test-boh-pin-coverage.mjs
// asserts the two stay in step, so adding a manager sheet here without
// gating it fails the build rather than quietly exposing vendor pricing.

import type { BohSheet, BohTier } from './types.ts';
import { BOH_SHEETS } from './sheets.generated.ts';

export type { BohSheet, BohTier };
export { BOH_SHEETS };

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

/**
 * The date the sheet belongs to, in the venue's own day — deliberately
 * local rather than the UTC slice `todayISO()` returns.
 *
 * A UTC date rolls over at 6pm Mountain, which would hand a cook a blank
 * dinner day plan in the middle of dinner service. Local date rolls at
 * midnight, so a sheet lasts the shift.
 *
 * Nothing here reads the database: the line book is reference paper and
 * must still open when SQLite is unhealthy.
 */
export function serviceDateISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
