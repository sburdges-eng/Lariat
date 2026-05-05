// Minor-employee station restrictions — L5 in docs/HEALTH_SAFETY_LABOR_AUDIT.md.
//
// Citation:
//   - C.R.S. §8-12-101 et seq. (Colorado Youth Employment Opportunity Act)
//   - 29 CFR 570.50+ (federal Hazardous Orders 14, 15, 16)
//
// Substance of the rule: employees under 18 are prohibited from operating
// power-driven slicers, choppers, grinders, mixers, deep fryers, bakery
// mixers, and similar hazardous equipment. The list of prohibited tasks
// is broader than the list of station IDs in our floorplan, so we map
// kitchen-station identifiers (the thing line cooks sign off against) to
// the regulatory prohibition by pattern-matching the station id against
// equipment names.
//
// IMPORTANT: this is a pure rule module. No DB, no I/O, no Request.
// The /api/signoff route reads cook minor-status from staff_flags and
// asks `evaluateMinorAssignment` whether the assignment is allowed.

export const MINOR_PROHIBITION_CITATION =
  'C.R.S. §8-12-101 et seq. (CO YEOA); 29 CFR 570.50+ (Hazardous Orders 14-16)';

/**
 * Pragmatic default mapping of station id → "involves prohibited equipment."
 * Each pattern matches station ids that, in this kitchen's floorplan,
 * contain the listed power-driven hazard.
 *
 * Expansion is by code-edit (intentional — there is no UI yet for managers
 * to maintain a per-site mapping). When a new station is built that uses
 * one of the HO-14/15/16 categories, append a pattern here. Until then,
 * stations not listed (line, expo, dish, garmo, plate-up, etc.) are
 * treated as allowed for minors.
 */
export const MINOR_PROHIBITED_STATION_PATTERNS: ReadonlyArray<RegExp> = [
  /^prep$|^prep[-_]/i,        // prep station — slicers, dicers, mandolines
  /grind/i,                   // meat grinders / spice grinders (HO 10)
  /slicer/i,                  // power-driven slicers (HO 10)
  /mixer/i,                   // commercial mixers (HO 11)
  /bakery/i,                  // bakery mixers + bench equipment (HO 11)
  /^fry(er)?($|[-_])/i,       // deep fryers (HO 14 — limited; conservative full ban)
];

export function isStationProhibitedForMinor(station_id: string): boolean {
  if (typeof station_id !== 'string') return false;
  const id = station_id.trim();
  if (!id) return false;
  for (const re of MINOR_PROHIBITED_STATION_PATTERNS) {
    if (re.test(id)) return true;
  }
  return false;
}

export interface MinorAssignmentInput {
  is_minor: boolean;
  station_id: string;
}

export type MinorAssignmentResult =
  | { ok: true }
  | { ok: false; reason: string; citation: string };

/**
 * The route gate calls this with `is_minor` already resolved from
 * staff_flags (active = effective_to IS NULL). Returns `{ ok: true }`
 * for non-minors regardless of station, and for minors on stations
 * that don't match a hazard pattern.
 */
export function evaluateMinorAssignment(
  input: MinorAssignmentInput,
): MinorAssignmentResult {
  if (!input.is_minor) return { ok: true };
  if (!isStationProhibitedForMinor(input.station_id)) return { ok: true };
  return {
    ok: false,
    reason: "this station has equipment minors can't use",
    citation: MINOR_PROHIBITION_CITATION,
  };
}
