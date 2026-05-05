#!/usr/bin/env node
// Tests for lib/tipPool — COMPS #39 §3.3/§3.4 + FLSA tip credit (L4).
// Run: node --test tests/js/test-tip-pool-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CO_STD_MIN_WAGE_CENTS_2026,
  CO_TIPPED_MIN_WAGE_CENTS_2026,
  CO_TIP_CREDIT_CENTS_2026,
  TIP_POOL_CITATION,
  isPoolEligible,
  validateTipCreditPeriod,
  summarizePool,
  validateDistributionShape,
} from '../../lib/tipPool.ts';

describe('COMPS #39 / FLSA constants', () => {
  it('standard min wage = $14.81 (2026)', () => {
    assert.strictEqual(CO_STD_MIN_WAGE_CENTS_2026, 1481);
  });
  it('tipped min wage = $11.79 (2026)', () => {
    assert.strictEqual(CO_TIPPED_MIN_WAGE_CENTS_2026, 1179);
  });
  it('tip credit = $3.02 (2026)', () => {
    assert.strictEqual(CO_TIP_CREDIT_CENTS_2026, 302);
  });
  it('tipped + tip credit = standard min wage', () => {
    assert.strictEqual(CO_TIPPED_MIN_WAGE_CENTS_2026 + CO_TIP_CREDIT_CENTS_2026, CO_STD_MIN_WAGE_CENTS_2026);
  });
  it('citation references COMPS Order #39 + 29 CFR 531', () => {
    assert.match(TIP_POOL_CITATION, /COMPS/);
    assert.match(TIP_POOL_CITATION, /531/);
  });
});

describe('isPoolEligible', () => {
  it('a tipped server with no flags is eligible', () => {
    assert.strictEqual(isPoolEligible([], 'server'), true);
  });
  it('a manager role is excluded', () => {
    assert.strictEqual(isPoolEligible([], 'manager'), false);
  });
  it('an owner role is excluded', () => {
    assert.strictEqual(isPoolEligible([], 'owner'), false);
  });
  it('manager flag (active) excludes', () => {
    assert.strictEqual(
      isPoolEligible([{ cook_id: 'a', flag: 'manager', effective_to: null }], 'server'),
      false,
    );
  });
  it('manager flag with effective_to set (expired) does NOT exclude', () => {
    assert.strictEqual(
      isPoolEligible([{ cook_id: 'a', flag: 'manager', effective_to: '2025-12-31' }], 'server'),
      true,
    );
  });
  it('case-insensitive role match', () => {
    assert.strictEqual(isPoolEligible([], 'MANAGER'), false);
    assert.strictEqual(isPoolEligible([], 'Owner'), false);
  });
  it('exempt flag excludes', () => {
    assert.strictEqual(
      isPoolEligible([{ cook_id: 'a', flag: 'exempt', effective_to: null }], 'server'),
      false,
    );
  });
});

describe('validateTipCreditPeriod', () => {
  const base = {
    tipped_min_wage_cents: CO_TIPPED_MIN_WAGE_CENTS_2026,
    tip_credit_cents: CO_TIP_CREDIT_CENTS_2026,
  };

  it('clean compliant period: tips well above credit', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,         // $11.79 cash
      tips_received_cents: 5000,        // $50 tips
      hours_worked: 8,                  // ⇒ $6.25/h tips → $18.04/h effective ≥ $14.81
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.makeup_cents, 0);
    assert.ok(r.effective_hourly_cents >= 1481);
  });

  it('exact-floor period (tip credit just covered) is compliant', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,
      tips_received_cents: 302 * 10,    // $3.02/h × 10h
      hours_worked: 10,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.makeup_cents, 0);
  });

  it('shortfall: cash wage at tipped min, no tips → owes full credit × hours', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,
      tips_received_cents: 0,
      hours_worked: 10,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.makeup_cents, 302 * 10);   // $30.20
    assert.match(r.reason, /below.*floor/);
  });

  it('partial shortfall: 1¢/h short over 8h → 8¢ makeup', () => {
    // tips_per_hour_cents = floor(2410 / 8) = 301, cash 1179, eff 1480
    // floor 1481, shortfall 1, makeup ceil(1*8) = 8
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,
      tips_received_cents: 2410,
      hours_worked: 8,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.makeup_cents, 8);
  });

  it('cash wage already above standard min wage → no shortfall', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1500,
      tips_received_cents: 0,
      hours_worked: 8,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.makeup_cents, 0);
  });

  it('rejects float amount_cents (integer-cents invariant)', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,
      tips_received_cents: 50.5,
      hours_worked: 8,
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /integer cents/);
  });

  it('rejects cash wage below tipped minimum', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1100,
      tips_received_cents: 5000,
      hours_worked: 8,
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /below tipped minimum/);
  });

  it('hours_worked = 0 returns ok with 0 makeup', () => {
    const r = validateTipCreditPeriod({
      ...base,
      hourly_wage_cents: 1179,
      tips_received_cents: 0,
      hours_worked: 0,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.makeup_cents, 0);
  });
});

