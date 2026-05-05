// Corrective-action aggregator — F13 in docs/HEALTH_SAFETY_LABOR_AUDIT.md.
//
// Citation: FDA 2022 §8-405.11 — corrective action recording. Two
// existing tables already store corrective actions:
//   - temp_log.corrective_action (out-of-range temperature reading
//     with the documented fix; non-NULL means "yellow" tile per
//     §1 of docs/PATTERNS.md)
//   - line_check_entries.note  (with status='fail'; the cook's
//     account of what they did about it)
//
// This module merges both sources into a single read-shape so the
// route layer doesn't have to fan out the union. Pure: no DB, no I/O.
// The route passes already-SELECTed rows; we normalize and sort.

export const CORRECTIVE_ACTION_CITATION = 'FDA 2022 §8-405.11';

export type CorrectiveActionSource = 'temp_log' | 'line_check';

export interface CorrectiveActionEntry {
  source: CorrectiveActionSource;
  entry_id: number;
  shift_date: string;
  station_id: string | null;
  subject: string;       // human-readable label of WHAT was off
  note: string;          // the corrective action text itself
  cook_id: string | null;
  created_at: string;
}

// ── Source row shapes (only the columns we read) ─────────────────

export interface TempLogCorrectiveRow {
  id: number;
  shift_date: string;
  point_id: string;            // e.g. "walk_in_cooler"
  corrective_action: string;
  cook_id: string | null;
  created_at: string;
}

export interface LineCheckCorrectiveRow {
  id: number;
  shift_date: string;
  station_id: string;
  item: string;
  note: string;
  cook_id: string | null;
  created_at: string;
}

// ── Normalizers ───────────────────────────────────────────────────

function fromTempLog(r: TempLogCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'temp_log',
    entry_id: r.id,
    shift_date: r.shift_date,
    // temp_log rows aren't station-scoped — point_id is the CCP id.
    station_id: null,
    subject: r.point_id,
    note: r.corrective_action,
    cook_id: r.cook_id ?? null,
    created_at: r.created_at,
  };
}

function fromLineCheck(r: LineCheckCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'line_check',
    entry_id: r.id,
    shift_date: r.shift_date,
    station_id: r.station_id,
    subject: `${r.station_id}: ${r.item}`,
    note: r.note,
    cook_id: r.cook_id ?? null,
    created_at: r.created_at,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Merge corrective-action rows from temp_log and line_check_entries
 * into a single chronologically-sorted feed (newest first).
 *
 * The caller is expected to filter the source rows in SQL (see the
 * route): non-empty corrective_action / non-empty note + status='fail',
 * scoped to shift_date + location_id. This function does NOT re-filter;
 * a row that arrives is presumed corrective.
 */
export function mergeCorrectiveActions(
  tempLogRows: ReadonlyArray<TempLogCorrectiveRow>,
  lineCheckRows: ReadonlyArray<LineCheckCorrectiveRow>,
): CorrectiveActionEntry[] {
  const out: CorrectiveActionEntry[] = [];
  for (const r of tempLogRows ?? []) out.push(fromTempLog(r));
  for (const r of lineCheckRows ?? []) out.push(fromLineCheck(r));
  out.sort((a, b) => {
    if (a.created_at < b.created_at) return 1;
    if (a.created_at > b.created_at) return -1;
    // Stable secondary sort by source then entry_id so equal
    // timestamps don't shuffle between calls.
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return b.entry_id - a.entry_id;
  });
  return out;
}
