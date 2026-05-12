#!/usr/bin/env node
// Tests for parseDealTerms() in lib/dealPoints.ts — Phase 2 B1 deal-point parser.
//
// Run: node --experimental-strip-types --test tests/js/test-settlement-deal-parser.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseDealTerms, dealTermsToDealPoint } = await import('../../lib/dealPoints.ts');

// ── parseDealTerms: valid shapes ───────────────────────────────────

describe('parseDealTerms: valid shapes', () => {
  it('guarantee-only deal (flat rate, no vs%)', () => {
    const terms = parseDealTerms({ guarantee_usd: 1500 });
    assert.equal(terms.guarantee_usd, 1500);
    assert.equal('vs_pct_after_costs' in terms, false);
    assert.equal('costs_off_top' in terms, false);
    assert.equal('buyout_usd' in terms, false);
  });

  it('vs-pct deal (guarantee + vs_pct_after_costs)', () => {
    const terms = parseDealTerms({
      guarantee_usd: 1000,
      vs_pct_after_costs: 0.85,
    });
    assert.equal(terms.guarantee_usd, 1000);
    assert.equal(terms.vs_pct_after_costs, 0.85);
  });

  it('costs-off-top deal (guarantee + itemized cost deductions)', () => {
    const terms = parseDealTerms({
      guarantee_usd: 800,
      vs_pct_after_costs: 0.80,
      costs_off_top: [
        { label: 'Sound', amount_usd: 50 },
        { label: 'Backline', amount_usd: 75 },
      ],
    });
    assert.equal(terms.guarantee_usd, 800);
    assert.equal(terms.costs_off_top?.length, 2);
    assert.equal(terms.costs_off_top?.[0].label, 'Sound');
    assert.equal(terms.costs_off_top?.[0].amount_usd, 50);
  });

  it('full deal (guarantee + vs% + costs + buyout)', () => {
    const terms = parseDealTerms({
      guarantee_usd: 2500,
      vs_pct_after_costs: 0.65,
      costs_off_top: [{ label: 'Hospitality', amount_usd: 200 }],
      buyout_usd: 250,
    });
    assert.equal(terms.guarantee_usd, 2500);
    assert.equal(terms.vs_pct_after_costs, 0.65);
    assert.equal(terms.buyout_usd, 250);
  });

  it('vs_pct_after_costs: null (explicit flat deal)', () => {
    const terms = parseDealTerms({ guarantee_usd: 1000, vs_pct_after_costs: null });
    assert.equal(terms.guarantee_usd, 1000);
    assert.equal(terms.vs_pct_after_costs, null);
  });

  it('zero guarantee is valid (comp/walkup shows)', () => {
    const terms = parseDealTerms({ guarantee_usd: 0 });
    assert.equal(terms.guarantee_usd, 0);
  });
});

// ── parseDealTerms: rejection cases ───────────────────────────────

describe('parseDealTerms: invalid shapes throw InvalidDealShape', () => {
  it('missing guarantee_usd → InvalidDealShape', () => {
    assert.throws(
      () => parseDealTerms({}),
      /InvalidDealShape.*guarantee_usd/,
    );
  });

  it('non-numeric guarantee_usd → InvalidDealShape', () => {
    assert.throws(
      () => parseDealTerms({ guarantee_usd: 'one thousand' }),
      /InvalidDealShape.*guarantee_usd/,
    );
  });

  it('NaN guarantee_usd → InvalidDealShape', () => {
    assert.throws(
      () => parseDealTerms({ guarantee_usd: NaN }),
      /InvalidDealShape.*guarantee_usd/,
    );
  });

  it('vs_pct_after_costs > 1 → InvalidDealShape', () => {
    assert.throws(
      () => parseDealTerms({ guarantee_usd: 1000, vs_pct_after_costs: 1.5 }),
      /InvalidDealShape.*vs_pct_after_costs/,
    );
  });

  it('vs_pct_after_costs < 0 → InvalidDealShape', () => {
    assert.throws(
      () => parseDealTerms({ guarantee_usd: 1000, vs_pct_after_costs: -0.1 }),
      /InvalidDealShape.*vs_pct_after_costs/,
    );
  });

  it('costs_off_top item missing amount_usd → InvalidDealShape', () => {
    assert.throws(
      () =>
        parseDealTerms({
          guarantee_usd: 1000,
          costs_off_top: [{ label: 'Sound' }],
        }),
      /InvalidDealShape.*costs_off_top\[0\]\.amount_usd/,
    );
  });

  it('costs_off_top item missing label → InvalidDealShape', () => {
    assert.throws(
      () =>
        parseDealTerms({
          guarantee_usd: 1000,
          costs_off_top: [{ amount_usd: 50 }],
        }),
      /InvalidDealShape.*costs_off_top\[0\]\.label/,
    );
  });

  it('costs_off_top is not an array → InvalidDealShape', () => {
    assert.throws(
      () =>
        parseDealTerms({
          guarantee_usd: 1000,
          costs_off_top: '[{label:"Sound"}]',
        }),
      /InvalidDealShape.*costs_off_top.*array/,
    );
  });

  it('null input → InvalidDealShape', () => {
    assert.throws(() => parseDealTerms(null), /InvalidDealShape/);
  });

  it('array input → InvalidDealShape', () => {
    assert.throws(() => parseDealTerms([]), /InvalidDealShape/);
  });
});

// ── dealTermsToDealPoint: USD → cents conversion ───────────────────

describe('dealTermsToDealPoint: USD-to-cents conversion', () => {
  it('converts a flat guarantee to cents', () => {
    const pt = dealTermsToDealPoint({ guarantee_usd: 1500 });
    assert.equal(pt.guaranteeCents, 150000);
    assert.equal(pt.vsPctAfterCosts, null);
    assert.deepEqual(pt.costsOffTop, []);
    assert.equal(pt.buyoutCents, 0);
  });

  it('converts costs_off_top items to cents', () => {
    const pt = dealTermsToDealPoint({
      guarantee_usd: 800,
      costs_off_top: [{ label: 'Sound', amount_usd: 50.50 }],
    });
    assert.equal(pt.costsOffTop[0].cents, 5050);
  });

  it('preserves vs_pct_after_costs as-is (no conversion)', () => {
    const pt = dealTermsToDealPoint({
      guarantee_usd: 1000,
      vs_pct_after_costs: 0.85,
    });
    assert.equal(pt.vsPctAfterCosts, 0.85);
  });
});
