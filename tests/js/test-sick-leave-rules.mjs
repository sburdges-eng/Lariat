#!/usr/bin/env node
// Tests for lib/sickLeave — HFWA accrual + use + cap math (L2).
// Run: node --test tests/js/test-sick-leave-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED,
  HFWA_ANNUAL_CAP_HOURS,
  HFWA_CITATION,
  accrueHours,
  useHours,
  hoursAvailable,
  summarizeBalance,
} from '../../lib/sickLeave.ts';

function row(over = {}) {
  return {
    cook_id: 'alice',
    accrual_year: 2026,
    hours_accrued: 0,
    hours_used: 0,
    cap_hours: HFWA_ANNUAL_CAP_HOURS,
    carryover_hours: 0,
    last_accrued_on: null,
    ...over,
  };
}

describe('HFWA constants', () => {
  it('30 hours worked per 1 hour earned', () => {
    assert.strictEqual(HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED, 30);
  });
  it('48 hour annual cap', () => {
    assert.strictEqual(HFWA_ANNUAL_CAP_HOURS, 48);
  });
  it('citation references C.R.S. §8-13.3-401', () => {
    assert.match(HFWA_CITATION, /8-13\.3-401/);
  });
});

describe('accrueHours — accrual ratio', () => {
  it('0 hours worked → no accrual', () => {
    const r = accrueHours(row(), 0);
    assert.strictEqual(r.hours_added, 0);
    assert.strictEqual(r.capped, false);
  });

  it('30 hours worked → 1 hour earned', () => {
    const r = accrueHours(row(), 30);
    assert.strictEqual(r.hours_added, 1);
    assert.strictEqual(r.capped, false);
  });

  it('15 hours worked → 0.5 hours earned (fractional)', () => {
    const r = accrueHours(row(), 15);
    assert.strictEqual(r.hours_added, 0.5);
  });

  it('45 hours worked → 1.5 hours earned', () => {
    const r = accrueHours(row(), 45);
    assert.strictEqual(r.hours_added, 1.5);
  });

  it('1440 hours worked from zero → exactly 48 (cap), capped=true', () => {
    const r = accrueHours(row(), 1440);
    assert.strictEqual(r.hours_added, 48);
    // 1440 / 30 = 48 exactly — not over the cap, not clipped
    assert.strictEqual(r.capped, false);
  });

  it('1500 hours worked → clipped to room (48), capped=true', () => {
    const r = accrueHours(row(), 1500);
    assert.strictEqual(r.hours_added, 48);
    assert.strictEqual(r.capped, true);
    assert.strictEqual(r.hours_uncapped, 50);
  });

  it('rounding: 1 hour worked → 0.03 (cosmetic round to 0.01)', () => {
    const r = accrueHours(row(), 1);
    // 1 / 30 = 0.0333... rounded to 0.03
    assert.strictEqual(r.hours_added, 0.03);
  });

  it('negative hoursWorked → no accrual + reason', () => {
    const r = accrueHours(row(), -8);
    assert.strictEqual(r.hours_added, 0);
    assert.match(r.reason, /non-negative/);
  });

  it('NaN hoursWorked → no accrual', () => {
    const r = accrueHours(row(), Number.NaN);
    assert.strictEqual(r.hours_added, 0);
    assert.match(r.reason, /non-negative/);
  });

  it('Infinity hoursWorked → no accrual', () => {
    const r = accrueHours(row(), Infinity);
    assert.strictEqual(r.hours_added, 0);
  });
});

