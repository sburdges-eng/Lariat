#!/usr/bin/env node
// Pure-fn tests for lib/dealPoints.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-deal-points.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const dp = await import('../../lib/dealPoints.ts');

describe('emptyDeal', () => {
  it('returns a zeroed deal', () => {
    assert.deepEqual(dp.emptyDeal(), {
      guaranteeCents: 0,
      vsPctAfterCosts: null,
      costsOffTop: [],
      buyoutCents: 0,
    });
  });
});

describe('parseDeal', () => {
  it('parses a valid show_deals row', () => {
    const row = {
      guarantee_cents: 150000,
      vs_pct_after_costs: 0.85,
      costs_off_top_json: '[{"label":"Sound","cents":5000}]',
      buyout_cents: 25000,
    };
    assert.deepEqual(dp.parseDeal(row), {
      guaranteeCents: 150000,
      vsPctAfterCosts: 0.85,
      costsOffTop: [{ label: 'Sound', cents: 5000 }],
      buyoutCents: 25000,
    });
  });

  it('throws on malformed JSON in costs_off_top_json', () => {
    const row = {
      guarantee_cents: 0,
      vs_pct_after_costs: null,
      costs_off_top_json: 'not-json',
      buyout_cents: 0,
    };
    assert.throws(() => dp.parseDeal(row), /costs_off_top_json/);
  });

  it('treats null vs_pct as flat-guarantee deal', () => {
    const row = {
      guarantee_cents: 100000,
      vs_pct_after_costs: null,
      costs_off_top_json: '[]',
      buyout_cents: 0,
    };
    assert.equal(dp.parseDeal(row).vsPctAfterCosts, null);
  });
});

describe('computeTalentPayout', () => {
  const flat = {
    guaranteeCents: 100000,
    vsPctAfterCosts: null,
    costsOffTop: [],
    buyoutCents: 0,
  };
  const vs85 = {
    guaranteeCents: 100000,
    vsPctAfterCosts: 0.85,
    costsOffTop: [{ label: 'Sound', cents: 5000 }],
    buyoutCents: 0,
  };

  it('flat guarantee, revenue > guarantee → bonus 0', () => {
    const r = dp.computeTalentPayout({ deal: flat, ticketRevenueCents: 200000 });
    assert.equal(r.guaranteeCents, 100000);
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 100000);
  });

  it('vs deal, revenue ≤ guarantee + costs → bonus 0', () => {
    const r = dp.computeTalentPayout({ deal: vs85, ticketRevenueCents: 100000 });
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 100000);
  });

  it('vs deal, revenue above guarantee + costs → bonus split', () => {
    // overage = 200000 - 5000 - 100000 = 95000, vsBonus = floor(95000 * 0.85) = 80750
    const r = dp.computeTalentPayout({ deal: vs85, ticketRevenueCents: 200000 });
    assert.equal(r.vsBonusCents, 80750);
    assert.equal(r.totalCents, 180750);
  });

  it('all-zero deal → total 0', () => {
    const r = dp.computeTalentPayout({
      deal: dp.emptyDeal(),
      ticketRevenueCents: 999999,
    });
    assert.equal(r.totalCents, 0);
  });

  it('costs > revenue → overage clamped at 0', () => {
    const deal = {
      guaranteeCents: 0,
      vsPctAfterCosts: 0.5,
      costsOffTop: [{ label: 'Sound', cents: 50000 }],
      buyoutCents: 0,
    };
    const r = dp.computeTalentPayout({ deal, ticketRevenueCents: 10000 });
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 0);
  });

  it('buyout-only → total = buyout', () => {
    const deal = {
      guaranteeCents: 0,
      vsPctAfterCosts: null,
      costsOffTop: [],
      buyoutCents: 75000,
    };
    const r = dp.computeTalentPayout({ deal, ticketRevenueCents: 0 });
    assert.equal(r.totalCents, 75000);
  });
});
