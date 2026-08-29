// Lookup helpers for the BOH ops packet at /boh.
//
// Sheet tier is the single source of truth for who can open a sheet.
// middleware.js gates the manager paths and tests/js/test-boh-pin-coverage.mjs
// asserts the two stay in step, so adding a manager sheet here without
// gating it fails the build rather than quietly exposing vendor pricing.
//
// This module reaches the sheet data, so it is server-only in practice:
// importing BOH_SHEETS and evaluating the tier path lists below at module
// scope means the whole 190KB packet follows the import wherever it goes.
// Client components must import from ./helpers.ts instead — see the note
// there, and the import-graph gate in tests/js/test-boh-pin-coverage.mjs.

import type { BohSheet, BohTier } from './types.ts';
import { BOH_SHEETS } from './sheets.generated.ts';
import { bohPath } from './helpers.ts';

export type { BohSheet, BohTier };
export { BOH_SHEETS };

// Re-exported so every server component, script and suite that already
// imports these from the barrel keeps working unchanged.
export type { TaskMatrixDay } from './helpers.ts';
export {
  taskMatrixDays,
  isTaskMatrix,
  BOH_BASE,
  bohPath,
  sheetStorageKey,
  serviceDateISO,
} from './helpers.ts';

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
