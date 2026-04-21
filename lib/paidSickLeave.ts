// Colorado HFWA paid sick leave (C.R.S. 8-13.3-401 et seq) — L2.
//
// Rules:
// - Accrual: 1 hour per 30 hours worked.
// - Annual cap: 48 hours accrued per year.
// - Carryover: up to 48 hours may carry into the next accrual year
//   (so max balance = 48 carried + 48 newly accrued = 96; the 48
//   cap is on annual ACCRUAL, not total BALANCE).
// - Usage rate: may be used in hour increments (or smallest payroll
//   increment, usually 15min). One hour accrued = one hour usable.
// - HFWA qualifying uses include: own illness, caring for a family
//   member, public-health-emergency doubling, etc. This module
//   enforces accrual math only; usage validation is out-of-scope.
// - Rehires within 6 months restore unused balance. Out-of-scope here
//   (handled at onboarding, not accrual).
//
// Accrual is computed from recorded hours worked. The library is pure;
// the caller supplies the hours-worked series and a prior balance
// snapshot, and we return the new balance.

export const ACCRUAL_HOURS_PER_HOUR_WORKED = 1 / 30;
export const ANNUAL_ACCRUAL_CAP_HOURS = 48;
export const MAX_CARRYOVER_HOURS = 48;

export interface BalanceSnapshot {
  accrual_year: number;
  hours_accrued: number;
  hours_used: number;
  cap_hours: number;           // usually 48 for CO HFWA
  carryover_hours: number;     // carried in from previous year
}

export interface AccrualEvent {
  hours_worked: number;
  // `on` is the YYYY-MM-DD the hours were worked — determines which
  // accrual_year the accrual lands in. Calendar years by default.
  on: string;
}

export interface AccrualResult {
  new_balance: BalanceSnapshot;
  hours_accrued_this_event: number;
  hours_not_accrued_due_to_cap: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function yearOf(ymd: string): number | null {
  if (!DATE_RE.test(ymd)) return null;
  const y = parseInt(ymd.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * Apply a new hours-worked event to a prior balance. Returns a new
 * snapshot (immutable update). Accrual is capped annually; hours
 * that would push accrual past the cap are reported in
 * `hours_not_accrued_due_to_cap` for payroll reconciliation.
 */
export function applyAccrualEvent(
  prior: BalanceSnapshot,
  ev: AccrualEvent,
): AccrualResult {
  if (!Number.isFinite(ev.hours_worked) || ev.hours_worked <= 0) {
    return {
      new_balance: prior,
      hours_accrued_this_event: 0,
      hours_not_accrued_due_to_cap: 0,
    };
  }
  const y = yearOf(ev.on);
  if (y === null) {
    throw new Error(`Invalid accrual date: ${JSON.stringify(ev.on)}`);
  }
  if (y !== prior.accrual_year) {
    throw new Error(
      `Accrual event year ${y} doesn't match balance year ${prior.accrual_year}`,
    );
  }

  const wouldAccrue = ev.hours_worked * ACCRUAL_HOURS_PER_HOUR_WORKED;
  const cap = prior.cap_hours;
  const headroom = Math.max(0, cap - prior.hours_accrued);
  const actual = Math.min(wouldAccrue, headroom);
  const dropped = wouldAccrue - actual;

  return {
    new_balance: {
      ...prior,
      hours_accrued: prior.hours_accrued + actual,
    },
    hours_accrued_this_event: actual,
    hours_not_accrued_due_to_cap: dropped,
  };
}

/**
 * Year-end carryover. Given the closing balance of year N, compute
 * the opening balance for year N+1. Unused hours up to MAX_CARRYOVER_HOURS
 * carry; anything above drops. Used hours reset to 0 (they already
 * counted against the outgoing year).
 */
export function rollover(prior: BalanceSnapshot): BalanceSnapshot {
  const available = prior.carryover_hours + prior.hours_accrued - prior.hours_used;
  const carry = Math.max(0, Math.min(MAX_CARRYOVER_HOURS, available));
  return {
    accrual_year: prior.accrual_year + 1,
    hours_accrued: 0,
    hours_used: 0,
    cap_hours: prior.cap_hours,
    carryover_hours: carry,
  };
}

/**
 * Hours the employee can use right now (carried + accrued − used).
 * Never negative.
 */
export function hoursAvailable(b: BalanceSnapshot): number {
  return Math.max(0, b.carryover_hours + b.hours_accrued - b.hours_used);
}
