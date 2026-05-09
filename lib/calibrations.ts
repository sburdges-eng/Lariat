// Thermometer-calibration rule module (F9 / FDA §4-502.11).
//
// FDA §4-502.11 requires that food temperature measuring devices
// (probes, IR guns, etc.) be accurate within ±2°F / ±1°C, and that
// the operator verify calibration periodically. Two methods are
// industry standard:
//
//   - ice_point      — probe in a 50/50 crushed-ice-and-water slurry,
//                      let stabilize ~30s, target 32°F ±2.
//   - boiling_point  — probe in vigorously boiling water, target 212°F
//                      at sea level. Water's boiling point drops by
//                      roughly 1°F per 550 ft of elevation gain, so at
//                      Lariat's 7,800 ft (Buena Vista, CO) the target
//                      is ≈ 197.8°F — NOT 212°F. A probe reading 212°F
//                      at altitude would actually be out of spec, since
//                      water does not boil at 212°F there.
//
// This module is pure — no DB, no side effects, no clock read. The
// /api/thermometer-calibrations route owns persistence + audit
// emission. Unlike temp-log or receiving, we PERSIST every reading,
// including fails: the audit trail wants to know the probe drifted
// BEFORE an operator caught and pulled it. A 422 would force the
// operator to re-enter the breach they just recorded.
//
// Citations are FDA 2022 Food Code (Colorado incorporates by reference).

// ── Methods ───────────────────────────────────────────────────────

export const CALIBRATION_METHODS = {
  ICE_POINT: 'ice_point',
  BOILING_POINT: 'boiling_point',
} as const;

export type CalibrationMethod =
  (typeof CALIBRATION_METHODS)[keyof typeof CALIBRATION_METHODS];

// The DB's CHECK constraint on `method` also allows 'reference_probe'
// but the rule module does not define a target for it — reference
// probe calibrations require a separate reference-probe reading to
// compare against and are out of scope for Bundle G.

export function isCalibrationMethod(x: unknown): x is CalibrationMethod {
  return x === 'ice_point' || x === 'boiling_point';
}

// ── Lariat geography ──────────────────────────────────────────────

/**
 * Lariat's home elevation (Buena Vista, CO). Used as the default
 * `elevation_ft` when a caller doesn't pass one. Surfaced as a named
 * constant so a future deployment at another altitude can override
 * cleanly without grepping magic numbers.
 *
 * NB: Buena Vista sits at ~7,965 ft, Salida at ~7,083 ft; 7,800 ft is
 * the midpoint the kitchen uses on the existing calibration SOP taped
 * above the probe rack. If the deployment moves or a second location
 * opens, this constant should become a per-location override — at
 * that point, plumb it through `locations.elevation_ft` or a
 * config-level env.
 */
export const LARIAT_ELEVATION_FT = 7800;

/** ±2°F tolerance per FDA §4-502.11. Inclusive on both ends. */
export const TOLERANCE_F = 2.0;

/** Default calibration frequency — 30 days between verifications. */
export const DEFAULT_FREQUENCY_DAYS = 30;

/** Days before `next_due_at` that a probe is flagged 'due_soon'. */
export const DUE_SOON_WINDOW_DAYS = 7;

/** Sea-level boiling point of pure water, °F. */
export const SEA_LEVEL_BOIL_F = 212;

/**
 * Elevation change (ft) that drops water's boiling point by 1°F.
 * Linear approximation — holds well below 10,000 ft and is the form
 * the FSIS altitude-adjusted cooking tables use. At 7800 ft this
 * yields a ≈14.18°F correction (212 − 7800/550 = 197.82°F).
 */
export const BOILING_POINT_FT_PER_F = 550;

/**
 * Boiling point in °F at a given elevation. Pure; deterministic.
 * `elevation_ft <= 0` returns 212°F (sea level or below — we don't
 * model the small increase below sea level). Non-finite input falls
 * back to the sea-level number so the rule module never throws on
 * bad callers — validation surfaces the issue earlier via the route.
 */
