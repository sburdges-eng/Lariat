#!/usr/bin/env node
// Tests for lib/packChangesRepo.ts — list/acknowledge helpers for the
// pack_size_changes triage queue. Companion test for the API route
// lives in test-pack-changes-route.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-pack-changes-repo.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const {
  listPackChanges,
  unacknowledgedCount,
  acknowledgePackChange,
} = await import('../../lib/packChangesRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM pack_size_changes;
    DELETE FROM vendor_prices;
  `);
});

function seedChange({
  id,
  vendor = 'sysco',
  sku,
  prev_pack = '6×#10',
  new_pack = '4×#10',
  prev_price = 42.0,
  new_price = 36.0,
  detected_at,
  acknowledged = 0,
}) {
  db.prepare(
    `INSERT INTO pack_size_changes
       (id, vendor, sku, prev_pack, new_pack, prev_price, new_price, detected_at, acknowledged)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
  ).run(id ?? null, vendor, sku, prev_pack, new_pack, prev_price, new_price, detected_at ?? null, acknowledged);
}

function seedVendorPrice({ vendor, sku, ingredient }) {
  db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
     VALUES (?, ?, ?, 4, '#10', 36.0, 9.0, 'default')`,
  ).run(ingredient, vendor, sku);
}

describe('listPackChanges', () => {
  it('returns empty when no changes recorded', () => {
    assert.deepEqual(listPackChanges(db), []);
  });

  it('defaults to open (acknowledged=0) only', () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const out = listPackChanges(db);
    assert.equal(out.length, 1);
    assert.equal(out[0].sku, 'OPEN-1');
  });

  it('filter=acknowledged returns only acknowledged rows', () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const out = listPackChanges(db, { filter: 'acknowledged' });
    assert.equal(out.length, 1);
    assert.equal(out[0].sku, 'CLOSED-1');
  });

  it('filter=all returns both', () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const out = listPackChanges(db, { filter: 'all' });
    assert.equal(out.length, 2);
  });

  it('joins ingredient name from latest vendor_prices row', () => {
    seedChange({ sku: 'TOM-001' });
    seedVendorPrice({ vendor: 'sysco', sku: 'TOM-001', ingredient: 'Tomato Sauce' });
    const [row] = listPackChanges(db);
    assert.equal(row.ingredient, 'Tomato Sauce');
  });

  it('returns ingredient=null when SKU is not in vendor_prices', () => {
    seedChange({ sku: 'GHOST-001' });
    const [row] = listPackChanges(db);
    assert.equal(row.ingredient, null);
  });

  it('computes price_delta_pct from prev/new prices', () => {
    seedChange({ sku: 'A', prev_price: 100, new_price: 110 });
    const [row] = listPackChanges(db);
    assert.ok(Math.abs(row.price_delta_pct - 0.1) < 1e-9);
  });

  it('price_delta_pct is null when prev_price is 0 or null', () => {
    seedChange({ sku: 'A', prev_price: null, new_price: 100 });
    seedChange({ sku: 'B', prev_price: 0, new_price: 100 });
    const out = listPackChanges(db);
    for (const r of out) assert.equal(r.price_delta_pct, null);
  });

  it('vendor filter is case-insensitive prefix match', () => {
    seedChange({ vendor: 'sysco', sku: 'A' });
    seedChange({ vendor: 'shamrock', sku: 'B' });
    const out = listPackChanges(db, { vendor: 'SYS' });
    assert.equal(out.length, 1);
    assert.equal(out[0].vendor, 'sysco');
  });

  it('orders by detected_at DESC, id DESC', () => {
    seedChange({ sku: 'OLD', detected_at: '2026-01-01 00:00:00' });
    seedChange({ sku: 'NEW', detected_at: '2026-04-01 00:00:00' });
    const out = listPackChanges(db);
    assert.equal(out[0].sku, 'NEW');
    assert.equal(out[1].sku, 'OLD');
  });

  it('honors limit cap', () => {
    for (let i = 0; i < 5; i++) seedChange({ sku: `S-${i}` });
    const out = listPackChanges(db, { limit: 2 });
    assert.equal(out.length, 2);
  });
});

describe('unacknowledgedCount', () => {
  it('counts only acknowledged=0 rows', () => {
    seedChange({ sku: 'O1' });
    seedChange({ sku: 'O2' });
    seedChange({ sku: 'C1', acknowledged: 1 });
    assert.equal(unacknowledgedCount(db).total, 2);
  });
});

describe('acknowledgePackChange', () => {
  it('returns found=false for an unknown id', () => {
    const r = acknowledgePackChange(db, 999);
    assert.equal(r.found, false);
    assert.equal(r.row, null);
  });

  it('flips acknowledged 0 → 1 and reports the prior state', () => {
    seedChange({ id: 1, sku: 'A' });
    const r = acknowledgePackChange(db, 1);
    assert.equal(r.found, true);
    assert.equal(r.was_already_acknowledged, false);
    assert.equal(r.acknowledged, 1);
    const persisted = db.prepare('SELECT acknowledged FROM pack_size_changes WHERE id = 1').get();
    assert.equal(persisted.acknowledged, 1);
  });

  it('is idempotent on a second call', () => {
    seedChange({ id: 1, sku: 'A' });
    acknowledgePackChange(db, 1);
    const r2 = acknowledgePackChange(db, 1);
    assert.equal(r2.found, true);
    assert.equal(r2.was_already_acknowledged, true);
    assert.equal(r2.acknowledged, 1);
  });
});
