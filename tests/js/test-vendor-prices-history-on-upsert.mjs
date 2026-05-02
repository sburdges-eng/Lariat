#!/usr/bin/env node
// Pin the contract: every UPDATE-path call to upsertVendorPrice
// snapshots the pre-update row into vendor_prices_history.
//
// Background — found via the 2026-05-02 breaker audit (Section 4 P1):
//   docs/agentic/findings/2026-05-02-beverage-vendor-prices-history-gap.md
//
// scripts/import-vendor-prices.mjs is the only writer for the beverage
// class (out-of-band imports the costing ingest doesn't touch). It
// calls upsertVendorPrice, which used to UPDATE in place with no
// snapshot. Between two beverage CSV imports without a costing ingest
// in between, the pre-update price was silently lost from history.
//
// This file pins:
//   1. INSERT path writes vendor_prices, NO history row (no prior state).
//   2. UPDATE path writes vendor_prices, AND a history row carrying the
//      OLD price/pack with snapshot_reason='upsert-vendor-price'.
//   3. SKIPPED path (identical row) writes neither vendor_prices nor history.
//   4. UPDATE failure rolls back the history snapshot too (same tx).
//
// Run: node --experimental-strip-types --test tests/js/test-vendor-prices-history-on-upsert.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-vph-upsert-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { upsertVendorPrice } = await import('../../lib/vendorPricesRepo.ts');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM vendor_prices_history;
    DELETE FROM vendor_prices;
  `);
});

const ROW_BEER_A = {
  location_id: 'default',
  vendor: 'Reyes',
  sku: 'BEER-001',
  ingredient: 'Coors Banquet 12pk',
  pack_size: 12,
  pack_unit: 'bottle',
  pack_price: 18.0,
  unit_price: 1.5,
  category: 'beer',
};

const ROW_BEER_B = {
  ...ROW_BEER_A,
  pack_price: 20.0, // distributor bumped 12pk price
  unit_price: 1.6666666666666667,
};

function countRows(table) {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

describe('upsertVendorPrice — vendor_prices_history snapshot on UPDATE', () => {
  it('INSERT path writes vendor_prices but NO history (no prior state)', () => {
    const r = upsertVendorPrice(testDb, ROW_BEER_A);
    assert.strictEqual(r.outcome, 'inserted');
    assert.strictEqual(countRows('vendor_prices'), 1);
    assert.strictEqual(countRows('vendor_prices_history'), 0);
  });

  it('UPDATE path snapshots the OLD price into history before mutating', () => {
    upsertVendorPrice(testDb, ROW_BEER_A);
    assert.strictEqual(countRows('vendor_prices_history'), 0);

    const r = upsertVendorPrice(testDb, ROW_BEER_B);
    assert.strictEqual(r.outcome, 'updated');
    assert.strictEqual(countRows('vendor_prices'), 1, 'still one live row');
    assert.strictEqual(countRows('vendor_prices_history'), 1, 'one snapshot row');

    const snap = testDb
      .prepare(
        `SELECT vendor, sku, ingredient, pack_price, unit_price, category,
                snapshot_reason, source_vendor_price_id
           FROM vendor_prices_history`,
      )
      .get();
    // Snapshot carries the OLD price (A), not the new one (B).
    assert.strictEqual(snap.pack_price, 18.0);
    assert.strictEqual(snap.unit_price, 1.5);
    assert.strictEqual(snap.snapshot_reason, 'upsert-vendor-price');
    assert.strictEqual(snap.vendor, 'Reyes');
    assert.strictEqual(snap.sku, 'BEER-001');
    assert.strictEqual(snap.ingredient, 'Coors Banquet 12pk');
    assert.strictEqual(snap.category, 'beer');
    assert.ok(
      snap.source_vendor_price_id != null,
      'source_vendor_price_id should reference the pre-update vendor_prices row',
    );
  });

  it('two consecutive price changes produce two snapshots in time order', () => {
    upsertVendorPrice(testDb, ROW_BEER_A);
    upsertVendorPrice(testDb, ROW_BEER_B);

    const ROW_BEER_C = { ...ROW_BEER_B, pack_price: 22.0, unit_price: 22 / 12 };
    upsertVendorPrice(testDb, ROW_BEER_C);

    const snaps = testDb
      .prepare(
        `SELECT pack_price, snapshot_reason
           FROM vendor_prices_history
          ORDER BY id ASC`,
      )
      .all();
    assert.strictEqual(snaps.length, 2);
    assert.strictEqual(snaps[0].pack_price, 18.0);
    assert.strictEqual(snaps[1].pack_price, 20.0);
    for (const s of snaps) {
      assert.strictEqual(s.snapshot_reason, 'upsert-vendor-price');
    }
  });

  it('SKIPPED path (identical row) writes neither vendor_prices nor history', () => {
    upsertVendorPrice(testDb, ROW_BEER_A);
    const r = upsertVendorPrice(testDb, ROW_BEER_A);
    assert.strictEqual(r.outcome, 'skipped');
    assert.strictEqual(countRows('vendor_prices'), 1);
    assert.strictEqual(countRows('vendor_prices_history'), 0);
  });

  it('UPDATE failure rolls back the history snapshot too (same tx)', () => {
    upsertVendorPrice(testDb, ROW_BEER_A);

    // Force the UPDATE to throw by renaming the live table mid-flight.
    // The snapshot INSERT runs first inside the same transaction; the
    // UPDATE then fails because vendor_prices is gone; the entire tx
    // rolls back, leaving history empty.
    testDb.exec('ALTER TABLE vendor_prices RENAME TO vendor_prices_stash');
    try {
      try { upsertVendorPrice(testDb, ROW_BEER_B); } catch { /* expected */ }
    } finally {
      testDb.exec('ALTER TABLE vendor_prices_stash RENAME TO vendor_prices');
    }

    assert.strictEqual(
      countRows('vendor_prices_history'), 0,
      'snapshot must roll back when UPDATE throws inside same tx',
    );
  });
});
