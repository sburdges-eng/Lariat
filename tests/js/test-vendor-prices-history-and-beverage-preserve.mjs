#!/usr/bin/env node
// Tests for the two-part footgun fix on scripts/ingest-costing.mjs:
//
//   1. Beverage-category preservation:
//      DELETE FROM vendor_prices now skips rows whose category is a known
//      beverage (Beer / Wine / Liquor / Spirit / Cocktail, case-insensitive).
//      Food rows (category NULL or anything else) still get wiped as before.
//
//   2. vendor_prices_history snapshot:
//      Before the DELETE sweep runs, every row in vendor_prices for the
//      target location is copied into vendor_prices_history. Append-only,
//      so a series of runs builds a price trend timeline.
//
// Run: node --experimental-strip-types --test tests/js/test-vendor-prices-history-and-beverage-preserve.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const dbMod = await import('../../lib/db.ts');
const { ingestCosting, BEVERAGE_CATEGORIES } = await import(
  '../../scripts/ingest-costing.mjs'
);

let tmpDir;
let dbPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-vph-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  dbMod.setDbPathForTest(dbPath);
  dbMod.getDb(); // force init
});

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const db = dbMod.getDb();
  db.exec(`
    DELETE FROM vendor_prices;
    DELETE FROM vendor_prices_history;
    DELETE FROM recipe_costs;
    DELETE FROM bom_lines;
    DELETE FROM ingest_runs;
  `);
});

// Minimal costing payload shape — just enough to drive _ingestCostingImpl.
function payload(vendorPrices = []) {
  return {
    vendor_prices: vendorPrices,
    recipe_costs: [],
    bom_lines: [],
    ingredient_maps: [],
    order_guide: [],
  };
}

