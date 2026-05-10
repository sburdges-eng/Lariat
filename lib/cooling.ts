// Two-stage cooling (FDA Food Code 2022 §3-501.14) — CCP-8.
//
// Rule: TCS food cooled from 135°F must reach 70°F within 2h and 41°F
// within 4h MORE (6h total). Either leg missed = breach. Open rows that
// sit past the cutoff without a reading are ALSO breaches — silence is
// not passing. This module is pure; the API route wraps it with DB I/O.
//
// Design notes:
// - Time math uses ms since epoch. Inputs are ISO 8601 strings; the
//   parser accepts whatever `Date.parse` accepts. A rejected parse is
//   a validation error, not a silent 0.
// - The classifier is deliberately strict: stage1 is 70°F exactly (not
//   "close enough"). FDA wording is "cooled from 135°F to 70°F in 2h."
//   A reading of 70.5°F at 1h 58m is NOT stage 1. Callers who want to
//   round for UI display can do so in the UI layer.

import type { CoolingLogEntry } from './db.ts';

// Phase-1 ceiling: food must be AT or BELOW this to close stage 1.
export const STAGE1_CEILING_F = 70;
// Phase-2 ceiling: food must be AT or BELOW this to close stage 2.
export const STAGE2_CEILING_F = 41;

// Hour budgets per FDA §3-501.14(A).
export const STAGE1_MAX_MINUTES = 2 * 60;      // 120 min from started_at
export const STAGE2_MAX_MINUTES = 4 * 60;      // 240 min from stage1_at
export const TOTAL_MAX_MINUTES = STAGE1_MAX_MINUTES + STAGE2_MAX_MINUTES; // 360

// Absolute sanity range for readings in case of a broken probe or typo.
const ABSOLUTE_MIN_F = -100;
const ABSOLUTE_MAX_F = 500;

export type ValidateResult = { ok: true } | { ok: false; reason: string };

export type CoolingStatus = CoolingLogEntry['status'];
export type BreachReason =
  | 'stage1_over_2h'
  | 'stage2_over_4h'
  | 'stage1_reading_above_70'
  | 'stage2_reading_above_41'
  | 'discarded'
  | 'stale_open';

// ── Helpers ───────────────────────────────────────────────────────

