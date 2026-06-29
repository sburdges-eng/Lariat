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
    assert.deepEqual(t, { subtotal: 0, serviceFee: 0, tax: 0, total: 0 });
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