function seedBeverageDirectly(db, row) {
  db.prepare(`
    INSERT INTO vendor_prices
      (ingredient, vendor, sku, pack_size, pack_unit, pack_price,
       unit_price, category, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.ingredient,
    row.vendor,
    row.sku,
    row.pack_size,
    row.pack_unit,
    row.pack_price,
    row.unit_price,
    row.category,
    row.location_id ?? 'default',
  );
}

describe('BEVERAGE_CATEGORIES constant', () => {
  it('is a non-empty array of lowercase category strings', () => {
    assert.ok(Array.isArray(BEVERAGE_CATEGORIES));
    assert.ok(BEVERAGE_CATEGORIES.length > 0);
    for (const c of BEVERAGE_CATEGORIES) {
      assert.strictEqual(typeof c, 'string');
      assert.strictEqual(c, c.toLowerCase(), `${c} should be lowercase`);
    }
  });

  it('covers the five categories the PR #27 importer uses', () => {
    for (const c of ['beer', 'wine', 'liquor', 'spirit', 'cocktail']) {
      assert.ok(BEVERAGE_CATEGORIES.includes(c), `missing ${c}`);
    }
  });
});

describe('costing ingest — beverage-row preservation', () => {
  it('preserves a row with category=Beer (title-case)', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'Coors Btl 12oz',
      vendor: "Southern Glazer's",
      sku: 'SGWS-COORS-12',
      pack_size: 12,
      pack_unit: 'bottle',
      pack_price: 18.0,
      unit_price: 1.5,
      category: 'Beer',
    });

    ingestCosting(db, payload([]), 'default');

    const rows = db.prepare(
      `SELECT * FROM vendor_prices WHERE location_id = ?`,
    ).all('default');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].sku, 'SGWS-COORS-12');
    assert.strictEqual(rows[0].category, 'Beer');
  });

  it('preserves rows across all casings (Beer / BEER / beer)', () => {
    const db = dbMod.getDb();
    for (const [i, cat] of ['Beer', 'BEER', 'beer', 'Wine', 'LIQUOR', 'cocktail'].entries()) {
      seedBeverageDirectly(db, {
        ingredient: `drink-${i}`,
        vendor: 'v',
        sku: `sku-${i}`,
        pack_size: 1,
        pack_unit: 'bottle',
        pack_price: 10,
        unit_price: 10,
        category: cat,
      });
    }

    ingestCosting(db, payload([]), 'default');

    const n = db.prepare(
      `SELECT COUNT(*) AS c FROM vendor_prices WHERE location_id = ?`,
    ).get('default').c;
    assert.strictEqual(n, 6);
  });

  it('wipes rows with category NULL (food default)', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'onions',
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      pack_size: 50,
      pack_unit: 'lb',
      pack_price: 25,
      unit_price: 0.5,
      category: null,
    });

    ingestCosting(db, payload([]), 'default');

    const rows = db.prepare(
      `SELECT * FROM vendor_prices WHERE location_id = ?`,
    ).all('default');
    assert.strictEqual(rows.length, 0);
  });

  it('wipes rows with a non-beverage category string', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'butter',
      vendor: 'Shamrock',
      sku: 'SHAM-BUTTER',
      pack_size: 30,
      pack_unit: 'lb',
      pack_price: 120,
      unit_price: 4,
      category: 'Dairy',
    });

    ingestCosting(db, payload([]), 'default');

    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices`).get().c,
      0,
    );
  });

  it('location scoping — preserves a beverage row only in its own location', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'whiskey',
      vendor: 'v',
      sku: 'W-1',
      pack_size: 1,
      pack_unit: 'bottle',
      pack_price: 30,
      unit_price: 30,
      category: 'Liquor',
      location_id: 'default',
    });
    seedBeverageDirectly(db, {
      ingredient: 'whiskey',
      vendor: 'v',
      sku: 'W-1',
      pack_size: 1,
      pack_unit: 'bottle',
      pack_price: 30,
      unit_price: 30,
      category: 'Liquor',
      location_id: 'lariat-south',
    });

    // Run costing ingest only on default location.
    ingestCosting(db, payload([]), 'default');

    assert.strictEqual(
      db.prepare(
        `SELECT COUNT(*) AS c FROM vendor_prices WHERE location_id = ?`,
      ).get('default').c,
      1,
    );
    assert.strictEqual(
      db.prepare(
        `SELECT COUNT(*) AS c FROM vendor_prices WHERE location_id = ?`,
      ).get('lariat-south').c,
      1,
    );
  });
});

