#!/usr/bin/env node
// Regression tests for vendor price shock helpers.
//
// Run: node --experimental-strip-types --test tests/js/test-price-shocks.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-price-shocks-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const { listPriceShocks } = await import('../../lib/vendorPricesRepo.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM vendor_prices; DELETE FROM vendor_prices_history;');
});

function insertHistory({ unitPrice, snapshotAt, ingredient = 'TOMATO', vendor = 'Shamrock', sku = 'TOM-1' }) {
  testDb.prepare(
    `INSERT INTO vendor_prices_history
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
        category, location_id, imported_at, snapshot_at, snapshot_reason)
     VALUES (?, ?, ?, 1, 'lb', ?, ?, 'Produce', 'default', ?, ?, 'test')`,
  ).run(ingredient, vendor, sku, unitPrice, unitPrice, snapshotAt, snapshotAt);
}

function insertCurrent({ unitPrice, importedAt, ingredient = 'TOMATO', vendor = 'Shamrock', sku = 'TOM-1' }) {
  testDb.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
        category, location_id, imported_at)
     VALUES (?, ?, ?, 1, 'lb', ?, ?, 'Produce', 'default', ?)`,
  ).run(ingredient, vendor, sku, unitPrice, unitPrice, importedAt);
}

describe('listPriceShocks', () => {
  it('compares window baseline history against the live current vendor price', () => {
    insertHistory({ unitPrice: 10, snapshotAt: '2099-05-20 10:00:00' });
    insertCurrent({ unitPrice: 12.5, importedAt: '2099-05-21 10:00:00' });

    const rows = listPriceShocks(testDb, {
      location_id: 'default',
      windowDays: 90,
      minPctMove: 5,
      limit: 10,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendor, 'Shamrock');
    assert.equal(rows[0].sku, 'TOM-1');
    assert.equal(rows[0].baseline_unit_price, 10);
    assert.equal(rows[0].latest_unit_price, 12.5);
    assert.equal(rows[0].latest_at, '2099-05-21 10:00:00');
    assert.equal(rows[0].direction, 'up');
    assert.equal(Number(rows[0].delta_pct.toFixed(1)), 25.0);
  });

  it('returns no shock when only a current row exists', () => {
    insertCurrent({ unitPrice: 12.5, importedAt: '2099-05-21 10:00:00' });

    const rows = listPriceShocks(testDb, {
      location_id: 'default',
      windowDays: 90,
      minPctMove: 5,
    });

    assert.deepEqual(rows, []);
  });
});

describe('SkuHistoryPage Next 16 params contract', () => {
  it('unwraps promised params and searchParams before reading fields', () => {
    const source = fs.readFileSync(
      new URL('../../app/costing/prices/[vendor]/[sku]/page.jsx', import.meta.url),
      'utf8',
    );

    assert.match(source, /export\s+default\s+async\s+function\s+SkuHistoryPage/);
    assert.match(source, /await\s+params/);
    assert.match(source, /await\s+searchParams/);
  });
});
