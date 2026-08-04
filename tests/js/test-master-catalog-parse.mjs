#!/usr/bin/env node
// Parser for the Sysco/Shamrock "Master Product Catalog" export.
//
// WHY THIS EXISTS
// ---------------
// On 2026-08-01 this catalog was loaded into vendor_prices and 334 rows landed
// with names, SKUs and categories but NO pack size and NO price. Downstream
// that reads as "we don't know what this costs": the pangasius, the sourdough
// and the beer-batter fries all went price-less while older, correctly-priced
// rows for the same items sat beside them under slightly different spellings.
//
// The file's first line is literally `0,1,2,...,9`. The real header —
// Description / Pack Size / Price — is on line 2. Anything that treats line 1
// as the header gets columns named "0".."9", finds no `Price` column, and
// imports names only. That is the shape of the damage in the table.
//
// The second, larger loss is the `Pack Size` column. 730 of 752 rows carry a
// full pack breakdown (`1/15/LB`, `4/1 GAL/GAL`, `6/#10/CT`) — exactly the
// case-size information whose absence makes a batch of cornbread cost $333.
// It was read past entirely.
//
// Run: node --experimental-strip-types --test tests/js/test-master-catalog-parse.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseMasterCatalog, parsePackSize } = await import(
  '../../lib/masterCatalogParse.ts'
);

// The real file's first line, then the real header, then rows. Values are
// synthetic — the live catalog is business data and never enters the repo.
const HEADER = [
  '0,1,2,3,4,5,6,7,8,9',
  'Lariat ID,Supplier,Supplier Product #,Description,Pack Size,Brand,Price,Unit,Category,Source List',
].join('\n');

function csv(...rows) {
  return [HEADER, ...rows].join('\n');
}