export function boilingPointF(elevation_ft: number): number {
  if (!Number.isFinite(elevation_ft) || elevation_ft <= 0) {
    return SEA_LEVEL_BOIL_F;
  }
  return SEA_LEVEL_BOIL_F - elevation_ft / BOILING_POINT_FT_PER_F;
}

/**
 * Expected reading for a method at a given altitude. Ice point is
 * 32°F regardless of altitude — the triple point of water sits at
 * the same temperature wherever gravity is. Boiling point uses the
 * altitude correction.
 */
export function expectedReadingF(
  method: CalibrationMethod,
  elevation_ft = LARIAT_ELEVATION_FT,
): number {
  if (method === 'ice_point') return 32;
  return boilingPointF(elevation_ft);
}

// ── Validation ────────────────────────────────────────────────────

export type CalibrationStatus = 'pass' | 'fail';

export interface ValidateCalibrationInput {
  method: unknown;
  reading_f: unknown;
  /** Defaults to Lariat's elevation. */
  elevation_ft?: unknown;
}

export interface ValidateCalibrationResult {
  status: CalibrationStatus;
  method: CalibrationMethod;
  /** Expected °F (32 for ice_point, altitude-corrected for boiling). */
  expected_f: number;
  /** ±°F tolerance per §4-502.11. */
  tolerance_f: number;
  /** `reading_f − expected_f`. Signed. */
  deviation_f: number;
  /** FDA §-cite surfaced on the UI tile + in audit rows. */
  citation: string;
  /** Human-readable reason; null when status='pass'. */
  reason: string | null;
  /** Elevation used to compute expected_f (boiling path only, but
   *  written for both so the audit row carries it unconditionally). */
  elevation_ft: number;
}

const CITATION = 'FDA §4-502.11 — temp measuring device accurate within ±2°F';

/** Safety clamp — readings outside [-100°F, 500°F] are "probe broken". */
const ABS_MIN_F = -100;
const ABS_MAX_F = 500;

/**
 * Validate a single calibration reading. Pure.
 *
 * - Throws on unknown method (caller should guard first with
 *   `isCalibrationMethod`). Throwing is intentional: unlike receiving,
 *   there's no graceful fallback — without a method we don't know what
 *   target to compare against.
 * - Throws on non-finite reading (the API route 400s before this point).
 * - Returns `status: 'pass'` iff |reading − expected| ≤ TOLERANCE_F.
 */
export function validateCalibrationReading(
  input: ValidateCalibrationInput,
): ValidateCalibrationResult {
  if (!isCalibrationMethod(input.method)) {
    throw new Error(`unknown calibration method: ${String(input.method)}`);
  }
  const reading = input.reading_f;
  if (typeof reading !== 'number' || !Number.isFinite(reading)) {
    throw new Error('reading_f must be a finite number in °F');
  }
  if (reading < ABS_MIN_F || reading > ABS_MAX_F) {
    throw new Error(`reading_f ${reading}°F is off the charts — check the probe`);
  }

  const elevRaw =
    typeof input.elevation_ft === 'number' && Number.isFinite(input.elevation_ft)
      ? input.elevation_ft
      : LARIAT_ELEVATION_FT;

  const expected = expectedReadingF(input.method, elevRaw);
  const deviation = reading - expected;
  const absDev = Math.abs(deviation);
  const pass = absDev <= TOLERANCE_F;

  return {
    status: pass ? 'pass' : 'fail',
    method: input.method,
    expected_f: expected,
    tolerance_f: TOLERANCE_F,
    deviation_f: deviation,
    citation: CITATION,
    reason: pass
      ? null
      : `reading ${reading}°F is ${absDev.toFixed(1)}°F off the ${expected.toFixed(1)}°F target (tolerance ±${TOLERANCE_F}°F)`,
    elevation_ft: elevRaw,
  };
}

// ── Per-probe aggregation ─────────────────────────────────────────

/**
 * A single calibration row as it lives in the DB (or an equivalent
 * shape from a test fixture). Unused fields on the row are ignored.
 */
