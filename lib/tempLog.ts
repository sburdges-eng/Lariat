// HACCP temp-log: well-known temp points + pure validation/classification.
// All temperatures are Fahrenheit. Points are grounded in
// data/cache/food_safety.json (ccps[] entries whose critical_limit is a temp).

import type { TempLogEntry } from './db';

export interface TempPoint {
  /** Stable id used in DB rows and API payloads. snake_case. */
  id: string;
  /** Short label shown in the UI. Kitchen-native wording. */
  label: string;
  /** CCP id from food_safety.json that grounds this point. */
  ccp_id: string;
  /** Lowest acceptable reading in °F. null = no floor. */
  required_min_f: number | null;
  /** Highest acceptable reading in °F. null = no ceiling. */
  required_max_f: number | null;
  /**
   * FDA Food Code section the reading is graded against. Surfaced in
   * the tile tooltip so an inspector hovering a tile sees the §-cite
   * without digging through docs. Added in Bundle F.
   */
  citation: string;
}

/**
 * Temp points we ask cooks to log. Each is tied to a CCP.
 *
 * Cooling (CCP-8) is a multi-stage time-based check; see lib/cooling.ts.
 * The points here are the single-reading CCPs — receiving, cold-hold
 * (walk-in + reach-in), freezer, cook min-internal per protein, hot
 * hold, and reheat.
 */
export const TempPoints: readonly TempPoint[] = [
  {
    id: 'receiving_cold',
    label: 'Cold delivery',
    ccp_id: 'CCP-1',
    required_min_f: null,
    required_max_f: 41,
    citation: 'FDA §3-202.11 — refrigerated PHF/TCS received at ≤ 41°F',
  },
  {
    id: 'receiving_frozen',
    label: 'Frozen delivery',
    ccp_id: 'CCP-1',
    required_min_f: null,
    // FDA §3-202.11 wants frozen food "received frozen" — we allow a
    // 10°F practical ceiling to absorb surface-thaw on the truck; the
    // inspector-safe floor is 0°F but 10°F is the real-world signal
    // that triggers rejection.
    required_max_f: 10,
    citation: 'FDA §3-202.11 — frozen food received frozen (≤ 10°F practical)',
  },
  {
    id: 'walk_in_cooler',
    label: 'Walk-in cooler',
    ccp_id: 'CCP-2',
    required_min_f: null,
    required_max_f: 41,
    citation: 'FDA §3-501.16(A)(2) — TCS food cold-hold ≤ 41°F',
  },
  {
    id: 'reach_in_cooler',
    label: 'Reach-in cooler',
    ccp_id: 'CCP-2',
    required_min_f: null,
    required_max_f: 41,
    citation: 'FDA §3-501.16(A)(2) — TCS food cold-hold ≤ 41°F',
  },
  {
    id: 'freezer',
    label: 'Freezer',
    ccp_id: 'CCP-3',
    required_min_f: null,
    required_max_f: 0,
    citation: 'FDA §3-501.16(A)(1) — frozen storage',
  },
  {
    id: 'cook_poultry',
    label: 'Cook — poultry',
    ccp_id: 'CCP-4',
    required_min_f: 165,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(3) — poultry min-internal 165°F / 15s',
  },
  {
    id: 'cook_ground_beef',
    label: 'Cook — ground beef',
    ccp_id: 'CCP-5',
    required_min_f: 155,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(2) — comminuted meat min-internal 155°F / 15s',
  },
  {
    id: 'cook_fish',
    label: 'Cook — fish',
    ccp_id: 'CCP-6',
    required_min_f: 145,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(1) — fish min-internal 145°F / 15s',
  },
  // ── Added in Bundle F (deferred nit from Bundle E): whole-muscle
  // pork/beef, and shell eggs cooked for hot-hold. These are §3-401.11
  // thresholds the brief asked for so every protein the Lariat cooks
  // has its own tile. `cook_eggs` uses 155°F — §3-401.11(A)(2) applies
  // when eggs are "not prepared for immediate service" (the common
  // hot-hold case on Lariat's brunch line). Eggs cooked to immediate
  // service drop to 145°F but that case is the exception, not the
  // rule, so the stricter 155°F is the one enforced here.
  {
    id: 'cook_pork',
    label: 'Cook — pork',
    ccp_id: 'CCP-6',
    required_min_f: 145,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(1) — whole-muscle pork 145°F / 15s',
  },
  {
    id: 'cook_beef_steak',
    label: 'Cook — beef steak',
    ccp_id: 'CCP-6',
    required_min_f: 145,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(1) — whole-muscle beef 145°F / 15s',
  },
  {
    id: 'cook_eggs',
    label: 'Cook — shell eggs',
    ccp_id: 'CCP-5',
    required_min_f: 155,
    required_max_f: null,
    citation: 'FDA §3-401.11(A)(2) — shell eggs for hot-hold 155°F / 15s',
  },
  {
    id: 'hot_hold',
    label: 'Hot hold',
    ccp_id: 'CCP-7',
    required_min_f: 140,
    required_max_f: null,
    citation: 'FDA §3-501.16(A)(1) — hot-hold ≥ 135°F (house policy 140)',
  },
  {
    id: 'reheat',
    label: 'Reheat',
    ccp_id: 'CCP-9',
    required_min_f: 165,
    required_max_f: null,
    citation: 'FDA §3-403.11(A) — reheat for hot-hold 165°F / 15s within 2h',
  },
];

