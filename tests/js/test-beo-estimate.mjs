// tests/js/test-beo-estimate.mjs
// Run: node --experimental-strip-types --test tests/js/test-beo-estimate.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEstimateTotals, groupLineItemsBySection } from '../../lib/beoEstimate.ts';

describe('computeEstimateTotals', () => {
  it('matches the prototype event (8200 → svc20% → tax8.15%)', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0.0815, service_fee_pct: 20 },
      [{ unit_cost: 4100, quantity: 2 }], // 8200
    );
    assert.equal(t.subtotal, 8200);
    assert.equal(t.serviceFee, 1640);
    assert.equal(Number(t.tax.toFixed(2)), 668.3);
    assert.equal(Number(t.total.toFixed(2)), 10508.3);
  });
  it('matches a real corpus event (Collett 15000 → svc15% → tax8.15%)', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0.0815, service_fee_pct: 15 },
      [{ unit_cost: 15000, quantity: 1 }],
    );
    assert.equal(t.serviceFee, 2250);
    assert.equal(Number(t.tax.toFixed(2)), 1222.5);
    assert.equal(Number(t.total.toFixed(2)), 18472.5);
  });
  it('treats missing rates/fields as zero', () => {
    const t = computeEstimateTotals({}, [{ unit_cost: 10 }, { quantity: 3 }, {}]);
    assert.deepEqual(t, {
      subtotal: 0, fbSubtotal: 0, barRevenue: 0, chargesSubtotal: 0,
      serviceFee: 0, tax: 0, total: 0,
    });
  });

  // Event-model wave (docs/superpowers/specs/2026-07-21-beo-event-model-design.md)
  // gave beo_events a bar_mode/bar_amount and beo_event_charges (AV/fees).
  // Owner call (this session): AV/fees do NOT count toward the F&B minimum —
  // only food + bar do. AV/fees are still taxed/service-charged like everything
  // else; they just don't help the bar's fill-to-minimum gap close.

  it('fixed bar mode: bar_amount is billed flat, added to subtotal, taxed/fee\'d', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0.0815, service_fee_pct: 20, bar_mode: 'fixed', bar_amount: 1200 },
      [{ unit_cost: 200, quantity: 10 }], // food 2000
    );
    assert.equal(t.barRevenue, 1200);
    assert.equal(t.fbSubtotal, 3200, 'food + bar, no charges');
    assert.equal(t.chargesSubtotal, 0);
    assert.equal(t.subtotal, 3200);
    assert.equal(t.serviceFee, 640);
  });

  it('fill bar mode: bar tops up the gap between food alone and min_spend', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0, service_fee_pct: 0, min_spend: 1000, bar_mode: 'fill' },
      [{ unit_cost: 100, quantity: 6 }], // food 600
    );
    assert.equal(t.barRevenue, 400, 'fills 600 -> 1000');
    assert.equal(t.fbSubtotal, 1000);
    assert.equal(t.subtotal, 1000);
  });

  it('fill bar mode never goes negative when food alone already clears the minimum', () => {
    const t = computeEstimateTotals(
      { min_spend: 500, bar_mode: 'fill' },
      [{ unit_cost: 100, quantity: 8 }], // food 800 > 500
    );
    assert.equal(t.barRevenue, 0);
    assert.equal(t.fbSubtotal, 800);
  });

  it('no bar_mode set: bar contributes nothing, even with min_spend present', () => {
    const t = computeEstimateTotals(
      { min_spend: 5000 },
      [{ unit_cost: 100, quantity: 1 }],
    );
    assert.equal(t.barRevenue, 0);
    assert.equal(t.fbSubtotal, 100);
  });

  it('AV/fee charges are taxed/serviced but do NOT count toward the F&B minimum (fbSubtotal excludes them)', () => {
    const t = computeEstimateTotals(
      {
        tax_rate: 0.08, service_fee_pct: 20, min_spend: 1000, bar_mode: 'fill',
      },
      [{ unit_cost: 100, quantity: 3 }], // food 300
      [{ charge: 5000 }], // one AV charge -- must NOT help bar "fill" less
    );
    assert.equal(t.barRevenue, 700, 'fills against FOOD (300) alone, not food+charges');
    assert.equal(t.fbSubtotal, 1000, 'F&B minimum reading: food + bar only');
    assert.equal(t.chargesSubtotal, 5000);
    assert.equal(t.subtotal, 6000, 'grand subtotal: fbSubtotal + charges, base for tax/fee');
    assert.equal(t.serviceFee, 1200);
    assert.equal(Number(t.tax.toFixed(2)), 480);
  });

  it('sums multiple charges (av + fee kinds alike -- kind is not read here, only charge)', () => {
    const t = computeEstimateTotals(
      {},
      [],
      [{ charge: 250 }, { charge: 300 }, { charge: null }, {}],
    );
    assert.equal(t.chargesSubtotal, 550);
  });
});

describe('groupLineItemsBySection', () => {
  it('groups by category in canonical order, unknown appended, null → Menu', () => {
    const groups = groupLineItemsBySection(
      [
        { id: 1, item_name: 'Open Bar', category: 'Bar & Fees', sort_order: 1 },
        { id: 2, item_name: 'Carnitas', category: 'Buffet', sort_order: 2 },
        { id: 3, item_name: 'Pig Wings', category: 'Passed', sort_order: 3 },
        { id: 4, item_name: 'Mystery', category: 'Zzz Catering', sort_order: 4 },
        { id: 5, item_name: 'Loose', sort_order: 5 },
      ],
      [],
    );
    assert.deepEqual(groups.map((g) => g.label), ['Passed', 'Buffet', 'Bar & Fees', 'Zzz Catering', 'Menu']);
    assert.equal(groups[0].items[0].item_name, 'Pig Wings');
  });
});