export interface CalibrationRow {
  thermometer_id: string;
  method: string;
  before_reading_f: number | null;
  passed: number; // 0 or 1
  calibrated_at: string; // ISO datetime 'YYYY-MM-DD HH:MM:SS' or YYYY-MM-DD
  /** Per-probe override for the 30-day default. NULL means use the default. */
  frequency_days: number | null;
}

/**
 * Tile-level status for the calibrations board:
 *
 *   - ok        : last calibration was a pass AND within the frequency window
 *   - due_soon  : last calibration was a pass, but within DUE_SOON_WINDOW_DAYS
 *                 of expiration. Amber-on-the-board: operator should plan it.
 *   - overdue   : last calibration was a pass but past the frequency window.
 *                 Red — probe can still be used but the calibration chain
 *                 broke; a recalibration is the immediate corrective action.
 *   - failed    : the MOST RECENT reading was a fail. Red — probe is flagged
 *                 as unreliable until a subsequent passing calibration.
 *   - unknown   : no calibration record exists for this probe. Gray tile.
 */
export type ProbeStatus = 'ok' | 'due_soon' | 'overdue' | 'failed' | 'unknown';

export interface ProbeSummary {
  thermometer_id: string;
  status: ProbeStatus;
  last_calibrated_at: string | null;
  last_method: CalibrationMethod | 'reference_probe' | null;
  last_reading_f: number | null;
  last_passed: boolean | null;
  next_due_at: string | null;
  frequency_days: number;
  /** Number of calibration rows aggregated into this summary. */
  total: number;
}

export interface ClassifyProbesOptions {
  /** Evaluation instant — defaults to `new Date()`. */
  now?: Date;
  /** Default frequency in days (per probe override wins). */
  frequency_days?: number;
  /** Optional fixed list of probe ids to include even when absent
   *  from `rows`. Each missing probe renders as a gray `unknown`
   *  tile. Useful for a registry-first board layout. */
  known_probe_ids?: readonly string[];
}

/**
 * Parse a sqlite-style timestamp. 'YYYY-MM-DD HH:MM:SS' is the
 * datetime('now') default; 'YYYY-MM-DD' is what the UI might send
 * when only a date is recorded. Both are treated as UTC so the same
 * comparison works cross-tz. Returns null on unparseable input.
 */