const BY_ID: ReadonlyMap<string, TempPoint> = new Map(
  TempPoints.map((p) => [p.id, p]),
);

export function getTempPoint(id: string): TempPoint | undefined {
  return BY_ID.get(id);
}

// ── Validation ─────────────────────────────────────────────────────

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Hard bounds that catch bad input (wrong units, typos, broken probes).
 * Readings outside [-100°F, 500°F] are rejected as bad input; the edges
 * themselves (-100 and 500) are accepted.
 */
const ABSOLUTE_MIN_F = -100;
const ABSOLUTE_MAX_F = 500;

/**
 * Validate a temp reading for a given point.
 *
 * - `reading_f` must be a finite number inside the absolute sanity range.
 *   Outside that is "bad input" — not treated as a compliance miss.
 * - If the reading is outside the point's required range, `corrective_action`
 *   must be a non-empty trimmed string or the reading is rejected.
 * - If the reading is in range, `corrective_action` is optional.
 */
export function validateTempReading(
  point: TempPoint,
  reading_f: unknown,
  corrective_action: unknown,
): ValidateResult {
  if (typeof reading_f !== 'number' || !Number.isFinite(reading_f)) {
    return { ok: false, reason: 'Reading must be a number in °F' };
  }
  if (reading_f < ABSOLUTE_MIN_F || reading_f > ABSOLUTE_MAX_F) {
    return { ok: false, reason: `Reading ${reading_f}°F is off the charts — check the probe` };
  }

  const { required_min_f: min, required_max_f: max, label } = point;

  const belowMin = min !== null && reading_f < min;
  const aboveMax = max !== null && reading_f > max;

  if (!belowMin && !aboveMax) {
    return { ok: true };
  }

  const note = normalizeCorrectiveAction(corrective_action);
  if (note === null) {
    if (belowMin) {
      return {
        ok: false,
        reason: `${label} is ${reading_f}°F (below limit ${min}°F) — needs a note on the fix`,
      };
    }
    // aboveMax
    return {
      ok: false,
      reason: `${label} is ${reading_f}°F (above limit ${max}°F) — needs a note on the fix`,
    };
  }

  // Out of range but cook wrote a corrective action — accept the log.
  return { ok: true };
}

// ── Corrective-action normalization ────────────────────────────────

