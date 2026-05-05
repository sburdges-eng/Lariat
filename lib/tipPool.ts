// Tip pool ledger — Colorado COMPS Order #39 §3.3, §3.4 + FLSA tip
// credit (29 CFR 531.52). L4.
//
// Citations:
// - 7 CCR 1103-1 (COMPS Order #39) §3.3 — tip credit, tipped minimum
//   wage, written-notice + makeup obligations.
// - 7 CCR 1103-1 §3.4 — pool-eligibility (must exclude managers/
//   non-tipped staff); employees retain ownership of tips.
// - 29 CFR 531.52 — federal FLSA tip-credit rules.
//
// 2026 figures (Colorado COMPS #39):
//   Standard minimum wage      $14.81 / hour
//   Tipped minimum wage        $11.79 / hour
//   Maximum tip credit         $ 3.02 / hour
// Verify annually — these change every January via CDLE rulemaking.
//
// Money is INTEGER CENTS in this module — never floats. Floating-
// point rounding errors on tips are exactly how FLSA collective
// actions start. The DB schema (tip_pool_distributions.amount_cents
// INTEGER NOT NULL) enforces this on the storage side.

export const CO_STD_MIN_WAGE_CENTS_2026 = 1481;        // $14.81 — verify annually
export const CO_TIPPED_MIN_WAGE_CENTS_2026 = 1179;     // $11.79 — verify annually
export const CO_TIP_CREDIT_CENTS_2026 = 302;           // $3.02  — verify annually
export const TIP_POOL_CITATION = '7 CCR 1103-1 §3.3 / §3.4 (COMPS Order #39); 29 CFR 531.52';

// Roles whose holders MUST be excluded from a non-traditional tip
// pool under COMPS §3.4 (managers, supervisors, owners). Keep this
// short and conservative; downstream code can compose role+flag.
export const TIP_POOL_EXCLUDED_ROLES = new Set<string>([
  'manager',
  'general_manager',
  'gm',
  'owner',
  'executive_chef',
  'sous_chef_manager',
]);

export type TipKind = 'tip_pool' | 'service_charge' | 'direct_tip';

export interface TipDistributionRow {
  id?: number;
  shift_date: string;
  location_id?: string;
  pool_ref: string;
  cook_id: string;
  role?: string | null;
  kind: TipKind;
  amount_cents: number;
  note?: string | null;
}

export interface StaffFlag {
  cook_id: string;
  flag: string;             // e.g. 'tipped', 'manager', 'minor'
  effective_to: string | null;
}

export interface TipCreditPeriodInput {
  tipped_min_wage_cents: number;
  tip_credit_cents: number;
  hourly_wage_cents: number;        // what the cook was actually paid per hour
  tips_received_cents: number;      // total tips received in the period
  hours_worked: number;
}

