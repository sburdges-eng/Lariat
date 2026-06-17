#!/usr/bin/env node
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { computeComparableUnitPrice, listVendorCompareRows } = await import(
  '../../lib/vendorCompare.ts'
);

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
});

function seedPair({ syscoPrice = 3.5, shamrockPrice = 3.2, syscoRec = null, shamrockRec = null } = {}) {
  db.prepare(
    `INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked)
     VALUES ('chicken_breast', 'Chicken Breast', NULL, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, reconciled_unit_price, location_id, master_id, imported_at)
     VALUES ('Chicken Breast', 'Sysco', 'S1', 1, 'lb', ?, ?, ?, 'default', 'chicken_breast', datetime('now'))`,
  ).run(syscoPrice, syscoPrice, syscoRec);
  db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, reconciled_unit_price, location_id, master_id, imported_at)
     VALUES ('Chicken Breast', 'Shamrock', 'H1', 1, 'lb', ?, ?, ?, 'default', 'chicken_breast', datetime('now'))`,
  ).run(shamrockPrice, shamrockPrice, shamrockRec);
}

describe('computeComparableUnitPrice', () => {
  it('uses reconciled_unit_price when set', () => {
    const row = {
      pack_size: 1,
      pack_unit: 'lb',
      pack_price: 10,
      unit_price: 10,
      reconciled_unit_price: 8.5,
    };
    const r = computeComparableUnitPrice(row, 'lb');
    assert.equal(r.status, 'ok');
    assert.equal(r.price, 8.5);
  });

  it('returns cannot_compare for incompatible units without bridge', () => {
    const row = {
      pack_size: 1,
      pack_unit: 'gal',
      pack_price: 10,
      unit_price: 10,
      reconciled_unit_price: null,
    };
    const r = computeComparableUnitPrice(row, 'lb');
    assert.equal(r.status, 'cannot_compare');
  });
});

describe('listVendorCompareRows', () => {
  it('returns mapped pair with shamrock cheaper', () => {
    seedPair({ syscoPrice: 3.5, shamrockPrice: 3.2 });
    const summary = listVendorCompareRows(db);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.rows[0].cheaper_vendor, 'shamrock');
    assert.equal(summary.rows[0].compare_status, 'comparable');
  });

  it('excludes master with only one vendor', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
       VALUES ('Lime', 'Sysco', 'L1', 1, 'lb', 2, 2, 'default', 'lime')`,
    ).run();
    const summary = listVendorCompareRows(db);
    assert.equal(summary.rows.length, 0);
    assert.equal(summary.masters_single_vendor_only, 1);
  });

  it('does not flag cheaper when quality locked', () => {
    seedPair();
    db.prepare(`UPDATE ingredient_masters SET quality_locked = 1, preferred_vendor = 'sysco' WHERE master_id = 'chicken_breast'`).run();
    const summary = listVendorCompareRows(db);
    assert.equal(summary.rows[0].cheaper_vendor, null);
  });
});