describe('summarizePool', () => {
  const rows = [
    { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'alice', kind: 'tip_pool', amount_cents: 5000 },
    { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'bob', kind: 'tip_pool', amount_cents: 3000 },
    { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'alice', kind: 'service_charge', amount_cents: 1500 },
    { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'carol', kind: 'direct_tip', amount_cents: 800 },
  ];

  it('sums total in cents', () => {
    const s = summarizePool(rows);
    assert.strictEqual(s.total_cents, 5000 + 3000 + 1500 + 800);
  });
  it('aggregates by cook', () => {
    const s = summarizePool(rows);
    assert.strictEqual(s.by_cook.alice, 6500);
    assert.strictEqual(s.by_cook.bob, 3000);
    assert.strictEqual(s.by_cook.carol, 800);
  });
  it('aggregates by kind', () => {
    const s = summarizePool(rows);
    assert.strictEqual(s.by_kind.tip_pool, 8000);
    assert.strictEqual(s.by_kind.service_charge, 1500);
    assert.strictEqual(s.by_kind.direct_tip, 800);
  });
  it('skips rows with non-integer amount_cents (defense in depth)', () => {
    const s = summarizePool([
      { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'alice', kind: 'tip_pool', amount_cents: 100 },
      { shift_date: '2026-04-20', pool_ref: 'P1', cook_id: 'bob', kind: 'tip_pool', amount_cents: 1.5 },
    ]);
    assert.strictEqual(s.total_cents, 100);
    assert.strictEqual(s.by_cook.bob, undefined);
  });
  it('empty input → zeros', () => {
    const s = summarizePool([]);
    assert.strictEqual(s.total_cents, 0);
    assert.deepStrictEqual(s.by_cook, {});
    assert.deepStrictEqual(s.by_kind, { tip_pool: 0, service_charge: 0, direct_tip: 0 });
  });
});

describe('validateDistributionShape', () => {
  function row(over = {}) {
    return {
      shift_date: '2026-04-20',
      pool_ref: 'POOL-1',
      cook_id: 'alice',
      kind: 'tip_pool',
      amount_cents: 1000,
      ...over,
    };
  }

  it('happy path is ok', () => {
    assert.strictEqual(validateDistributionShape(row()).ok, true);
  });
  it('rejects malformed shift_date', () => {
    const r = validateDistributionShape(row({ shift_date: '4/20/2026' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /YYYY-MM-DD/);
  });
  it('rejects missing pool_ref', () => {
    assert.strictEqual(validateDistributionShape(row({ pool_ref: '' })).ok, false);
  });
  it('rejects missing cook_id', () => {
    assert.strictEqual(validateDistributionShape(row({ cook_id: '' })).ok, false);
  });
  it('rejects unknown kind', () => {
    assert.strictEqual(validateDistributionShape(row({ kind: 'bonus' })).ok, false);
  });
  it('rejects float amount_cents', () => {
    const r = validateDistributionShape(row({ amount_cents: 12.5 }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /integer/);
  });
  it('rejects negative amount_cents', () => {
    assert.strictEqual(validateDistributionShape(row({ amount_cents: -100 })).ok, false);
  });
  it('zero amount_cents allowed (e.g. zeroed out shift)', () => {
    assert.strictEqual(validateDistributionShape(row({ amount_cents: 0 })).ok, true);
  });
});
