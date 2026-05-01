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