/**
 * Canonicalize a corrective-action input to either a non-empty trimmed
 * string or `null`. "Empty means absent" is defined here so it's the
 * same everywhere (validator, entry builder, future API handler).
 *
 * - non-string inputs (number, null, undefined, objects, etc.) → null
 * - strings that are empty after trimming → null
 * - strings with content → trimmed string
 */
export function normalizeCorrectiveAction(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const trimmed = x.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ── Entry construction ────────────────────────────────────────────

/**
 * Build a DB-insert-ready row from a validated reading. The caller is
 * responsible for running {@link validateTempReading} first; this is
 * just the row-shaping step.
 *
 * `required_min_f` and `required_max_f` are snapshotted from `point`
 * into the row so later edits to the {@link TempPoints} registry can't
 * retroactively change the limits shown in an audit of old readings.
 */
export function entryFromReading(args: {
  point: TempPoint;
  reading_f: number;
  corrective_action: string | null;
  shift_date: string;
  cook_id: string | null;
  location_id?: string;
  /** Bundle G: optional thermometer id (probe) the reading was taken with. */
  probe_id?: string | null;
}): Omit<TempLogEntry, 'id' | 'created_at'> {
  const { point, reading_f, corrective_action, shift_date, cook_id } = args;
  return {
    shift_date,
    location_id: args.location_id ?? 'default',
    point_id: point.id,
    reading_f,
    required_min_f: point.required_min_f,
    required_max_f: point.required_max_f,
    corrective_action: normalizeCorrectiveAction(corrective_action),
    cook_id,
    probe_id: args.probe_id ?? null,
  };
}

// ── Classification (for UI coloring) ──────────────────────────────

export type ReadingClass = 'ok' | 'out_of_range' | 'invalid';

/** Classify a reading. Pure — no side effects. */
export function classifyReading(point: TempPoint, reading_f: unknown): ReadingClass {
  if (typeof reading_f !== 'number' || !Number.isFinite(reading_f)) {
    return 'invalid';
  }
  if (reading_f < ABSOLUTE_MIN_F || reading_f > ABSOLUTE_MAX_F) {
    return 'invalid';
  }
  const { required_min_f: min, required_max_f: max } = point;
  if (min !== null && reading_f < min) return 'out_of_range';
  if (max !== null && reading_f > max) return 'out_of_range';
  return 'ok';
}

// ── Per-point day summary (for the board tiles) ────────────────────

/**
 * A single reading as it lives in the DB (or an equivalent shape from
 * a test fixture). Only the fields the aggregator touches are required.
 */
export interface ReadingRow {
  point_id: string;
  reading_f: number;
  corrective_action?: string | null;
  created_at?: string | null;
}

/**
 * Tile-level status for the board:
 * - green: nothing logged or everything in range
 * - yellow: at least one out-of-range reading carried a corrective note
 *           (treated as a "corrective" event — the kitchen caught it and
 *           fixed it, FDA wants this on record but the CCP isn't red)
 * - red: at least one out-of-range reading with NO corrective note
 *        present (a critical miss — the reading exists but the fix
 *        wasn't captured; inspector sees this as out-of-compliance)
 * - gray: point hasn't been read today (only returned when
 *         options.expectAllPoints is true or the point has no readings)
 *
 * Color mapping is deliberate: "corrective" (amber) is the common case
 * and must NOT be red — a cold-hold reading of 43°F with a note that
 * the product was moved to the reach-in is compliant. "Critical" (red)
 * means an out-of-range reading hit the DB without evidence of the fix,
 * or no reading exists for a required CCP.
 */
export type TileStatus = 'green' | 'yellow' | 'red' | 'gray';

export interface PointSummary {
  point_id: string;
  label: string;
  ccp_id: string;
  /** Mirrors `TempPoint.citation` — surfaced so the board can render
   *  a FDA §-cite tooltip per tile without looking the point up again. */
  citation: string;
  required_min_f: number | null;
  required_max_f: number | null;
  status: TileStatus;
  total_readings: number;
  ok_count: number;
  /** out-of-range readings that DO carry a corrective note */
  corrective_count: number;
  /** out-of-range readings that DO NOT carry a corrective note */
  critical_count: number;
  /** invalid/bad-input readings (probe malfunction) — very rare once the
   *  API route is enforcing validation, but possible from back-fills */
  invalid_count: number;
  last_reading_f: number | null;
  last_reading_at: string | null;
}

/**
 * Pick the "newer" of two readings for the `last_reading_*` fields.
 * `created_at` is an ISO string from sqlite — lexicographic comparison
 * is correct for that format. A row with no created_at loses ties.
 */
function newerThan(a: ReadingRow, b: ReadingRow | null): boolean {
  if (b === null) return true;
  const at = typeof a.created_at === 'string' ? a.created_at : '';
  const bt = typeof b.created_at === 'string' ? b.created_at : '';
  return at > bt;
}

/**
 * Aggregate a day's readings into a per-point summary the board can
 * render. Pure function; pass whatever slice of rows the caller wants
 * to classify.
 *
 * `options.expectAllPoints` (default true) adds a gray-status entry for
 * every registry point that has no readings, so the board renders the
 * full CCP grid even on a fresh shift.
 */
export function classifyReadings(
  readings: readonly ReadingRow[],
  options: { expectAllPoints?: boolean } = {},
): PointSummary[] {
  const expectAll = options.expectAllPoints ?? true;
  const grouped = new Map<string, ReadingRow[]>();

  // Bucket rows by point_id. Rows for a retired point are skipped from
  // the summary view — they still exist in the raw GET response for
  // audit, but we don't want an orphan tile on the board.
  for (const r of readings) {
    if (!r || typeof r.point_id !== 'string') continue;
    if (!getTempPoint(r.point_id)) continue;
    const list = grouped.get(r.point_id) ?? [];
    list.push(r);
    grouped.set(r.point_id, list);
  }

  const pointIds = expectAll
    ? TempPoints.map((p) => p.id)
    : Array.from(grouped.keys());

  const out: PointSummary[] = [];
  for (const id of pointIds) {
    const point = getTempPoint(id);
    if (!point) continue;
    const rows = grouped.get(id) ?? [];

    let ok = 0;
    let corrective = 0;
    let critical = 0;
    let invalid = 0;
    let newest: ReadingRow | null = null;

    for (const r of rows) {
      if (newerThan(r, newest)) newest = r;
      const k = classifyReading(point, r.reading_f);
      if (k === 'invalid') {
        invalid += 1;
        continue;
      }
      if (k === 'ok') {
        ok += 1;
        continue;
      }
      // out_of_range — split on whether a note was recorded
      const note = normalizeCorrectiveAction(r.corrective_action);
      if (note) corrective += 1;
      else critical += 1;
    }

    // Status precedence: red > yellow > green > gray. Invalid-only days
    // are red because a probe malfunction without a follow-up reading
    // means the CCP is unverified.
    let status: TileStatus;
    if (critical > 0 || (rows.length > 0 && ok === 0 && corrective === 0 && invalid > 0)) {
      status = 'red';
    } else if (corrective > 0) {
      status = 'yellow';
    } else if (ok > 0) {
      status = 'green';
    } else {
      status = 'gray';
    }

    out.push({
      point_id: point.id,
      label: point.label,
      ccp_id: point.ccp_id,
      citation: point.citation,
      required_min_f: point.required_min_f,
      required_max_f: point.required_max_f,
      status,
      total_readings: rows.length,
      ok_count: ok,
      corrective_count: corrective,
      critical_count: critical,
      invalid_count: invalid,
      last_reading_f: newest ? newest.reading_f : null,
      last_reading_at: newest && typeof newest.created_at === 'string' ? newest.created_at : null,
    });
  }
  return out;
}