export interface TipCreditResult {
  ok: boolean;
  makeup_cents: number;             // employer owes this much in makeup pay (≥ 0)
  effective_hourly_cents: number;   // wage + (tips/hours)
  required_floor_cents: number;     // standard min wage (or tipped + tip credit)
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

// ── Pool eligibility ──────────────────────────────────────────────

/**
 * COMPS §3.4 / FLSA: tip pools may NOT include managers, supervisors,
 * or owners. Anyone holding a `manager`-class flag (or a role in
 * TIP_POOL_EXCLUDED_ROLES) is ineligible.
 *
 * `staffFlags` are the ACTIVE flag rows for the cook (effective_to
 * IS NULL filter applied upstream). `role` is the cook's role on the
 * given shift — both are checked because a cook can be promoted
 * mid-period and the role lookup catches the new state before the
 * flag history is updated.
 */
export function isPoolEligible(
  staffFlags: StaffFlag[],
  role?: string | null,
): boolean {
  if (role && TIP_POOL_EXCLUDED_ROLES.has(role.toLowerCase())) return false;
  for (const f of staffFlags) {
    if (f.effective_to !== null) continue;
    const flag = (f.flag || '').toLowerCase();
    if (flag === 'manager' || flag === 'supervisor' || flag === 'owner' || flag === 'exempt') {
      return false;
    }
  }
  return true;
}

// ── Tip-credit period validation ──────────────────────────────────

/**
 * COMPS §3.3 / FLSA tip-credit math: the employer may pay the lower
 * tipped minimum wage if (cash wage + tips) over the period averages
 * at least the standard minimum wage. If it falls short, the
 * employer owes the makeup ("tip-credit makeup").
 *
 * Returns:
 *   - ok=true, makeup_cents=0 → period is compliant
 *   - ok=false, makeup_cents>0 → employer owes the makeup
 *
 * All math in INTEGER CENTS. Hours allowed as a real number
 * (timesheets are typically tenths of an hour).
 */
export function validateTipCreditPeriod(input: TipCreditPeriodInput): TipCreditResult {
  const required_floor_cents = input.tipped_min_wage_cents + input.tip_credit_cents;

  if (!isInt(input.tipped_min_wage_cents) || !isInt(input.tip_credit_cents) || !isInt(input.hourly_wage_cents) || !isInt(input.tips_received_cents)) {
    return {
      ok: false,
      makeup_cents: 0,
      effective_hourly_cents: 0,
      required_floor_cents,
      reason: 'all wage/tip values must be integer cents',
    };
  }
  if (!isFiniteNonNeg(input.hours_worked)) {
    return {
      ok: false,
      makeup_cents: 0,
      effective_hourly_cents: 0,
      required_floor_cents,
      reason: 'hours_worked must be a non-negative number',
    };
  }
  if (input.hourly_wage_cents < input.tipped_min_wage_cents) {
    return {
      ok: false,
      makeup_cents: 0,
      effective_hourly_cents: 0,
      required_floor_cents,
      reason: `cash wage ${input.hourly_wage_cents}¢/h is below tipped minimum (${input.tipped_min_wage_cents}¢/h)`,
    };
  }
  if (input.hours_worked === 0) {
    return {
      ok: true,
      makeup_cents: 0,
      effective_hourly_cents: input.hourly_wage_cents,
      required_floor_cents,
    };
  }

  // tips/h in integer cents — round-half-up so a 0.5¢ shortfall is
  // surfaced as 1¢ owed (employer bears rounding).
  const tipsPerHourCents = Math.floor(input.tips_received_cents / input.hours_worked);
  const effective_hourly_cents = input.hourly_wage_cents + tipsPerHourCents;
  const shortfallPerHour = required_floor_cents - effective_hourly_cents;
  if (shortfallPerHour <= 0) {
    return {
      ok: true,
      makeup_cents: 0,
      effective_hourly_cents,
      required_floor_cents,
    };
  }
  // Total makeup: round UP so the employer never short-changes by a
  // sub-cent rounding artifact.
  const makeup_cents = Math.ceil(shortfallPerHour * input.hours_worked);
  return {
    ok: false,
    makeup_cents,
    effective_hourly_cents,
    required_floor_cents,
    reason: `tips + cash wage averaged ${effective_hourly_cents}¢/h, below ${required_floor_cents}¢/h floor`,
  };
}

// ── Pool summary ──────────────────────────────────────────────────

export interface PoolSummary {
  total_cents: number;
  by_cook: Record<string, number>;
  by_kind: Record<TipKind, number>;
}

/**
 * Aggregate distributions into per-cook totals and per-kind totals.
 * Pure summation — money invariant: every input row's amount_cents
 * MUST be an integer; non-integers are skipped (and the
 * `validateDistribution` helper below is what API code should run
 * before letting a row near this).
 */
export function summarizePool(distributions: TipDistributionRow[]): PoolSummary {
  const by_cook: Record<string, number> = {};
  const by_kind: Record<TipKind, number> = {
    tip_pool: 0,
    service_charge: 0,
    direct_tip: 0,
  };
  let total_cents = 0;
  for (const row of distributions) {
    if (!isInt(row.amount_cents)) continue;
    total_cents += row.amount_cents;
    by_cook[row.cook_id] = (by_cook[row.cook_id] || 0) + row.amount_cents;
    by_kind[row.kind] = (by_kind[row.kind] || 0) + row.amount_cents;
  }
  return { total_cents, by_cook, by_kind };
}

// ── Row validation ────────────────────────────────────────────────

export interface DistributionShape {
  shift_date?: string;
  pool_ref?: string;
  cook_id?: string;
  role?: string | null;
  kind?: string;
  amount_cents?: unknown;
  note?: string | null;
}

export interface DistributionValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Cheap shape guard for the API route. Confirms `amount_cents` is a
 * non-negative INTEGER (no floats), `kind` is one of the three
 * allowed values, and the required text fields are non-empty. The
 * route runs this BEFORE touching the DB so we never get a 500
 * from a CHECK constraint.
 */
export function validateDistributionShape(input: DistributionShape): DistributionValidation {
  if (!input.shift_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.shift_date)) {
    return { ok: false, reason: 'shift_date must be YYYY-MM-DD' };
  }
  if (!input.pool_ref || typeof input.pool_ref !== 'string' || !input.pool_ref.trim()) {
    return { ok: false, reason: 'pool_ref is required' };
  }
  if (!input.cook_id || typeof input.cook_id !== 'string' || !input.cook_id.trim()) {
    return { ok: false, reason: 'cook_id is required' };
  }
  if (input.kind !== 'tip_pool' && input.kind !== 'service_charge' && input.kind !== 'direct_tip') {
    return { ok: false, reason: 'kind must be tip_pool, service_charge, or direct_tip' };
  }
  if (!isInt(input.amount_cents) || input.amount_cents < 0) {
    return { ok: false, reason: 'amount_cents must be a non-negative integer (cents — no floats)' };
  }
  return { ok: true };
}