describe('vendor_prices_history snapshot', () => {
  it('captures food rows before the DELETE wipes them', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'onions',
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      pack_size: 50,
      pack_unit: 'lb',
      pack_price: 25,
      unit_price: 0.5,
      category: null,
    });

    ingestCosting(db, payload([]), 'default');

    // vendor_prices is wiped (food), but the snapshot has a copy.
    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices`).get().c,
      0,
    );
    const hist = db.prepare(
      `SELECT * FROM vendor_prices_history WHERE sku = ?`,
    ).all('SYSCO-ONION');
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].pack_price, 25);
    assert.strictEqual(hist[0].snapshot_reason, 'ingest-costing');
    assert.ok(hist[0].snapshot_at, 'snapshot_at should be populated');
    assert.ok(Number.isInteger(hist[0].run_id), 'run_id should be the ingest_runs id');
  });

  it('captures beverage rows too — even though they survive the DELETE', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'Coors',
      vendor: 'SGWS',
      sku: 'C-12',
      pack_size: 12,
      pack_unit: 'bottle',
      pack_price: 18,
      unit_price: 1.5,
      category: 'Beer',
    });

    ingestCosting(db, payload([]), 'default');

    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices`).get().c,
      1,
    );
    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices_history`).get().c,
      1,
    );
  });

  it('builds a growing price-series across multiple runs', () => {
    const db = dbMod.getDb();

    // Run 1: onions at $25
    seedBeverageDirectly(db, {
      ingredient: 'onions',
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      pack_size: 50,
      pack_unit: 'lb',
      pack_price: 25,
      unit_price: 0.5,
      category: null,
    });
    ingestCosting(db, payload([]), 'default');

    // Run 2: re-seed onions at $30
    seedBeverageDirectly(db, {
      ingredient: 'onions',
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      pack_size: 50,
      pack_unit: 'lb',
      pack_price: 30,
      unit_price: 0.6,
      category: null,
    });
    ingestCosting(db, payload([]), 'default');

    // Run 3: re-seed onions at $28
    seedBeverageDirectly(db, {
      ingredient: 'onions',
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      pack_size: 50,
      pack_unit: 'lb',
      pack_price: 28,
      unit_price: 0.56,
      category: null,
    });
    ingestCosting(db, payload([]), 'default');

    // History should have 3 rows for this SKU, in chronological order by
    // snapshot_at, each with a distinct run_id.
    const series = db.prepare(`
      SELECT pack_price, unit_price, run_id, snapshot_at
        FROM vendor_prices_history
       WHERE sku = ?
       ORDER BY snapshot_at ASC, id ASC
    `).all('SYSCO-ONION');
    assert.strictEqual(series.length, 3);
    assert.deepStrictEqual(
      series.map((r) => r.pack_price),
      [25, 30, 28],
    );
    const runIds = new Set(series.map((r) => r.run_id));
    assert.strictEqual(runIds.size, 3, 'each snapshot should reference a distinct run_id');
  });

  it('snapshot row copies all the enriched columns (yield_pct, master_id, etc.)', () => {
    const db = dbMod.getDb();
    db.prepare(`
      INSERT INTO vendor_prices
        (ingredient, vendor, sku, pack_size, pack_unit, pack_price,
         unit_price, category, yield_pct, actual_received_lb,
         reconciled_unit_price, master_id, location_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ribeye',
      'Sysco',
      'RIB-10LB',
      10,
      'lb',
      150,
      15,
      null,
      0.88,
      9.9,
      15.15,
      'ribeye_primary',
      'default',
    );

    ingestCosting(db, payload([]), 'default');

    const h = db.prepare(
      `SELECT * FROM vendor_prices_history WHERE sku = ?`,
    ).get('RIB-10LB');
    assert.ok(h);
    assert.strictEqual(h.yield_pct, 0.88);
    assert.strictEqual(h.actual_received_lb, 9.9);
    assert.strictEqual(h.reconciled_unit_price, 15.15);
    assert.strictEqual(h.master_id, 'ribeye_primary');
  });

  it('snapshot is location-scoped — only the ingested location is captured', () => {
    const db = dbMod.getDb();
    seedBeverageDirectly(db, {
      ingredient: 'A',
      vendor: 'v',
      sku: 'A-1',
      pack_size: 1,
      pack_unit: 'lb',
      pack_price: 1,
      unit_price: 1,
      category: null,
      location_id: 'default',
    });
    seedBeverageDirectly(db, {
      ingredient: 'B',
      vendor: 'v',
      sku: 'B-1',
      pack_size: 1,
      pack_unit: 'lb',
      pack_price: 2,
      unit_price: 2,
      category: null,
      location_id: 'lariat-south',
    });

    ingestCosting(db, payload([]), 'default');

    const defSnap = db.prepare(
      `SELECT * FROM vendor_prices_history WHERE location_id = ?`,
    ).all('default');
    const southSnap = db.prepare(
      `SELECT * FROM vendor_prices_history WHERE location_id = ?`,
    ).all('lariat-south');

    assert.strictEqual(defSnap.length, 1);
    assert.strictEqual(defSnap[0].sku, 'A-1');
    assert.strictEqual(southSnap.length, 0);
  });

  it('snapshot never exceeds the number of rows in vendor_prices at snapshot time', () => {
    const db = dbMod.getDb();
    // Empty vendor_prices → ingest → zero snapshot rows (no error).
    ingestCosting(db, payload([]), 'default');
    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices_history`).get().c,
      0,
    );
  });
});