describe('accrueHours — cap enforcement', () => {
  it('already at cap: any accrual is no-op with reason', () => {
    const r = accrueHours(row({ hours_accrued: 48 }), 30);
    assert.strictEqual(r.hours_added, 0);
    assert.strictEqual(r.capped, true);
    assert.match(r.reason, /cap/);
  });

  it('1 hour below cap: 30 hours worked yields only 1 hour', () => {
    const r = accrueHours(row({ hours_accrued: 47 }), 30);
    assert.strictEqual(r.hours_added, 1);
    assert.strictEqual(r.capped, false);
  });

  it('0.5 below cap: 30 hours worked yields only 0.5', () => {
    const r = accrueHours(row({ hours_accrued: 47.5 }), 30);
    assert.strictEqual(r.hours_added, 0.5);
    assert.strictEqual(r.capped, true);
  });

  it('custom cap (front-loading): cap_hours=24 clips at 24', () => {
    const r = accrueHours(row({ cap_hours: 24, hours_accrued: 23 }), 60);
    assert.strictEqual(r.hours_added, 1);
    assert.strictEqual(r.capped, true);
  });

  it('cap is on hours_accrued, NOT including carryover', () => {
    // 40 carryover + 47 accrued = 87 banked, but only 1h of headroom
    // remains under the accrual cap (48 - 47 = 1). Carryover does not
    // count against further accrual.
    const r = accrueHours(row({ hours_accrued: 47, carryover_hours: 40 }), 60);
    assert.strictEqual(r.hours_added, 1);
    assert.strictEqual(r.capped, true);
  });
});

describe('useHours', () => {
  it('use within balance succeeds', () => {
    const r = useHours(row({ hours_accrued: 8 }), 4);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.new_balance, 4);
  });

  it('use exactly the balance succeeds (boundary)', () => {
    const r = useHours(row({ hours_accrued: 8 }), 8);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.new_balance, 0);
  });

  it('use over balance fails with reason', () => {
    const r = useHours(row({ hours_accrued: 4 }), 8);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not enough/);
    assert.strictEqual(r.new_balance, 4);
  });

  it('zero or negative hoursToUse rejected', () => {
    assert.strictEqual(useHours(row({ hours_accrued: 8 }), 0).ok, false);
    assert.strictEqual(useHours(row({ hours_accrued: 8 }), -2).ok, false);
  });

  it('balance includes carryover', () => {
    const r = useHours(row({ hours_accrued: 4, carryover_hours: 6 }), 9);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.new_balance, 1);
  });

  it('balance subtracts hours_used', () => {
    const r = useHours(row({ hours_accrued: 8, hours_used: 5 }), 4);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not enough/);
  });
});

describe('hoursAvailable + summarizeBalance', () => {
  it('hoursAvailable: accrued + carryover − used, floored at 0', () => {
    assert.strictEqual(hoursAvailable(row({ hours_accrued: 10, carryover_hours: 5, hours_used: 3 })), 12);
    assert.strictEqual(hoursAvailable(row({ hours_accrued: 5, hours_used: 10 })), 0);
  });

  it('summarizeBalance reports at_cap when accrued ≥ cap', () => {
    const s = summarizeBalance(row({ hours_accrued: 48 }));
    assert.strictEqual(s.at_cap, true);
    assert.strictEqual(s.cap_hours, 48);
    assert.strictEqual(s.hours_available, 48);
  });

  it('summarizeBalance not at_cap below cap', () => {
    const s = summarizeBalance(row({ hours_accrued: 47.5 }));
    assert.strictEqual(s.at_cap, false);
  });

  it('summarizeBalance handles missing fields gracefully', () => {
    const s = summarizeBalance({ cook_id: 'bob', accrual_year: 2026, hours_accrued: NaN, hours_used: NaN, cap_hours: NaN, carryover_hours: NaN });
    assert.strictEqual(s.hours_accrued, 0);
    assert.strictEqual(s.hours_used, 0);
    assert.strictEqual(s.hours_available, 0);
    assert.strictEqual(s.cap_hours, HFWA_ANNUAL_CAP_HOURS);
  });

  it('summarizeBalance preserves carryover separately', () => {
    const s = summarizeBalance(row({ hours_accrued: 20, carryover_hours: 24 }));
    assert.strictEqual(s.carryover_hours, 24);
    assert.strictEqual(s.hours_available, 44);
  });
});
