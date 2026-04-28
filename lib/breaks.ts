// Meal and rest breaks — CO COMPS Order #39 §5 (L1).
//
// Rules (Colorado, 2026):
// - 10-minute PAID rest period for every 4h worked or major fraction
//   thereof. Unworked, duty-free. If not provided, employer owes the
//   employee 10min of pay at regular rate.
// - 30-minute UNPAID meal period for shifts of 5h+. Must be duty-free
//   and at least 30 consecutive minutes. The employee may WAIVE the
//   meal period via a written, voluntary, revocable waiver (on-duty
//   meal); the waiver does NOT reduce the entitlement to be paid for
//   that time.
// - Minors (16-17 y/o): 30-minute meal after 5h; may not work more
//   than 5h without a break.
//
// This module answers: given a shift from `started_at` to `ended_at`
// and the breaks the cook took, what breaks does COMPS still require?
// The /labor/breaks UI uses this to prompt the manager before payroll
// close.

export const REST_BREAK_MIN_MINUTES = 10;
export const MEAL_BREAK_MIN_MINUTES = 30;
// Every 4h worked or "major fraction thereof" triggers a rest break.
// "Major fraction" means >2h. So 2h ≤ shift < 4h = 1 rest; 4h ≤ shift <
// 6h = 1 rest; 6h ≤ shift < 10h = 2 rests; 10h = 3 rests, etc.
// Reading of COMPS #39 §5.2.1.
export const REST_BREAK_WORK_BLOCK_HOURS = 4;
export const MEAL_BREAK_THRESHOLD_HOURS = 5;

export type BreakKind = 'meal' | 'rest';

export interface ShiftBreakRow {
  kind: BreakKind;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  waived: number;             // 0/1
}

// ── Requirement calculators ───────────────────────────────────────

/**
 * How many 10-min rest breaks does this shift entitle the cook to?
 * Rounds up by "major fraction thereof" per COMPS §5.2.1.
 */
export function requiredRestBreaks(shiftHours: number): number {
  if (!Number.isFinite(shiftHours) || shiftHours <= 0) return 0;
  // Formula: round(shift / 4) with ties rounded UP — equivalent to
  // Math.floor((shift + 2) / 4) since the "major fraction" is >2h.
  return Math.floor((shiftHours + 2) / REST_BREAK_WORK_BLOCK_HOURS);
}

export function requiresMealBreak(shiftHours: number): boolean {
  return Number.isFinite(shiftHours) && shiftHours >= MEAL_BREAK_THRESHOLD_HOURS;
}

// ── Shift evaluation ──────────────────────────────────────────────

export interface ShiftEvaluation {
  shift_hours: number;
  required_meal_breaks: number;
  required_rest_breaks: number;
  actual_meal_breaks: number;
  actual_rest_breaks: number;
  waived_meal_breaks: number;
  meal_breaks_owed: number;        // ≥0 — pay-out liability if unpaid
  rest_breaks_owed: number;        // ≥0 — pay-out liability
  short_meal_breaks: number;       // meal breaks under 30 uninterrupted min
  short_rest_breaks: number;       // rest breaks under 10 uninterrupted min
  warnings: string[];
}

function parseIso(s: string): number | null {
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function durationMin(b: ShiftBreakRow): number | null {
  if (b.duration_min !== null && Number.isFinite(b.duration_min)) return b.duration_min;
  if (!b.ended_at) return null;
  const a = parseIso(b.started_at);
  const c = parseIso(b.ended_at);
  if (a === null || c === null) return null;
  return (c - a) / 60000;
}

/**
 * Evaluate a completed shift against COMPS #39. Callers pass the
 * shift start/end and the recorded breaks; we compute what was
 * required, what was taken, and what is owed.
 *
 * Owed breaks are pay-out liabilities — under COMPS an unprovided
 * break converts into 10min (rest) or 30min (meal) of pay at the
 * regular rate. The UI flags these so payroll can add the line.
 */
export function evaluateShift(
  shift_started_at: string,
  shift_ended_at: string,
  breaks: ShiftBreakRow[],
): ShiftEvaluation {
  const warnings: string[] = [];
  const startMs = parseIso(shift_started_at);
  const endMs = parseIso(shift_ended_at);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return {
      shift_hours: 0,
      required_meal_breaks: 0,
      required_rest_breaks: 0,
      actual_meal_breaks: 0,
      actual_rest_breaks: 0,
      waived_meal_breaks: 0,
      meal_breaks_owed: 0,
      rest_breaks_owed: 0,
      short_meal_breaks: 0,
      short_rest_breaks: 0,
      warnings: ['Invalid shift timestamps — check clock-in/clock-out'],
    };
  }
  const shiftHours = (endMs - startMs) / 3600000;
  const reqRest = requiredRestBreaks(shiftHours);
  const reqMeal = requiresMealBreak(shiftHours) ? 1 : 0;

  let actualMeal = 0;
  let actualRest = 0;
  let waivedMeal = 0;
  let shortMeal = 0;
  let shortRest = 0;

  for (const b of breaks) {
    if (b.kind === 'meal') {
      if (b.waived) {
        waivedMeal += 1;
        // A waived meal is NOT a taken meal per COMPS — the employee
        // stayed on duty. Still counts toward the entitlement only if
        // explicitly waived; we track waived separately.
        continue;
      }
      const d = durationMin(b);
      if (d === null) {
        warnings.push('Open meal break with no end time');
        continue;
      }
      if (d < MEAL_BREAK_MIN_MINUTES) {
        shortMeal += 1;
      } else {
        actualMeal += 1;
      }
    } else {
      const d = durationMin(b);
      if (d === null) {
        warnings.push('Open rest break with no end time');
        continue;
      }
      if (d < REST_BREAK_MIN_MINUTES) {
        shortRest += 1;
      } else {
        actualRest += 1;
      }
    }
  }

  // Waived meals count as "provided" only for the purposes of not-owing
  // the 30min pay-out (the employee is paid for that time because they
  // worked through it). So effective provided = actual + waived.
  const effectiveMeals = actualMeal + waivedMeal;
  const mealOwed = Math.max(0, reqMeal - effectiveMeals);
  const restOwed = Math.max(0, reqRest - actualRest);

  if (shortMeal > 0) {
    warnings.push(`${shortMeal} meal break(s) under 30 min — not compliant; may owe pay`);
  }
  if (shortRest > 0) {
    warnings.push(`${shortRest} rest break(s) under 10 min — not compliant; owes pay`);
  }
  if (waivedMeal > 0 && !reqMeal) {
    warnings.push('Meal break waived on a shift that did not require one');
  }

  return {
    shift_hours: shiftHours,
    required_meal_breaks: reqMeal,
    required_rest_breaks: reqRest,
    actual_meal_breaks: actualMeal,
    actual_rest_breaks: actualRest,
    waived_meal_breaks: waivedMeal,
    meal_breaks_owed: mealOwed,
    rest_breaks_owed: restOwed,
    short_meal_breaks: shortMeal,
    short_rest_breaks: shortRest,
    warnings,
  };
}
