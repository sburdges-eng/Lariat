// Corrective-action aggregator — F13 in docs/HEALTH_SAFETY_LABOR_AUDIT.md.
//
// Citation: FDA 2022 §8-405.11 — corrective action recording. Six
// tables store a corrective action, and every one of them is a place a
// route REFUSED the write until the cook documented the fix:
//   - temp_log.corrective_action      (out-of-range reading + the fix;
//     non-NULL means "yellow" tile per §1 of docs/PATTERNS.md)
//   - line_check_entries.note         (status='fail'; what they did)
//   - cooling_log.corrective_action   (422 'breach requires a corrective
//     action note')
//   - sanitizer_checks.corrective_action (422 on an out-of-band bucket)
//   - receiving_log.rejection_reason  (422 'needs_rejection_note' — the
//     column is named for the refusal, but it holds the corrective text)
//   - pest_control_log.corrective_action
//
// This module merges the sources into a single read-shape so the route
// layer doesn't have to fan out the union. Pure: no DB, no I/O. The
// caller passes already-SELECTed rows; we normalize and sort.
//
// Only the first two were read until 2026-08-29, so a shift that blew a
// cooling window and remade an out-of-spec quat bucket — both of which
// the API forced the cook to document — printed a HACCP plan whose
// corrective-action section said "No corrective actions recorded in the
// window", two sections below the breach count that contradicted it.

export const CORRECTIVE_ACTION_CITATION = 'FDA 2022 §8-405.11';

export type CorrectiveActionSource =
  | 'temp_log'
  | 'line_check'
  | 'cooling'
  | 'sanitizer'
  | 'receiving'
  | 'pest';

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

/**
 * What a cook or an inspector calls each source. A label per source, not a
 * ternary at the call site: the plan and the feed both used
 * `source === 'temp_log' ? 'Temp log' : 'Line check'`, so the moment a
 * third source existed every one of them would have printed "Line check"
 * on a document a health inspector reads.
 */
export const CORRECTIVE_SOURCE_LABEL: Record<CorrectiveActionSource, string> = {
  temp_log: 'Temp log',
  line_check: 'Line check',
  cooling: 'Cooling',
  sanitizer: 'Sanitizer',
  receiving: 'Receiving',
  pest: 'Pest',
};

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

export interface CoolingCorrectiveRow {
  id: number;
  shift_date: string;
  station_id: string | null;
  item: string;
  corrective_action: string;
  cook_id: string | null;
  /**
   * When the fix happened, not when the batch went in. The cook enters
   * the corrective action on closing the breach, hours after
   * `created_at`; filing it at the batch start would place it before the
   * breach it answers. The caller supplies
   * COALESCE(stage2_at, stage1_at, created_at).
   */
  corrected_at: string;
}

export interface SanitizerCorrectiveRow {
  id: number;
  shift_date: string;
  station_id: string | null;
  point_label: string;
  corrective_action: string;
  cook_id: string | null;
  created_at: string;
}

export interface ReceivingCorrectiveRow {
  id: number;
  shift_date: string;
  vendor: string;
  item: string | null;
  category: string;
  /** Holds the corrective text; named for the refusal it documents. */
  rejection_reason: string;
  cook_id: string | null;
  created_at: string;
}

export interface PestCorrectiveRow {
  id: number;
  shift_date: string;
  entry_type: string;
  pest: string | null;
  corrective_action: string;
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

function fromCooling(r: CoolingCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'cooling',
    entry_id: r.id,
    shift_date: r.shift_date,
    station_id: r.station_id ?? null,
    subject: r.item,
    note: r.corrective_action,
    cook_id: r.cook_id ?? null,
    created_at: r.corrected_at,
  };
}

function fromSanitizer(r: SanitizerCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'sanitizer',
    entry_id: r.id,
    shift_date: r.shift_date,
    station_id: r.station_id ?? null,
    subject: r.point_label,
    note: r.corrective_action,
    cook_id: r.cook_id ?? null,
    created_at: r.created_at,
  };
}

function fromReceiving(r: ReceivingCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'receiving',
    entry_id: r.id,
    shift_date: r.shift_date,
    // receiving_log has no station column — a delivery lands at the door.
    station_id: null,
    subject: `${r.vendor}: ${r.item ?? r.category}`,
    note: r.rejection_reason,
    cook_id: r.cook_id ?? null,
    created_at: r.created_at,
  };
}

function fromPest(r: PestCorrectiveRow): CorrectiveActionEntry {
  return {
    source: 'pest',
    entry_id: r.id,
    shift_date: r.shift_date,
    station_id: null,
    subject: r.pest ?? r.entry_type,
    note: r.corrective_action,
    cook_id: r.cook_id ?? null,
    created_at: r.created_at,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Merge corrective-action rows from every table that holds one into a
 * single chronologically-sorted feed (newest first).
 *
 * The first two sources stay positional so existing callers and their
 * tests keep working; the rest arrive in `more`.
 *
 * The caller is expected to filter the source rows in SQL (see the
 * route): non-empty corrective_action / non-empty note + status='fail',
 * scoped to shift_date + location_id. This function does NOT re-filter;
 * a row that arrives is presumed corrective.
 */
export function mergeCorrectiveActions(
  tempLogRows: ReadonlyArray<TempLogCorrectiveRow>,
  lineCheckRows: ReadonlyArray<LineCheckCorrectiveRow>,
  more: {
    coolingRows?: ReadonlyArray<CoolingCorrectiveRow>;
    sanitizerRows?: ReadonlyArray<SanitizerCorrectiveRow>;
    receivingRows?: ReadonlyArray<ReceivingCorrectiveRow>;
    pestRows?: ReadonlyArray<PestCorrectiveRow>;
  } = {},
): CorrectiveActionEntry[] {
  const out: CorrectiveActionEntry[] = [];
  for (const r of tempLogRows ?? []) out.push(fromTempLog(r));
  for (const r of lineCheckRows ?? []) out.push(fromLineCheck(r));
  for (const r of more.coolingRows ?? []) out.push(fromCooling(r));
  for (const r of more.sanitizerRows ?? []) out.push(fromSanitizer(r));
  for (const r of more.receivingRows ?? []) out.push(fromReceiving(r));
  for (const r of more.pestRows ?? []) out.push(fromPest(r));
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