function parseTs(s: string | null | undefined): Date | null {
  if (typeof s !== 'string' || !s) return null;
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  const iso = hasTz ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Aggregate calibration rows into one summary per probe.
 *
 * Within each probe, rows are sorted by `calibrated_at DESC` — the
 * MOST RECENT row drives the status. This matches the "probe is
 * flagged until a subsequent passing calibration" policy: as soon as
 * the operator logs a pass after a fail, the tile flips back to
 * 'ok' (or 'due_soon'/'overdue' if the next-due window already moved).
 */
export function classifyProbes(
  rows: readonly CalibrationRow[],
  opts: ClassifyProbesOptions = {},
): ProbeSummary[] {
  const now = opts.now ?? new Date();
  const defaultFreq = opts.frequency_days ?? DEFAULT_FREQUENCY_DAYS;

  const grouped = new Map<string, CalibrationRow[]>();
  for (const r of rows) {
    if (!r || typeof r.thermometer_id !== 'string' || !r.thermometer_id) continue;
    const bucket = grouped.get(r.thermometer_id) ?? [];
    bucket.push(r);
    grouped.set(r.thermometer_id, bucket);
  }

  const ids = new Set<string>(grouped.keys());
  if (opts.known_probe_ids) {
    for (const id of opts.known_probe_ids) ids.add(id);
  }

  const out: ProbeSummary[] = [];
  for (const id of Array.from(ids)) {
    const bucket = grouped.get(id) ?? [];
    if (bucket.length === 0) {
      out.push({
        thermometer_id: id,
        status: 'unknown',
        last_calibrated_at: null,
        last_method: null,
        last_reading_f: null,
        last_passed: null,
        next_due_at: null,
        frequency_days: defaultFreq,
        total: 0,
      });
      continue;
    }

    // Sort newest-first. Ties broken lexicographically on
    // calibrated_at — consistent, deterministic.
    const sorted = [...bucket].sort((a, b) => {
      const av = a.calibrated_at || '';
      const bv = b.calibrated_at || '';
      if (av > bv) return -1;
      if (av < bv) return 1;
      return 0;
    });
    const last = sorted[0]!;
    const freq =
      typeof last.frequency_days === 'number' && last.frequency_days > 0
        ? last.frequency_days
        : defaultFreq;

    const lastAt = parseTs(last.calibrated_at);
    const passed = last.passed === 1 || (last.passed as unknown) === true;

    let status: ProbeStatus;
    let nextDue: string | null = null;
    if (!passed) {
      status = 'failed';
    } else if (!lastAt) {
      // Passed but unparseable timestamp — treat as 'ok' (the row is
      // there, we just can't tell when). The DB column is NOT NULL so
      // this should only happen with malformed fixtures.
      status = 'ok';
    } else {
      const dueMs = lastAt.getTime() + freq * 86400000;
      const dueDate = new Date(dueMs);
      nextDue = dueDate.toISOString();
      const msRemaining = dueMs - now.getTime();
      const daysRemaining = msRemaining / 86400000;
      if (daysRemaining < 0) {
        status = 'overdue';
      } else if (daysRemaining <= DUE_SOON_WINDOW_DAYS) {
        status = 'due_soon';
      } else {
        status = 'ok';
      }
    }

    const method = last.method as ProbeSummary['last_method'];
    out.push({
      thermometer_id: id,
      status,
      last_calibrated_at: last.calibrated_at ?? null,
      last_method:
        method === 'ice_point' ||
        method === 'boiling_point' ||
        method === 'reference_probe'
          ? method
          : null,
      last_reading_f:
        typeof last.before_reading_f === 'number' ? last.before_reading_f : null,
      last_passed: passed,
      next_due_at: nextDue,
      frequency_days: freq,
      total: bucket.length,
    });
  }

  // Stable order for the UI: failed → overdue → due_soon → unknown → ok,
  // tie-break by probe id.
  const rank: Record<ProbeStatus, number> = {
    failed: 0,
    overdue: 1,
    due_soon: 2,
    unknown: 3,
    ok: 4,
  };
  out.sort((a, b) => {
    const ra = rank[a.status];
    const rb = rank[b.status];
    if (ra !== rb) return ra - rb;
    return a.thermometer_id < b.thermometer_id ? -1 : 1;
  });
  return out;
}

// ── temp-log integration ──────────────────────────────────────────

/**
 * Given a probe's latest state, decide whether a temp-log write that
 * references the probe should emit an advisory warning. This is the
 * "writes from uncalibrated probes are advisory, not hard reject"
 * contract — the temp-log POST never rejects on this, it just
 * surfaces the message to the cook and persists it on the audit row.
 *
 * Returns null when the probe is fine (ok or due_soon — due_soon is
 * a BOARD-level signal, not a per-write warning: the cook still has
 * a valid calibration).
 */
export function calibrationWarningFor(
  summary: ProbeSummary | null | undefined,
): string | null {
  if (!summary) return null;
  if (summary.status === 'unknown') {
    return `probe "${summary.thermometer_id}" has no calibration on record — log an ice-point or boiling-point calibration before using it for a CCP reading`;
  }
  if (summary.status === 'failed') {
    return `probe "${summary.thermometer_id}" failed its last calibration on ${summary.last_calibrated_at ?? '?'} — recalibrate before using it for a CCP reading`;
  }
  if (summary.status === 'overdue') {
    return `probe "${summary.thermometer_id}" is overdue for calibration (last: ${summary.last_calibrated_at ?? '?'}, due: ${summary.next_due_at ?? '?'}) — recalibrate`;
  }
  return null;
}
