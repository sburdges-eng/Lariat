#!/usr/bin/env node
// Deriving a unit price for items that have none.
//
// WHY THIS EXISTS
// ---------------
// 334 rows in vendor_prices carry a name and a SKU and no price. Two sources
// each hold half of what's needed and neither holds both:
//
//   the Master Product Catalog  →  how big a case is  (1/15#/LB → 15 lb)
//   sysco/shamrock/photo invoices → what was paid FOR a case ($74.95)
//
// unit_price is the quotient. This module does that division and, more
// importantly, refuses to do it when either half is missing or untrustworthy —
// a derived price that is wrong is indistinguishable from a quoted one once it
// lands in the table, so anything doubtful comes back as unresolved instead.
//
// Output is a CSV for scripts/import-vendor-prices.mjs rather than a direct
// write. That importer already validates and already snapshots history; a
// second writer into vendor_prices is what produced the 2026-08-01 mess.
//
// Run: node --experimental-strip-types --test tests/js/test-derive-prices-from-invoices.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { derivePrices, toImporterCsv } = await import(
  '../../lib/derivePricesFromInvoices.ts'
);

const ITEM = { ingredient: 'Bacon Shingle', vendor: 'sysco', sku: '3777570' };

/** Build the two lookups the deriver takes, from plain objects. */
function lookups({ quotes = {}, packs = {} } = {}) {
  return [(sku) => quotes[sku] ?? null, (sku) => packs[sku] ?? null];
}

