// Wage notices — Colorado Wage Theft Transparency Act (C.R.S. §8-4-103)
// + COMPS Order #39 §3.3 written-notice obligation. L7.
//
// Citations:
// - C.R.S. §8-4-103 — wage statement / change-of-rate notice.
// - 7 CCR 1103-1 §3.3 (COMPS Order #39) — tip-credit written notice.
//
// An employer must give each employee a written notice of pay rate,
// pay basis, regular paydays, and (when claimed) the tip credit at
// hire and again whenever the pay rate or pay basis changes. Annual
// re-attestation is good practice and surfaces stale records before
// an audit. A new notice is required when:
//   * reason 'hire' (initial onboarding)
//   * reason 'rate_change' (pay rate or pay_basis changed)
//   * reason 'annual' (>365 days since last notice)
//   * reason 'law_change' (state/federal floor moved)
//   * reason 'other' (free-form, e.g. tip-credit toggle)
//
// This module is pure — validation + freshness math, no DB.

export const WAGE_NOTICE_REASONS = ['hire', 'rate_change', 'annual', 'law_change', 'other'] as const;
export type WageNoticeReason = (typeof WAGE_NOTICE_REASONS)[number];

export const WAGE_NOTICE_PAY_BASES = ['hourly', 'salary', 'commission', 'tipped'] as const;
export type WageNoticePayBasis = (typeof WAGE_NOTICE_PAY_BASES)[number];

export const WAGE_NOTICE_REFRESH_DAYS = 365;
export const WAGE_NOTICE_CITATION = 'C.R.S. §8-4-103 (CO Wage Theft Transparency Act); 7 CCR 1103-1 §3.3 (COMPS Order #39)';

export interface WageNoticeRow {
  id?: number;
  location_id?: string;
  cook_id: string;
  reason: WageNoticeReason;
  wage_rate_cents: number;
  pay_basis: WageNoticePayBasis;
  tip_credit_cents?: number | null;
  document_path?: string | null;
  signed_on: string;             // YYYY-MM-DD
}

export interface NoticeShapeInput {
  reason?: unknown;
  wage_rate_cents?: unknown;
  pay_basis?: unknown;
  tip_credit_cents?: unknown;
  signed_on?: unknown;
  document_path?: unknown;
}

