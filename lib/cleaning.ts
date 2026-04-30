// Cleaning-log validation (paired with POST /api/cleaning).
//
// Cleaning frequency + chemical use are CCP-adjacent: a missed clean
// of a food-contact surface is an FDA §4-602.11 finding; non-food-contact
// surfaces fall under §4-602.13. We record one row per task completion;
// the rule module owns the pure shape + citation constants and the
// route owns SQLite + audit.
//
// Citations are FDA 2022 Food Code (Colorado incorporates by reference
// at 6 CCR 1010-2 §3-101). They live as named constants here so the
// UI / inspector tooltip never hand-types a §-cite.
//
// The route accepts either `item` OR `task` as the identifier of what
// was cleaned (legacy: an earlier UI sent `item`; the schema column is
// `task`). Validation pins exactly the contract the route relies on:
//
//   1. At least one of `item` or `task` must be a non-empty string.
//   2. Optional fields are type-checked when present so the route's
//      clip()-and-INSERT path can never silently drop bad input.
//   3. Length bounds match the route's clip() limits so the validator
//      surfaces a 400 instead of letting clip() truncate-then-INSERT.
//
// Pure module: no I/O, no DB, no clock read.

// ── Citations (single source of truth) ────────────────────────────

/**
 * Food-contact surface cleaning + sanitizing frequency. The CCP that
 * a kitchen's cleaning-log proves compliance with.
 */
export const CLEANING_CITATION =
  'FDA §4-602.11 — food-contact surfaces cleaned at the frequency required to keep equipment safe';

/**
 * Non-food-contact surfaces (floors, walls, the underside of equipment)
 * are §4-602.13 — separate frequency requirement, separate finding.
 */
export const CLEANING_FREQUENCY_CITATION =
  'FDA §4-602.13 — non-food-contact surfaces cleaned at a frequency that prevents accumulation';

// ── Field-length bounds (mirror the route's clip() limits) ────────

/** Notes column accepts up to 500 chars (route clip + slice). */
export const NOTES_MAX_LEN = 500;
/** Area column accepts up to 100 chars (route clip). */
export const AREA_MAX_LEN = 100;
/** Task column accepts up to 200 chars (route clip). */
export const TASK_MAX_LEN = 200;
/** cook_id / verified_by_cook_id columns accept up to 64 chars. */
export const COOK_ID_MAX_LEN = 64;
/** shift_date column accepts up to 32 chars (matches the route clip). */
export const SHIFT_DATE_MAX_LEN = 32;
/** completed_at column accepts up to 40 chars (matches the route clip). */
export const COMPLETED_AT_MAX_LEN = 40;

// ── Public input + output shapes ──────────────────────────────────

export interface CleaningLogInput {
  item?: unknown;
  task?: unknown;
  schedule_id?: unknown;
  shift_date?: unknown;
  area?: unknown;
  completed_at?: unknown;
  cook_id?: unknown;
  verified_by_cook_id?: unknown;
  notes?: unknown;
  done?: unknown;
}

/**
 * Normalized snapshot the route can use directly. All strings are
 * trimmed; absent optional fields are `null`. The route still owns
 * actual INSERT formatting (default fallbacks for shift_date,
 * completed_at, area) — this just gives a clean shape.
 */
export interface NormalizedCleaningLog {
  task: string;
  area: string | null;
  notes: string | null;
  shift_date: string | null;
  completed_at: string | null;
  cook_id: string | null;
  verified_by_cook_id: string | null;
  schedule_id: number | null;
}

export type ValidateResult =
  | { ok: true; value: NormalizedCleaningLog }
  | { ok: false; reason: string };

// ── Helpers ───────────────────────────────────────────────────────

const SHIFT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v)
  );
}