function parseIsoStrict(ts: unknown): number | null {
  if (typeof ts !== 'string' || ts.length === 0) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function minutesBetween(a: string, b: string): number | null {
  const ta = parseIsoStrict(a);
  const tb = parseIsoStrict(b);
  if (ta === null || tb === null) return null;
  return (tb - ta) / 60000;
}

function isFiniteReading(f: unknown): f is number {
  return (
    typeof f === 'number' &&
    Number.isFinite(f) &&
    f >= ABSOLUTE_MIN_F &&
    f <= ABSOLUTE_MAX_F
  );
}

// ── Starting a cooling batch ──────────────────────────────────────

export interface CoolingStartInput {
  item: unknown;
  started_at: unknown;
  start_reading_f: unknown;
}

export function validateCoolingStart(x: CoolingStartInput): ValidateResult {
  if (typeof x.item !== 'string' || x.item.trim().length === 0) {
    return { ok: false, reason: 'Item name is required' };
  }
  if (parseIsoStrict(x.started_at) === null) {
    return { ok: false, reason: 'started_at must be an ISO timestamp' };
  }
  // start_reading_f may be null/undefined (the cook may not have probed
  // it at pull-time — the BATCH is still valid; they'll record stage1
  // within 2h and that reading is what the compliance test needs).
  if (x.start_reading_f !== null && x.start_reading_f !== undefined) {
    if (!isFiniteReading(x.start_reading_f)) {
      return { ok: false, reason: 'start_reading_f is off the charts — check the probe' };
    }
    // 135°F is the FDA trigger temp; anything below 135 at pull-time
    // means the cooling clock started late. Not a hard error (the
    // cook may have probed after plating) but worth surfacing.
    // We accept and let classifyCoolingStage surface the breach later
    // if a downstream reading fails.
  }
  return { ok: true };
}

// ── Recording a stage reading ─────────────────────────────────────

export interface CoolingStageInput {
  // The open row as it exists in the DB (with started_at + stage1_at
  // possibly populated). Matches the shape from `SELECT * FROM cooling_log`.
  row: Pick<CoolingLogEntry,
    'started_at' | 'stage1_at' | 'stage1_reading_f' | 'stage2_at' | 'status'
  >;
  reading_f: unknown;
  at: unknown;                      // ISO 8601 timestamp of the reading
  corrective_action?: unknown;      // required if stage over-budget or over-temp
}

export type StageDecision =
  | {
      ok: true;
      stage: 1 | 2;
      status: 'in_progress' | 'ok' | 'breach';
      breach_reason: BreachReason | null;
      minutes_elapsed: number;
    }
  | { ok: false; reason: string };

/**
 * Classify a new cooling reading as closing stage 1 or stage 2, and
 * decide whether the batch is now OK, still in progress (stage 1 done
 * but stage 2 not), or in breach.
 */
export function classifyCoolingStage(x: CoolingStageInput): StageDecision {
  if (!isFiniteReading(x.reading_f)) {
    return { ok: false, reason: 'Reading must be a finite °F number' };
  }
  if (parseIsoStrict(x.at) === null) {
    return { ok: false, reason: 'Reading timestamp must be ISO 8601' };
  }
  if (x.row.status !== 'in_progress') {
    return { ok: false, reason: `Cooling batch already closed (status=${x.row.status})` };
  }

  // Stage 1 hasn't closed yet.
  if (!x.row.stage1_at) {
    const elapsed = minutesBetween(x.row.started_at, x.at as string);
    if (elapsed === null) {
      return { ok: false, reason: 'Cannot compute elapsed time — batch started_at is not a valid ISO timestamp' };
    }
    if (elapsed < 0) {
      return { ok: false, reason: 'Reading is before the batch start time' };
    }

    // Stage 1 close: reading must be ≤ 70 AND within 2h.
    if (x.reading_f > STAGE1_CEILING_F) {
      // Still not cold enough — stays in progress unless the clock ran out.
      if (elapsed > STAGE1_MAX_MINUTES) {
        return {
          ok: true,
          stage: 1,
          status: 'breach',
          breach_reason: 'stage1_over_2h',
          minutes_elapsed: elapsed,
        };
      }
      return {
        ok: true,
        stage: 1,
        status: 'in_progress',
        breach_reason: null,
        minutes_elapsed: elapsed,
      };
    }

    // Reading ≤ 70: closes stage 1. Still a breach if over 2h.
    if (elapsed > STAGE1_MAX_MINUTES) {
      return {
        ok: true,
        stage: 1,
        status: 'breach',
        breach_reason: 'stage1_over_2h',
        minutes_elapsed: elapsed,
      };
    }
    return {
      ok: true,
      stage: 1,
      status: 'in_progress',   // stage 1 closed, stage 2 still open
      breach_reason: null,
      minutes_elapsed: elapsed,
    };
  }

  // Stage 1 already closed — we're closing stage 2.
  const stage2Elapsed = minutesBetween(x.row.stage1_at, x.at as string);
  if (stage2Elapsed === null || stage2Elapsed < 0) {
    return { ok: false, reason: 'Reading is before the stage-1 timestamp' };
  }

  if (x.reading_f > STAGE2_CEILING_F) {
    if (stage2Elapsed > STAGE2_MAX_MINUTES) {
      return {
        ok: true,
        stage: 2,
        status: 'breach',
        breach_reason: 'stage2_over_4h',
        minutes_elapsed: stage2Elapsed,
      };
    }
    return {
      ok: true,
      stage: 2,
      status: 'in_progress',
      breach_reason: null,
      minutes_elapsed: stage2Elapsed,
    };
  }

  // Reading ≤ 41: closes stage 2. Breach if over 4h from stage1.
  if (stage2Elapsed > STAGE2_MAX_MINUTES) {
    return {
      ok: true,
      stage: 2,
      status: 'breach',
      breach_reason: 'stage2_over_4h',
      minutes_elapsed: stage2Elapsed,
    };
  }
  return {
    ok: true,
    stage: 2,
    status: 'ok',
    breach_reason: null,
    minutes_elapsed: stage2Elapsed,
  };
}

// ── Open-batch scanner (for the dashboard) ────────────────────────

export interface OpenBatchScan {
  id: number;
  item: string;
  started_at: string;
  stage: 1 | 2;
  minutes_remaining: number;     // may be negative (= breached)
  breached: boolean;
}

/**
 * Given a list of in-progress cooling rows, compute how many minutes
 * each has left before its current stage hits the FDA limit. Negative
 * numbers mean the stage clock already expired — the UI should surface
 * these as breaches and the PIC should discard or investigate.
 *
 * `now_ms` is taken as a param so tests can freeze time.
 */
export function scanOpenBatches(
  rows: Array<Pick<CoolingLogEntry, 'id' | 'item' | 'started_at' | 'stage1_at' | 'status'>>,
  now_ms: number,
): OpenBatchScan[] {
  const out: OpenBatchScan[] = [];
  for (const r of rows) {
    if (r.status !== 'in_progress') continue;
    const started = parseIsoStrict(r.started_at);
    if (started === null) continue;

    if (!r.stage1_at) {
      const elapsedMin = (now_ms - started) / 60000;
      const remaining = STAGE1_MAX_MINUTES - elapsedMin;
      out.push({
        id: r.id,
        item: r.item,
        started_at: r.started_at,
        stage: 1,
        minutes_remaining: remaining,
        breached: remaining < 0,
      });
    } else {
      const s1 = parseIsoStrict(r.stage1_at);
      if (s1 === null) continue;
      const elapsedMin = (now_ms - s1) / 60000;
      const remaining = STAGE2_MAX_MINUTES - elapsedMin;
      out.push({
        id: r.id,
        item: r.item,
        started_at: r.started_at,
        stage: 2,
        minutes_remaining: remaining,
        breached: remaining < 0,
      });
    }
  }
  return out;
}