export interface NoticeShapeResult {
  ok: boolean;
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

function isReason(x: unknown): x is WageNoticeReason {
  return typeof x === 'string' && (WAGE_NOTICE_REASONS as readonly string[]).includes(x);
}

function isPayBasis(x: unknown): x is WageNoticePayBasis {
  return typeof x === 'string' && (WAGE_NOTICE_PAY_BASES as readonly string[]).includes(x);
}

function isISODate(x: unknown): x is string {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

function daysBetween(a: string, b: string): number {
  // Both inputs are YYYY-MM-DD; treat at UTC midnight to avoid
  // timezone drift around the 365-day threshold.
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 86400000);
}

// ── Pure rules ────────────────────────────────────────────────────

/**
 * Shape-validate a wage-notice payload. Confirms enums match the
 * schema CHECK constraints, wage_rate_cents is a non-negative integer,
 * tip_credit_cents (if present) is a non-negative integer, and
 * signed_on is YYYY-MM-DD. Pure: no DB, no I/O.
 */
export function validateNoticeShape(input: NoticeShapeInput): NoticeShapeResult {
  if (!isReason(input.reason)) {
    return { ok: false, reason: `reason must be one of: ${WAGE_NOTICE_REASONS.join(', ')}` };
  }
  if (!isPayBasis(input.pay_basis)) {
    return { ok: false, reason: `pay_basis must be one of: ${WAGE_NOTICE_PAY_BASES.join(', ')}` };
  }
  if (!isInt(input.wage_rate_cents) || input.wage_rate_cents < 0) {
    return { ok: false, reason: 'wage_rate_cents must be a non-negative integer (cents — no floats)' };
  }
  if (input.tip_credit_cents !== null && input.tip_credit_cents !== undefined) {
    if (!isInt(input.tip_credit_cents) || input.tip_credit_cents < 0) {
      return { ok: false, reason: 'tip_credit_cents must be a non-negative integer or null' };
    }
    // tip_credit only makes sense on a tipped pay_basis. Surfacing
    // this early stops a copy-paste error from creating a notice
    // that claims a tip credit on a salaried role.
    if (input.pay_basis !== 'tipped' && input.tip_credit_cents > 0) {
      return { ok: false, reason: 'tip_credit_cents is only valid when pay_basis is "tipped"' };
    }
  }
  if (!isISODate(input.signed_on)) {
    return { ok: false, reason: 'signed_on must be YYYY-MM-DD' };
  }
  if (input.document_path !== null && input.document_path !== undefined && typeof input.document_path !== 'string') {
    return { ok: false, reason: 'document_path must be a string or null' };
  }
  return { ok: true };
}

export interface RequiresNewNoticeInput {
  prev?: WageNoticeRow | null;
  next: {
    reason: WageNoticeReason;
    wage_rate_cents: number;
    pay_basis: WageNoticePayBasis;
    tip_credit_cents?: number | null;
    signed_on: string;
  };
  today?: string;     // YYYY-MM-DD; defaults to next.signed_on
}

export interface RequiresNewNoticeResult {
  required: boolean;
  reason: string;     // human-readable explanation
}

/**
 * Decide whether a new wage notice is required given the cook's
 * latest existing notice (`prev`) and the proposed `next` notice.
 * Used by the API to flag a missing notice OR to confirm a change-
 * of-rate notice is on file before payroll cuts the new rate.
 *
 * Logic:
 *   - prev null → required (must be a 'hire' notice)
 *   - reason 'rate_change' or pay_basis flipped → required
 *   - days since prev > 365 → required (annual refresh)
 *   - tip_credit_cents went from 0/null → >0 (or vice versa) → required
 *     (changing the tip-credit position is a §3.3 written-notice event)
 *   - else → not required
 */
export function requiresNewNotice(input: RequiresNewNoticeInput): RequiresNewNoticeResult {
  const { prev, next } = input;
  const today = input.today || next.signed_on;

  if (!prev) {
    return { required: true, reason: 'no notice on file — first notice required at hire' };
  }
  if (next.reason === 'rate_change') {
    return { required: true, reason: 'rate change — written notice required' };
  }
  if (prev.pay_basis !== next.pay_basis) {
    return { required: true, reason: `pay basis changed (${prev.pay_basis} → ${next.pay_basis})` };
  }
  if (prev.wage_rate_cents !== next.wage_rate_cents) {
    return { required: true, reason: `wage rate changed (${prev.wage_rate_cents}¢ → ${next.wage_rate_cents}¢)` };
  }
  const prevTipCredit = prev.tip_credit_cents ?? 0;
  const nextTipCredit = next.tip_credit_cents ?? 0;
  if ((prevTipCredit > 0) !== (nextTipCredit > 0) || prevTipCredit !== nextTipCredit) {
    return { required: true, reason: 'tip credit changed — §3.3 written notice required' };
  }
  const days = daysBetween(prev.signed_on, today);
  if (days > WAGE_NOTICE_REFRESH_DAYS) {
    return { required: true, reason: `${days} days since last notice — annual refresh due` };
  }
  return { required: false, reason: 'current notice is valid' };
}

export interface NoticeFreshness {
  cook_id: string;
  has_notice: boolean;
  signed_on: string | null;
  days_since: number | null;
  needs_new: boolean;     // true if days_since > 365 OR no notice
}

/**
 * Tile-summary for the wage-notices board. Pass the most-recent
 * notice per cook (route does the GROUP BY) and the current date;
 * returns one row per cook with a "needs new notice" badge.
 */
export function summarizeFreshness(
  rows: WageNoticeRow[],
  today: string,
): NoticeFreshness[] {
  return rows.map((r) => {
    const days = daysBetween(r.signed_on, today);
    return {
      cook_id: r.cook_id,
      has_notice: true,
      signed_on: r.signed_on,
      days_since: days,
      needs_new: days > WAGE_NOTICE_REFRESH_DAYS,
    };
  });
}