function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseIsoStrict(ts: unknown): number | null {
  if (typeof ts !== 'string' || ts.length === 0) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// ── Validator ─────────────────────────────────────────────────────

export function validateCleaningLog(input: unknown): ValidateResult {
  if (!isPlainObject(input)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const body = input as CleaningLogInput;

  // 1. Task identifier: at least one of item/task must be a non-empty string.
  if (body.item !== undefined && body.item !== null && typeof body.item !== 'string') {
    return { ok: false, reason: 'item must be a string' };
  }
  if (body.task !== undefined && body.task !== null && typeof body.task !== 'string') {
    return { ok: false, reason: 'task must be a string' };
  }
  const itemTrim = trimOrEmpty(body.item);
  const taskTrim = trimOrEmpty(body.task);
  if (!itemTrim && !taskTrim) {
    return { ok: false, reason: 'item or task is required' };
  }
  const taskValue = itemTrim || taskTrim;
  if (taskValue.length > TASK_MAX_LEN) {
    return {
      ok: false,
      reason: `task length ${taskValue.length} exceeds the ${TASK_MAX_LEN}-char limit`,
    };
  }

  // 2. area — optional, must be string if provided.
  let areaValue: string | null = null;
  if (body.area !== undefined && body.area !== null) {
    if (typeof body.area !== 'string') {
      return { ok: false, reason: 'area must be a string' };
    }
    if (body.area.length > AREA_MAX_LEN) {
      return {
        ok: false,
        reason: `area length ${body.area.length} exceeds the ${AREA_MAX_LEN}-char limit`,
      };
    }
    areaValue = body.area.trim() || null;
  }

  // 3. notes — optional, must be string if provided. Empty string is
  //    intentionally allowed (the route trims+clips). Length bound
  //    matches the route's slice(0, 500).
  let notesValue: string | null = null;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') {
      return { ok: false, reason: 'notes must be a string' };
    }
    if (body.notes.length > NOTES_MAX_LEN) {
      return {
        ok: false,
        reason: `notes length ${body.notes.length} exceeds the ${NOTES_MAX_LEN}-char limit`,
      };
    }
    const trimmedNotes = body.notes.trim();
    notesValue = trimmedNotes.length === 0 ? null : trimmedNotes;
  }

  // 4. completed_at — optional, must be a parseable ISO timestamp.
  let completedAtValue: string | null = null;
  if (body.completed_at !== undefined && body.completed_at !== null) {
    if (typeof body.completed_at !== 'string') {
      return { ok: false, reason: 'completed_at must be an ISO-8601 string' };
    }
    if (body.completed_at.length > COMPLETED_AT_MAX_LEN) {
      return {
        ok: false,
        reason: `completed_at length ${body.completed_at.length} exceeds the ${COMPLETED_AT_MAX_LEN}-char limit`,
      };
    }
    if (parseIsoStrict(body.completed_at) === null) {
      return { ok: false, reason: 'completed_at must be an ISO-8601 timestamp' };
    }
    completedAtValue = body.completed_at;
  }

  // 5. shift_date — optional, must be YYYY-MM-DD (sortable form).
  let shiftDateValue: string | null = null;
  if (body.shift_date !== undefined && body.shift_date !== null) {
    if (typeof body.shift_date !== 'string') {
      return { ok: false, reason: 'shift_date must be a YYYY-MM-DD string' };
    }
    if (body.shift_date.length > SHIFT_DATE_MAX_LEN) {
      return {
        ok: false,
        reason: `shift_date length ${body.shift_date.length} exceeds the ${SHIFT_DATE_MAX_LEN}-char limit`,
      };
    }
    if (!SHIFT_DATE_RE.test(body.shift_date)) {
      return { ok: false, reason: 'shift_date must match YYYY-MM-DD' };
    }
    shiftDateValue = body.shift_date;
  }

  // 6. cook_id / verified_by_cook_id — optional, must be string if provided.
  let cookIdValue: string | null = null;
  if (body.cook_id !== undefined && body.cook_id !== null) {
    if (typeof body.cook_id !== 'string') {
      return { ok: false, reason: 'cook_id must be a string' };
    }
    if (body.cook_id.length > COOK_ID_MAX_LEN) {
      return {
        ok: false,
        reason: `cook_id length ${body.cook_id.length} exceeds the ${COOK_ID_MAX_LEN}-char limit`,
      };
    }
    cookIdValue = body.cook_id.trim() || null;
  }

  let verifiedByCookIdValue: string | null = null;
  if (body.verified_by_cook_id !== undefined && body.verified_by_cook_id !== null) {
    if (typeof body.verified_by_cook_id !== 'string') {
      return { ok: false, reason: 'verified_by_cook_id must be a string' };
    }
    if (body.verified_by_cook_id.length > COOK_ID_MAX_LEN) {
      return {
        ok: false,
        reason: `verified_by_cook_id length ${body.verified_by_cook_id.length} exceeds the ${COOK_ID_MAX_LEN}-char limit`,
      };
    }
    verifiedByCookIdValue = body.verified_by_cook_id.trim() || null;
  }

  // 7. schedule_id — optional, must be a positive integer (or a string
  //    of digits since the route does Number(body.schedule_id)).
  let scheduleIdValue: number | null = null;
  if (body.schedule_id !== undefined && body.schedule_id !== null) {
    let n: number;
    if (typeof body.schedule_id === 'number') {
      n = body.schedule_id;
    } else if (typeof body.schedule_id === 'string' && body.schedule_id.length > 0) {
      n = Number(body.schedule_id);
    } else {
      return { ok: false, reason: 'schedule_id must be a number or numeric string' };
    }
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { ok: false, reason: 'schedule_id must be a positive integer' };
    }
    scheduleIdValue = n;
  }

  // Inputs are otherwise ignored: `done` is a UI-side toggle the route
  // doesn't persist; isNonEmptyString stays exported for legacy callers.
  void isNonEmptyString;

  return {
    ok: true,
    value: {
      task: taskValue,
      area: areaValue,
      notes: notesValue,
      shift_date: shiftDateValue,
      completed_at: completedAtValue,
      cook_id: cookIdValue,
      verified_by_cook_id: verifiedByCookIdValue,
      schedule_id: scheduleIdValue,
    },
  };
}