describe('derivePrices', () => {
  it('divides the case price by the case size', () => {
    const [quoteFor, packFor] = lookups({
      quotes: { '3777570': { pack_price: 74.95, source: 'sysco pdf', date: '2026-03-23', confidence: 'invoice' } },
      packs: { '3777570': { pack_size: 15, pack_unit: 'lb' } },
    });
    const { derived, unresolved } = derivePrices([ITEM], quoteFor, packFor);
    assert.equal(unresolved.length, 0);
    assert.equal(derived.length, 1);
    const d = derived[0];
    assert.equal(d.pack_price, 74.95);
    assert.equal(d.pack_size, 15);
    assert.equal(d.pack_unit, 'lb');
    assert.ok(Math.abs(d.unit_price - 74.95 / 15) < 1e-9);
  });

  it('records where the number came from, in the notes', () => {
    const [quoteFor, packFor] = lookups({
      quotes: { '3777570': { pack_price: 74.95, source: 'sysco pdf', date: '2026-03-23', confidence: 'invoice' } },
      packs: { '3777570': { pack_size: 15, pack_unit: 'lb' } },
    });
    const { derived } = derivePrices([ITEM], quoteFor, packFor);
    // A derived price must never be mistaken for a vendor-quoted one.
    assert.match(derived[0].notes, /derived/i);
    assert.match(derived[0].notes, /sysco pdf/);
    assert.match(derived[0].notes, /2026-03-23/);
    assert.match(derived[0].notes, /74\.95/);
    assert.match(derived[0].notes, /15 lb/);
  });

  it('refuses when there is no invoice for the sku', () => {
    const [quoteFor, packFor] = lookups({ packs: { '3777570': { pack_size: 15, pack_unit: 'lb' } } });
    const { derived, unresolved } = derivePrices([ITEM], quoteFor, packFor);
    assert.equal(derived.length, 0);
    assert.match(unresolved[0].reason, /no invoice/i);
    assert.equal(unresolved[0].sku, '3777570');
  });

  it('refuses when the catalog has no case size', () => {
    const [quoteFor, packFor] = lookups({
      quotes: { '3777570': { pack_price: 74.95, source: 'sysco pdf', date: '2026-03-23', confidence: 'invoice' } },
    });
    const { derived, unresolved } = derivePrices([ITEM], quoteFor, packFor);
    assert.equal(derived.length, 0);
    assert.match(unresolved[0].reason, /case size|pack size/i);
  });

  // An OCR'd phone photo of a paper invoice is good evidence and bad
  // arithmetic. High-confidence lines are used; the rest are listed for a
  // human rather than divided.
  it('uses a high-confidence photo line but refuses a low-confidence one', () => {
    const [okQuote, okPack] = lookups({
      quotes: { '1': { pack_price: 40, source: 'photo', date: '2026-06-01', confidence: 'photo-high' } },
      packs: { '1': { pack_size: 10, pack_unit: 'lb' } },
    });
    const hi = derivePrices([{ ingredient: 'A', vendor: 'sysco', sku: '1' }], okQuote, okPack);
    assert.equal(hi.derived.length, 1);
    assert.equal(hi.derived[0].unit_price, 4);
    assert.match(hi.derived[0].notes, /photo/i);

    const [loQuote, loPack] = lookups({
      quotes: { '1': { pack_price: 40, source: 'photo', date: '2026-06-01', confidence: 'photo-low' } },
      packs: { '1': { pack_size: 10, pack_unit: 'lb' } },
    });
    const lo = derivePrices([{ ingredient: 'A', vendor: 'sysco', sku: '1' }], loQuote, loPack);
    assert.equal(lo.derived.length, 0);
    assert.match(lo.unresolved[0].reason, /confidence/i);
  });

  it('refuses a non-positive price or case size instead of dividing', () => {
    const cases = [
      [{ pack_price: 0, source: 's', date: 'd', confidence: 'invoice' }, { pack_size: 15, pack_unit: 'lb' }],
      [{ pack_price: 10, source: 's', date: 'd', confidence: 'invoice' }, { pack_size: 0, pack_unit: 'lb' }],
      [{ pack_price: -5, source: 's', date: 'd', confidence: 'invoice' }, { pack_size: 15, pack_unit: 'lb' }],
    ];
    for (const [q, p] of cases) {
      const [quoteFor, packFor] = lookups({ quotes: { '3777570': q }, packs: { '3777570': p } });
      const { derived, unresolved } = derivePrices([ITEM], quoteFor, packFor);
      assert.equal(derived.length, 0, JSON.stringify(q));
      assert.ok(unresolved.length === 1);
    }
  });

  it('keeps going past an item it cannot resolve', () => {
    const [quoteFor, packFor] = lookups({
      quotes: {
        a: { pack_price: 30, source: 'sysco pdf', date: '2026-03-01', confidence: 'invoice' },
        c: { pack_price: 60, source: 'sysco pdf', date: '2026-03-01', confidence: 'invoice' },
      },
      packs: { a: { pack_size: 10, pack_unit: 'lb' }, c: { pack_size: 20, pack_unit: 'lb' } },
    });
    const items = ['a', 'b', 'c'].map((sku) => ({ ingredient: sku, vendor: 'sysco', sku }));
    const { derived, unresolved } = derivePrices(items, quoteFor, packFor);
    assert.deepEqual(derived.map((d) => d.ingredient), ['a', 'c']);
    assert.deepEqual(unresolved.map((u) => u.sku), ['b']);
  });
});

describe('toImporterCsv', () => {
  it('emits the header scripts/import-vendor-prices.mjs reads', () => {
    const csv = toImporterCsv([]);
    const header = csv.split('\n')[0];
    // scripts/import-vendor-prices.mjs REQUIRED_COLUMNS — all nine, or it
    // rejects the file outright.
    for (const c of [
      'vendor', 'vendor_sku', 'ingredient_name', 'pack_size', 'pack_unit',
      'pack_price', 'unit_price', 'imported_at', 'notes',
    ]) {
      assert.ok(header.includes(c), `header missing ${c}: ${header}`);
    }
  });

  it('quotes a field containing a comma so the row cannot split', () => {
    const csv = toImporterCsv([
      {
        ingredient: 'CABBAGE, RED SHRD',
        vendor: 'shamrock',
        sku: '9',
        pack_size: 5,
        pack_unit: 'lb',
        pack_price: 7.09,
        unit_price: 1.418,
        notes: 'derived: shamrock xls 2025-11-03, $7.09 / 5 lb',
      },
    ]);
    const line = csv.split('\n')[1];
    assert.ok(line.includes('"CABBAGE, RED SHRD"'), line);
    assert.ok(line.includes('"derived: shamrock xls 2025-11-03, $7.09 / 5 lb"'), line);
    // 9 columns even though two of the values contain commas.
    assert.equal(csv.split('\n')[0].split(',').length, 9);
  });
});