describe('parsePackSize — COUNT/SIZE[UNIT]/UNIT', () => {
  it('multiplies the case count by the inner size', () => {
    assert.deepEqual(parsePackSize('1/15/LB'), { pack_size: 15, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('2/5 LB/LB'), { pack_size: 10, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('6/5 LB/LB'), { pack_size: 30, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('4/1 GAL/GAL'), { pack_size: 4, pack_unit: 'gal' });
  });

  it('handles a missing outer unit by falling back to the inner one', () => {
    // '1/5 LB/' appears 3 times in the live file.
    assert.deepEqual(parsePackSize('1/5 LB/'), { pack_size: 5, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('10/12 OZ/'), { pack_size: 120, pack_unit: 'oz' });
  });

  it('tolerates a size written without a space before its unit', () => {
    assert.deepEqual(parsePackSize('4/5LB/LB'), { pack_size: 20, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('1/50LB/LB'), { pack_size: 50, pack_unit: 'lb' });
  });

  it('treats a #10-style can size as a count, not a weight', () => {
    // 6 cans to the case. The '#10' is a can format, not 10 of anything.
    assert.deepEqual(parsePackSize('6/#10/CT'), { pack_size: 6, pack_unit: 'ct' });
  });

  // '#' means opposite things on either side of the number, and reading one as
  // the other is silent and wrong rather than loud. '1/15#/LB' is a 15 lb case
  // of bacon; misreading the trailing '#' as a can format yields 1 lb, and the
  // bacon then costs $74.95/lb instead of $5.00/lb.
  it('reads a trailing # as pounds, not as a can format', () => {
    assert.deepEqual(parsePackSize('1/15#/LB'), { pack_size: 15, pack_unit: 'lb' });
    assert.deepEqual(parsePackSize('1/10#/LB'), { pack_size: 10, pack_unit: 'lb' });
    // Outer unit blank: the trailing # is the only thing naming the unit.
    assert.deepEqual(parsePackSize('1/25#/'), { pack_size: 25, pack_unit: 'lb' });
  });

  it('maps vendor unit abbreviations onto units lib/unitConvert knows', () => {
    assert.equal(parsePackSize('4/1 GAL/GL').pack_unit, 'gal');
    assert.equal(parsePackSize('1/12/FOZ').pack_unit, 'floz');
    assert.equal(parsePackSize('1/1/DZ').pack_unit, 'doz');
    assert.equal(parsePackSize('1/EACH/EA').pack_unit, 'ea');
  });

  // The whole point of this importer is that a wrong number is worse than a
  // missing one. Anything it cannot read exactly, it refuses.
  it('refuses an average-weight range rather than picking a midpoint', () => {
    const r = parsePackSize('8/6-9#AV/LB');
    assert.equal(r.pack_size, null);
    assert.match(r.reason, /average|range/i);
  });

  it('refuses dimensional packs that have no weight or volume', () => {
    for (const p of ['1/18 IN/"', '48/4.5"/"', '100/16 IN/"']) {
      const r = parsePackSize(p);
      assert.equal(r.pack_size, null, `${p} should not parse`);
      assert.match(r.reason, /dimension|not a (weight|known)/i);
    }
  });

  it('refuses a malformed pack string', () => {
    assert.equal(parsePackSize('2000/1/10OZ/CT').pack_size, null);
    assert.equal(parsePackSize('').pack_size, null);
    assert.equal(parsePackSize('CS').pack_size, null);
  });
});

describe('parseMasterCatalog — the file as a whole', () => {
  it('skips the 0,1,2 junk line and uses the real header', () => {
    const { rows } = parseMasterCatalog(
      csv('LAR-1,Sysco,7585326,Bacon Sliced,1/15/LB,ROTELLA,67.09,CS,Frozen,Purchase History'),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ingredient, 'Bacon Sliced');
    assert.equal(rows[0].sku, '7585326');
    assert.equal(rows[0].category, 'Frozen');
  });

  it('lowercases the supplier so rows match the ones already in vendor_prices', () => {
    const { rows } = parseMasterCatalog(
      csv('LAR-1,Sysco,1,Bacon,1/15/LB,B,67.09,CS,Frozen,PH'),
    );
    assert.equal(rows[0].vendor, 'sysco');
  });

  it('derives unit_price from price over pack size', () => {
    const { rows } = parseMasterCatalog(
      csv('LAR-1,Sysco,1,Bacon,1/15/LB,B,67.09,CS,Frozen,PH'),
    );
    assert.equal(rows[0].pack_price, 67.09);
    assert.equal(rows[0].pack_unit, 'lb');
    assert.equal(rows[0].pack_size, 15);
    assert.ok(Math.abs(rows[0].unit_price - 67.09 / 15) < 1e-9);
  });

  // This is the 2026-08-01 failure, as a test. 411 of the catalog's 752 rows
  // have an empty Price cell; importing them is what blanked the table.
  it('skips a row with no price instead of importing a priceless one', () => {
    const { rows, skipped } = parseMasterCatalog(
      csv('LAR-1,Sysco,1,Sourdough,6/32 OZ/OZ,ROTELLA,,CS,Frozen,PH'),
    );
    assert.equal(rows.length, 0);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /price/i);
    assert.equal(skipped[0].ingredient, 'Sourdough');
  });

  // A row can be un-importable for lack of a price and still carry the one
  // thing nothing else in the repo records: how big its case is. Invoices know
  // what was paid per case but not what a case holds, so the two only combine
  // into a cost per pound if the skipped row keeps its pack size.
  it('keeps sku and pack size on a row skipped only for its price', () => {
    const { skipped } = parseMasterCatalog(
      csv('LAR-1,Sysco,7585326,Sourdough,6/32 OZ/OZ,ROTELLA,,CS,Frozen,PH'),
    );
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].sku, '7585326');
    assert.equal(skipped[0].vendor, 'sysco');
    assert.equal(skipped[0].pack_size, 192);
    assert.equal(skipped[0].pack_unit, 'oz');
  });

  it('leaves pack size null on a row whose pack could not be read either', () => {
    const { skipped } = parseMasterCatalog(
      csv('LAR-1,Sysco,9,Foil,1/18 IN/",B,,CS,Paper & Disposable,PH'),
    );
    assert.equal(skipped[0].pack_size, null);
    assert.equal(skipped[0].sku, '9');
  });

  it('skips a row whose pack size cannot be read, and says which', () => {
    const { rows, skipped } = parseMasterCatalog(
      csv('LAR-1,Sysco,1,Foil Sheets,1/18 IN/",B,42.00,CS,Paper & Disposable,PH'),
    );
    assert.equal(rows.length, 0);
    assert.equal(skipped[0].ingredient, 'Foil Sheets');
    assert.match(skipped[0].reason, /pack size/i);
  });

  it('keeps going after a bad row rather than aborting the file', () => {
    const { rows, skipped } = parseMasterCatalog(
      csv(
        'LAR-1,Sysco,1,Good One,1/15/LB,B,30.00,CS,Frozen,PH',
        'LAR-2,Sysco,2,No Price,1/15/LB,B,,CS,Frozen,PH',
        'LAR-3,Shamrock,3,Also Good,2/5 LB/LB,B,20.00,CS,Dairy,PH',
      ),
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.ingredient), ['Good One', 'Also Good']);
    assert.equal(rows[1].vendor, 'shamrock');
    assert.equal(skipped.length, 1);
  });

  it('reports a total so an operator can see what did not land', () => {
    const { rows, skipped, total } = parseMasterCatalog(
      csv(
        'LAR-1,Sysco,1,A,1/15/LB,B,30.00,CS,Frozen,PH',
        'LAR-2,Sysco,2,B,1/15/LB,B,,CS,Frozen,PH',
      ),
    );
    assert.equal(total, 2);
    assert.equal(rows.length + skipped.length, total);
  });

  it('produces rows lib/vendorPricesRepo will accept', async () => {
    const { validateVendorPriceRow } = await import('../../lib/vendorPricesRepo.ts');
    const { rows } = parseMasterCatalog(
      csv(
        'LAR-1,Sysco,1,Bacon,1/15/LB,B,67.09,CS,Frozen,PH',
        'LAR-2,Shamrock,2,Milk,4/1 GAL/GL,B,18.00,CS,Dairy,PH',
        'LAR-3,Sysco,3,Beans,6/#10/CT,B,42.00,CS,Canned & Dry,PH',
      ),
    );
    assert.equal(rows.length, 3);
    for (const r of rows) {
      const v = validateVendorPriceRow(r);
      assert.equal(v.ok, true, `${r.ingredient}: ${(v.errors || []).join('; ')}`);
    }
  });

  it('ignores a trailing blank line', () => {
    const { rows, total } = parseMasterCatalog(
      csv('LAR-1,Sysco,1,Bacon,1/15/LB,B,67.09,CS,Frozen,PH', '', ''),
    );
    assert.equal(rows.length, 1);
    assert.equal(total, 1);
  });
});
