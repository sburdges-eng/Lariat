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
}

/**
 * Temp points we ask cooks to log. Each is tied to a CCP.
 * Eight points covers the cold/hot-holding and cooking critical limits.
 * Cooling (CCP-8) is a multi-stage time-based check and is not modeled
 * as a single threshold here.
 */
export const TempPoints: readonly TempPoint[] = [
  {
    id: 'receiving_cold',
    label: 'Cold delivery',
    ccp_id: 'CCP-1',
    required_min_f: null,
    required_max_f: 41,
  },
  {
    id: 'walk_in_cooler',
    label: 'Walk-in cooler',
    ccp_id: 'CCP-2',
    required_min_f: null,
    required_max_f: 41,
  },
  {
    id: 'freezer',
    label: 'Freezer',
    ccp_id: 'CCP-3',
    required_min_f: null,
    required_max_f: 0,
  },
  {
    id: 'cook_poultry',
    label: 'Cook — poultry',
    ccp_id: 'CCP-4',
    required_min_f: 165,
    required_max_f: null,
  },
  {
    id: 'cook_ground_beef',
    label: 'Cook — ground beef',
    ccp_id: 'CCP-5',
    required_min_f: 155,
    required_max_f: null,
  },
  {
    id: 'cook_fish',
    label: 'Cook — fish',
    ccp_id: 'CCP-6',
    required_min_f: 145,
    required_max_f: null,
  },
  {
    id: 'hot_hold',
    label: 'Hot hold',
    ccp_id: 'CCP-7',
    required_min_f: 140,
    required_max_f: null,
  },
  {
    id: 'reheat',
    label: 'Reheat',
    ccp_id: 'CCP-9',
    required_min_f: 165,
    required_max_f: null,
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
