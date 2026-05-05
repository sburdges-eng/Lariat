// Paid sick leave — Colorado Healthy Families and Workplaces Act (HFWA), L2.
//
// Citation: C.R.S. §8-13.3-401 et seq. (HFWA).
//
// HFWA rules:
// - Employees accrue 1 hour of paid sick leave for every 30 hours worked.
// - Annual cap: employee may accrue up to 48 hours per year. Employer
//   may front-load 48 hours at start of year as an alternative to
//   accrual tracking.
// - Use: employee may use up to 48 hours per year. Carryover up to
//   48 hours from prior year is allowed (but combined with new accrual
//   the cap is still 48 hours available at any one time unless
//   employer is more generous).
// - Employer must track accrual + use + balance and provide balance
//   to the employee on request.
//
// This module is pure: no DB, no I/O. The /labor/sick-leave UI calls
// these helpers against rows fetched from `paid_sick_leave_balances`.

export const HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED = 30;
export const HFWA_ANNUAL_CAP_HOURS = 48;
export const HFWA_CITATION = 'C.R.S. §8-13.3-401 (HFWA)';

export interface SickLeaveBalanceRow {
  id?: number;
  location_id?: string;
  cook_id: string;
  accrual_year: number;
  hours_accrued: number;
  hours_used: number;
  cap_hours: number;
  carryover_hours: number;
  last_accrued_on?: string | null;
}

export interface AccrualResult {
  hours_added: number;       // actual hours added to the balance
  capped: boolean;           // true if the cap clipped the accrual
  hours_uncapped: number;    // raw hours earned before capping (audit aid)
  reason?: string;
}

export interface UseResult {
  ok: boolean;
  reason?: string;
  new_balance: number;       // hours_available AFTER the use; unchanged on failure
}

export interface BalanceSummary {
  cook_id: string;
  accrual_year: number;
  hours_accrued: number;
  hours_used: number;
  hours_available: number;   // accrued + carryover − used; never < 0
  cap_hours: number;
  carryover_hours: number;
  at_cap: boolean;           // true when accrued >= cap (further accrual is no-op)
}

// ── Helpers ───────────────────────────────────────────────────────

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function roundHours(h: number): number {
  // HFWA does not mandate a rounding floor; we round to the nearest
  // 0.01 of an hour (≈36 seconds) for ledger sanity. The DB stores
  // REAL so this is purely cosmetic, but keeping ledger arithmetic
  // free of float drift matters when an inspector reconciles.
  return Math.round(h * 100) / 100;
}

// ── Pure rules ────────────────────────────────────────────────────

/**
 * Accrue sick-leave hours for `hoursWorked` against `currentBalance`.
 * Returns the hours actually added (after cap) and whether the cap
 * clipped the accrual.
 *
 * The cap is on `hours_accrued` (lifetime in this accrual_year). It
 * does NOT include `carryover_hours` — that's already-credited time
 * from a prior year and lives on the same row but tracks a separate
 * bucket per HFWA.
 *
 * Negative or non-finite `hoursWorked` is a no-op with a `reason`.
 */
export function accrueHours(
  currentBalance: SickLeaveBalanceRow,
  hoursWorked: number,
): AccrualResult {
  if (!isFiniteNonNeg(hoursWorked)) {
    return { hours_added: 0, capped: false, hours_uncapped: 0, reason: 'hoursWorked must be a non-negative number' };
  }
  if (hoursWorked === 0) {
    return { hours_added: 0, capped: false, hours_uncapped: 0 };
  }
  const cap = isFiniteNonNeg(currentBalance.cap_hours) ? currentBalance.cap_hours : HFWA_ANNUAL_CAP_HOURS;
  const accrued = isFiniteNonNeg(currentBalance.hours_accrued) ? currentBalance.hours_accrued : 0;

  const earnedRaw = hoursWorked / HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED;
  const room = Math.max(0, cap - accrued);
  const earnedCapped = Math.min(earnedRaw, room);
  const capped = earnedCapped < earnedRaw - 1e-9; // float tolerance

  return {
    hours_added: roundHours(earnedCapped),
    hours_uncapped: roundHours(earnedRaw),
    capped,
    reason: capped && earnedCapped === 0 ? 'cap reached — no further accrual this year' : undefined,
  };
}

/**
 * Use `hoursToUse` from the balance. The available pool is
 * accrued + carryover − used. Refuses (ok=false) if the request
 * exceeds available; the UI then surfaces the deficit so the manager
 * can decide (front-load, deny, etc.).
 *
 * `new_balance` returns the post-use hours_available. Note: this is
 * a pure calc — the API route is the one that persists the new
 * `hours_used` value.
 */
export function useHours(
  currentBalance: SickLeaveBalanceRow,
  hoursToUse: number,
): UseResult {
  if (!isFiniteNonNeg(hoursToUse) || hoursToUse === 0) {
    return { ok: false, reason: 'hoursToUse must be a positive number', new_balance: hoursAvailable(currentBalance) };
  }
  const available = hoursAvailable(currentBalance);
  if (hoursToUse > available + 1e-9) {
    return { ok: false, reason: `not enough sick time — have ${roundHours(available)}, need ${roundHours(hoursToUse)}`, new_balance: available };
  }
  return { ok: true, new_balance: roundHours(available - hoursToUse) };
}

/**
 * Hours of paid sick leave currently available to the employee.
 * accrued + carryover − used, floored at 0.
 */
export function hoursAvailable(row: SickLeaveBalanceRow): number {
  const accrued = isFiniteNonNeg(row.hours_accrued) ? row.hours_accrued : 0;
  const used = isFiniteNonNeg(row.hours_used) ? row.hours_used : 0;
  const carry = isFiniteNonNeg(row.carryover_hours) ? row.carryover_hours : 0;
  return roundHours(Math.max(0, accrued + carry - used));
}

/**
 * Roll a row into a UI-ready summary. The summary shape is what the
 * GET /api/sick-leave handler returns and what the board renders per
 * cook tile.
 */
export function summarizeBalance(row: SickLeaveBalanceRow): BalanceSummary {
  const cap = isFiniteNonNeg(row.cap_hours) ? row.cap_hours : HFWA_ANNUAL_CAP_HOURS;
  const accrued = isFiniteNonNeg(row.hours_accrued) ? row.hours_accrued : 0;
  const used = isFiniteNonNeg(row.hours_used) ? row.hours_used : 0;
  const carry = isFiniteNonNeg(row.carryover_hours) ? row.carryover_hours : 0;
  return {
    cook_id: row.cook_id,
    accrual_year: row.accrual_year,
    hours_accrued: roundHours(accrued),
    hours_used: roundHours(used),
    hours_available: roundHours(Math.max(0, accrued + carry - used)),
    cap_hours: roundHours(cap),
    carryover_hours: roundHours(carry),
    at_cap: accrued >= cap - 1e-9,
  };
}
