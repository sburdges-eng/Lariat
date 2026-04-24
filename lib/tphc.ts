// Time as Public Health Control (§3-501.19) — F11.
//
// An alternative to temperature control for TCS food: the food stays
// safe because the time since it left temp control is capped, not
// because it stays cold/hot. Two variants in the Food Code:
//
//   (A) Hot food held without temperature control — max 4 hours from
//       the moment it leaves temp control. Must be served or discarded
//       by cutoff.
//   (B) Cold food held without temperature control — max 6 hours.
//       Food must be ≤ 41°F at start and ≤ 70°F at cutoff (not modelled
//       here; the cutoff is the enforceable artifact).
//
// This module is pure: the caller owns the DB. `computeCutoffAt(started_at, kind)`
// returns the ISO timestamp at which the batch must be discarded.
//
// Edge cases deliberately enforced:
// - started_at must be a valid ISO 8601 instant (RFC 3339 with offset or Z).
// - kind must be one of TPHC_KINDS; unknown kinds are rejected.
// - cutoff_at math is UTC-safe (adds whole hours to the parsed instant),
//   so a DST boundary cannot shorten or extend the window.
// - if a batch is discarded or consumed before cutoff, the row stays in
//   the log with discarded_at set. cutoff_at stays at whatever was
//   computed at start — we do NOT rewrite history.

export const TPHC_HOT_HOURS = 4;
export const TPHC_COLD_HOURS = 6;

export const TPHC_KINDS = ['hot_time_only', 'cold_time_only'] as const;
export type TphcKind = (typeof TPHC_KINDS)[number];

export const TPHC_DISCARD_REASONS = [
  'reached_cutoff',
  'consumed',
  'quality',
  'contamination',
] as const;
export type TphcDiscardReason = (typeof TPHC_DISCARD_REASONS)[number];

// Warn when less than this many minutes remain (yellow tile).
export const TPHC_WARNING_MINUTES = 30;

export type ValidateResult = { ok: true } | { ok: false; reason: string };

// ── Time math ─────────────────────────────────────────────────────

function parseInstantStrict(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject invalid or ambiguously-parsed strings (Date() is permissive).
  // Require at least a date fragment; don't accept "2026" alone.
  if (!/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  return dt;
}

export function hoursFor(kind: TphcKind): number {
  if (kind === 'hot_time_only') return TPHC_HOT_HOURS;
  if (kind === 'cold_time_only') return TPHC_COLD_HOURS;
  throw new Error(`Unknown TPHC kind: ${String(kind)}`);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Given an ISO instant and a TPHC kind, return the ISO instant at
 * which the batch must be discarded. Throws on malformed input rather
 * than returning a wrong time silently — this is a regulated
 * calculation.
 */
export function computeCutoffAt(started_at: string, kind: TphcKind): string {
  const start = parseInstantStrict(started_at);
  if (!start) throw new Error(`Invalid started_at: ${JSON.stringify(started_at)}`);
  const ms = start.getTime() + hoursFor(kind) * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export interface TphcCreateInput {
  item: unknown;
  started_at: unknown;
  kind: unknown;
  batch_ref?: unknown;
  station_id?: unknown;
}

export function isTphcKind(x: unknown): x is TphcKind {
  return typeof x === 'string' && (TPHC_KINDS as readonly string[]).includes(x);
}

export function isTphcDiscardReason(x: unknown): x is TphcDiscardReason {
  return typeof x === 'string' && (TPHC_DISCARD_REASONS as readonly string[]).includes(x);
}

export function validateTphcCreate(x: TphcCreateInput): ValidateResult {
  if (typeof x.item !== 'string' || x.item.trim().length === 0) {
    return { ok: false, reason: 'Item is required' };
  }
  if (typeof x.started_at !== 'string' || !parseInstantStrict(x.started_at)) {
    return { ok: false, reason: 'started_at must be an ISO 8601 timestamp' };
  }
  if (!isTphcKind(x.kind)) {
    return {
      ok: false,
      reason: `kind must be one of: ${TPHC_KINDS.join(', ')}`,
    };
  }
  return { ok: true };
}

export interface TphcRowSnapshot {
  id: number;
  item: string;
  station_id: string | null;
  started_at: string;
  cutoff_at: string;
  discarded_at: string | null;
}

export interface TphcBatchStatus {
  id: number;
  item: string;
  station_id: string | null;
  started_at: string;
  cutoff_at: string;
  minutes_until_cutoff: number; // negative = past cutoff
  status: 'ok' | 'warning' | 'expired';
}

/**
 * Given active TPHC rows and a reference 'now' ISO instant, classify
 * each row as ok / warning / expired.
 *
 * - expired: cutoff_at ≤ now. The food is non-compliant; the cook must
 *   discard and record a discard_reason='reached_cutoff' row.
 * - warning: cutoff_at > now AND minutes_until_cutoff ≤ TPHC_WARNING_MINUTES.
 * - ok: more than TPHC_WARNING_MINUTES of window remaining.
 *
 * Caller should filter to rows where discarded_at IS NULL before
 * passing in. Sort order: most-past-due first, then nearest-cutoff.
 */
export function scanActiveTphc(
  rows: TphcRowSnapshot[],
  now: string,
): TphcBatchStatus[] {
  const ref = parseInstantStrict(now);
  if (!ref) throw new Error(`Invalid now: ${JSON.stringify(now)}`);
  const refMs = ref.getTime();

  const out: TphcBatchStatus[] = [];
  for (const r of rows) {
    if (r.discarded_at !== null) continue;
    const cutoff = parseInstantStrict(r.cutoff_at);
    if (!cutoff) continue;
    const minutesUntil = Math.round((cutoff.getTime() - refMs) / (60 * 1000));
    let status: TphcBatchStatus['status'];
    if (minutesUntil <= 0) status = 'expired';
    else if (minutesUntil <= TPHC_WARNING_MINUTES) status = 'warning';
    else status = 'ok';
    out.push({
      id: r.id,
      item: r.item,
      station_id: r.station_id,
      started_at: r.started_at,
      cutoff_at: r.cutoff_at,
      minutes_until_cutoff: minutesUntil,
      status,
    });
  }
  out.sort((a, b) => a.minutes_until_cutoff - b.minutes_until_cutoff);
  return out;
}
