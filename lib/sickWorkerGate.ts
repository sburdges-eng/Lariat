// Sick-worker scheduler gate — L6 in docs/HEALTH_SAFETY_LABOR_AUDIT.md.
//
// Citation: FDA 2022 Food Code §2-201.12 — a food employee with a
// reportable illness, symptom, or exposure must not engage in food
// handling. Companion to F5 (the sick-report data model in
// `lib/sickWorker.ts` + `/api/sick-worker`); this module is the read
// side that the /api/signoff route consults BEFORE accepting a
// station signoff.
//
// Pure module. No DB, no I/O. The route passes in the active rows
// already SELECTed from `sick_worker_reports` (filter:
// `return_at IS NULL`) and asks whether the cook is currently
// excluded.
//
// Active-exclusion semantics (matches F5 / `app/api/sick-worker/route.js`):
//   - return_at IS NULL          → exclusion is "open"
//   - action IN ('excluded',
//                'restricted')   → blocks line work
//   - action IN ('monitor',
//                'none')         → does NOT block (informational only)

export const SICK_WORKER_EXCLUSION_CITATION = 'FDA 2022 §2-201.12';

export interface SickWorkerRow {
  action: string;
  return_at: string | null;
}

const BLOCKING_ACTIONS = new Set(['excluded', 'restricted']);

/**
 * Pure: returns true iff at least one row represents an OPEN exclusion
 * (return_at is null) with a blocking action ('excluded' or 'restricted').
 *
 * Pre-cleared rows (return_at present) are ignored even if action was
 * 'excluded' — that's the "they're back from clearance" path. Action
 * 'monitor' / 'none' rows are also ignored — those are informational
 * tracking, not a regulatory block.
 */
export function cookHasActiveExclusion(rows: ReadonlyArray<SickWorkerRow>): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.return_at !== null && r.return_at !== undefined) continue;
    if (typeof r.action !== 'string') continue;
    if (BLOCKING_ACTIONS.has(r.action)) return true;
  }
  return false;
}

export type CookEligibilityResult =
  | { ok: true }
  | { ok: false; reason: string; citation: string };

/**
 * Symmetric-shape helper so the route gate body matches the L5
 * `evaluateMinorAssignment` shape — both gates produce
 * `{ ok: false, reason, citation }` on a block.
 */
export function evaluateCookEligibility(
  rows: ReadonlyArray<SickWorkerRow>,
): CookEligibilityResult {
  if (!cookHasActiveExclusion(rows)) return { ok: true };
  return {
    ok: false,
    reason: "this cook is on a reportable-illness exclusion and can't work the line",
    citation: SICK_WORKER_EXCLUSION_CITATION,
  };
}
