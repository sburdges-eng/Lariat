// 7-day date marking for PHF/TCS RTE food (FDA §3-501.17) — F2.
//
// Rule: RTE TCS food held >24h at ≤ 41°F must be marked with a discard
// date ≤ 7 days from the day of preparation. Day of prep = day 1. So
// food prepped Monday is OK through Sunday; must be tossed first thing
// Monday (day 8).
//
// This module is pure: the caller owns the DB. `computeDiscardOn(prep)`
// returns the YYYY-MM-DD the batch must be tossed by.
//
// Edge cases deliberately enforced:
// - prep date must be valid YYYY-MM-DD (ISO 8601 calendar date).
// - discard-on calculation uses UTC-safe math (addDays on the parsed
//   UTC ms) so a DST transition never shortens or extends the window.
// - if a batch is tossed early (`early_use`), the row stays in the log
//   with discarded_at set. The discard_on stays at whatever was computed
//   at prep time — we do NOT rewrite history.

// Day 1 is the day of prep, so the window ends 6 calendar days later.
export const HOLDING_DAYS_AFTER_PREP = 6;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValidateResult = { ok: true } | { ok: false; reason: string };

// ── Date math ─────────────────────────────────────────────────────

function parseDateStrict(s: unknown): Date | null {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  // Construct as UTC so addDays isn't surprised by DST. We only ever
  // need the calendar date, not wall-clock time.
  const parts = s.split('-').map((p) => parseInt(p, 10));
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  // Guard against non-existent dates like 2026-02-30 (Date.UTC
  // normalizes them but we want strict).
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Given a YYYY-MM-DD prep date, return the YYYY-MM-DD by which the
 * batch must be discarded. Throws on malformed input rather than
 * returning a wrong date silently — this is a regulated calculation.
 */
export function computeDiscardOn(prepared_on: string): string {
  const dt = parseDateStrict(prepared_on);
  if (!dt) throw new Error(`Invalid prepared_on: ${JSON.stringify(prepared_on)}`);
  dt.setUTCDate(dt.getUTCDate() + HOLDING_DAYS_AFTER_PREP);
  return formatDate(dt);
}

export interface DateMarkCreateInput {
  item: unknown;
  prepared_on: unknown;
  batch_ref?: unknown;
}

export function validateDateMarkCreate(x: DateMarkCreateInput): ValidateResult {
  if (typeof x.item !== 'string' || x.item.trim().length === 0) {
    return { ok: false, reason: 'Item is required' };
  }
  if (typeof x.prepared_on !== 'string' || !parseDateStrict(x.prepared_on)) {
    return { ok: false, reason: 'prepared_on must be a YYYY-MM-DD date' };
  }
  return { ok: true };
}

export interface DateMarkRowSnapshot {
  id: number;
  item: string;
  prepared_on: string;
  discard_on: string;
  discarded_at: string | null;
}

export interface ExpiringBatch {
  id: number;
  item: string;
  discard_on: string;
  days_until_discard: number;   // 0 = discard today, negative = past due
  status: 'ok' | 'due_today' | 'expired';
}

/**
 * Given a set of active date marks and today's date, report which are
 * expiring today (status=due_today) or past due (status=expired). The
 * UI paints expired in red and due-today in yellow.
 *
 * Takes `today` as a param so tests can freeze time. Callers should
 * already have filtered to rows where discarded_at IS NULL.
 */
export function scanExpiringBatches(
  rows: DateMarkRowSnapshot[],
  today: string,
): ExpiringBatch[] {
  const now = parseDateStrict(today);
  if (!now) throw new Error(`Invalid today: ${JSON.stringify(today)}`);
  const out: ExpiringBatch[] = [];
  for (const r of rows) {
    if (r.discarded_at !== null) continue;
    const disc = parseDateStrict(r.discard_on);
    if (!disc) continue;
    const daysUntil = Math.round((disc.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    let status: ExpiringBatch['status'];
    if (daysUntil < 0) status = 'expired';
    else if (daysUntil === 0) status = 'due_today';
    else status = 'ok';
    out.push({
      id: r.id,
      item: r.item,
      discard_on: r.discard_on,
      days_until_discard: daysUntil,
      status,
    });
  }
  // Sort: expired first (most-past-due on top), then due_today, then ok ascending.
  out.sort((a, b) => a.days_until_discard - b.days_until_discard);
  return out;
}
