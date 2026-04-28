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
const { listPriceSeries } = await import('../../lib/vendorPricesRepo.ts');
const historyRoute = await import('../../app/api/vendor-prices/history/route.js');

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

// Helper: seed a synthetic snapshot directly into vendor_prices_history.
// We insert at the history table rather than running a full ingest so
// each test is fast and isolated from the wider costing pipeline.
function seedHistoryRow(db, row) {
  db.prepare(`
    INSERT INTO vendor_prices_history
      (run_id, source_vendor_price_id, ingredient, vendor, sku,
       pack_size, pack_unit, pack_price, unit_price, category,
       yield_pct, actual_received_lb, reconciled_unit_price,
       master_id, location_id, imported_at, snapshot_at, snapshot_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.run_id ?? null,
    row.source_vendor_price_id ?? null,
    row.ingredient ?? 'onions',
    row.vendor ?? 'Sysco',
    row.sku ?? 'SYSCO-ONION',
    row.pack_size ?? 50,
    row.pack_unit ?? 'lb',
    row.pack_price ?? 25,
    row.unit_price ?? 0.5,
    row.category ?? null,
    row.yield_pct ?? null,
    row.actual_received_lb ?? null,
    row.reconciled_unit_price ?? null,
    row.master_id ?? null,
    row.location_id ?? 'default',
    row.imported_at ?? null,
    // Explicit snapshot_at so tests can build a deterministic ordering
    // independent of the DB clock.
    row.snapshot_at ?? '2026-04-20T10:00:00.000Z',
    row.snapshot_reason ?? 'ingest-costing',
  );
}

// Design call — documented here and in the listPriceSeries JSDoc:
//
//   `limit` keeps the OLDEST N rows. A chronological price-trend chart
//   that shows the beginning of a SKU's history is more useful than an
//   arbitrarily-truncated recent suffix. Callers who want the tail can
//   request a larger limit (capped at 1000).
describe('listPriceSeries + /api/vendor-prices/history', () => {
  it('returns [] when the history table is empty', () => {
    const db = dbMod.getDb();
    const series = listPriceSeries(db, { vendor: 'Sysco', sku: 'SYSCO-ONION' });
    assert.deepStrictEqual(series, []);
  });

  it('returns one row with the expected column set for a single snapshot', () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, {
      run_id: 1,
      pack_price: 25,
      unit_price: 0.5,
      yield_pct: 0.9,
      actual_received_lb: 49.5,
      reconciled_unit_price: 0.55,
      imported_at: '2026-04-20T09:55:00.000Z',
      snapshot_at: '2026-04-20T10:00:00.000Z',
    });

    const series = listPriceSeries(db, { vendor: 'Sysco', sku: 'SYSCO-ONION' });
    assert.strictEqual(series.length, 1);
    const row = series[0];

    // Exact column set — no category / ingredient / vendor / sku / id.
    assert.deepStrictEqual(
      Object.keys(row).sort(),
      [
        'actual_received_lb',
        'imported_at',
        'pack_price',
        'pack_size',
        'pack_unit',
        'reconciled_unit_price',
        'run_id',
        'snapshot_at',
        'unit_price',
        'yield_pct',
      ],
    );
    assert.strictEqual(row.pack_price, 25);
    assert.strictEqual(row.unit_price, 0.5);
    assert.strictEqual(row.run_id, 1);
    assert.strictEqual(row.yield_pct, 0.9);
  });

  it('returns three snapshots in ascending chronological order', () => {
    const db = dbMod.getDb();
    // Seed out-of-order on purpose to prove the ORDER BY actually runs.
    seedHistoryRow(db, { run_id: 2, pack_price: 30, snapshot_at: '2026-04-21T10:00:00.000Z' });
    seedHistoryRow(db, { run_id: 3, pack_price: 28, snapshot_at: '2026-04-22T10:00:00.000Z' });
    seedHistoryRow(db, { run_id: 1, pack_price: 25, snapshot_at: '2026-04-20T10:00:00.000Z' });

    const series = listPriceSeries(db, { vendor: 'Sysco', sku: 'SYSCO-ONION' });
    assert.strictEqual(series.length, 3);
    assert.deepStrictEqual(
      series.map((r) => r.pack_price),
      [25, 30, 28],
    );
    assert.deepStrictEqual(
      series.map((r) => r.run_id),
      [1, 2, 3],
    );
  });

  it('returns [] for an unknown (vendor, sku) pair — not an error', () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, { vendor: 'Sysco', sku: 'SYSCO-ONION' });
    const series = listPriceSeries(db, { vendor: 'Sysco', sku: 'NOPE-404' });
    assert.deepStrictEqual(series, []);
  });

  it('returns [] for blank vendor or blank sku', () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, { vendor: 'Sysco', sku: 'SYSCO-ONION' });
    assert.deepStrictEqual(
      listPriceSeries(db, { vendor: '', sku: 'SYSCO-ONION' }),
      [],
    );
    assert.deepStrictEqual(
      listPriceSeries(db, { vendor: 'Sysco', sku: '   ' }),
      [],
    );
  });

  it('scopes to the requested location — same (vendor, sku) in two kitchens', () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      location_id: 'default',
      pack_price: 25,
      snapshot_at: '2026-04-20T10:00:00.000Z',
    });
    seedHistoryRow(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      location_id: 'lariat-south',
      pack_price: 27,
      snapshot_at: '2026-04-20T10:00:00.000Z',
    });

    const def = listPriceSeries(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      location_id: 'default',
    });
    const south = listPriceSeries(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      location_id: 'lariat-south',
    });
    assert.strictEqual(def.length, 1);
    assert.strictEqual(def[0].pack_price, 25);
    assert.strictEqual(south.length, 1);
    assert.strictEqual(south[0].pack_price, 27);
  });

  it('limit truncates to the oldest N rows (documented direction)', () => {
    const db = dbMod.getDb();
    for (let i = 0; i < 5; i++) {
      // Build a strictly-ordered snapshot_at timeline: t0 … t4.
      seedHistoryRow(db, {
        run_id: i + 1,
        pack_price: 20 + i,
        snapshot_at: `2026-04-${20 + i}T10:00:00.000Z`,
      });
    }

    const series = listPriceSeries(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      limit: 3,
    });
    assert.strictEqual(series.length, 3);
    // Oldest three, in ascending order.
    assert.deepStrictEqual(
      series.map((r) => r.pack_price),
      [20, 21, 22],
    );
  });

  it('limit=0 / negative / non-finite falls back to the default (100)', () => {
    const db = dbMod.getDb();
    // Only one row, so the actual count is 1 regardless of limit. The
    // assertion we care about is "no error, row returned, limit ignored".
    seedHistoryRow(db, { pack_price: 25 });

    for (const bad of [0, -7, NaN, Infinity, -Infinity]) {
      const series = listPriceSeries(db, {
        vendor: 'Sysco',
        sku: 'SYSCO-ONION',
        limit: bad,
      });
      assert.strictEqual(series.length, 1, `limit=${bad} should not error`);
      assert.strictEqual(series[0].pack_price, 25);
    }
  });

  it('limit clamps above 1000 to 1000', () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, { pack_price: 25 });
    // Not asserting the SQL LIMIT value directly (would require
    // seeding 1001 rows); just that a huge limit doesn't throw and
    // still returns the rows that exist.
    const series = listPriceSeries(db, {
      vendor: 'Sysco',
      sku: 'SYSCO-ONION',
      limit: 999_999,
    });
    assert.strictEqual(series.length, 1);
  });

  // ── Route-level tests ──────────────────────────────────────────

  function getReq(qs) {
    return new Request(`http://localhost/api/vendor-prices/history${qs}`);
  }

  it('route: GET with valid params returns 200 and the expected shape', async () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, {
      run_id: 1,
      pack_price: 25,
      unit_price: 0.5,
      snapshot_at: '2026-04-20T10:00:00.000Z',
    });
    seedHistoryRow(db, {
      run_id: 2,
      pack_price: 30,
      unit_price: 0.6,
      snapshot_at: '2026-04-21T10:00:00.000Z',
    });

    const res = await historyRoute.GET(
      getReq('?vendor=Sysco&sku=SYSCO-ONION&location=default&limit=50'),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.vendor, 'Sysco');
    assert.strictEqual(body.sku, 'SYSCO-ONION');
    assert.strictEqual(body.location_id, 'default');
    assert.strictEqual(body.limit, 50);
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.series.length, 2);
    assert.strictEqual(body.series[0].pack_price, 25);
    assert.strictEqual(body.series[1].pack_price, 30);
  });

  it('route: GET missing vendor returns 400', async () => {
    const res = await historyRoute.GET(getReq('?sku=SYSCO-ONION'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /vendor and sku are required/);
  });

  it('route: GET missing sku returns 400', async () => {
    const res = await historyRoute.GET(getReq('?vendor=Sysco'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /vendor and sku are required/);
  });

  it('route: GET with unknown (vendor, sku) returns 200 with empty series', async () => {
    const res = await historyRoute.GET(
      getReq('?vendor=Sysco&sku=DOES-NOT-EXIST'),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.count, 0);
    assert.deepStrictEqual(body.series, []);
  });

  it('route: invalid / absent limit falls back to 100', async () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, { pack_price: 25 });
    const res = await historyRoute.GET(
      getReq('?vendor=Sysco&sku=SYSCO-ONION&limit=abc'),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.limit, 100);
    assert.strictEqual(body.count, 1);
  });

  it('route: location_id alias works (either ?location= or ?location_id=)', async () => {
    const db = dbMod.getDb();
    seedHistoryRow(db, {
      location_id: 'lariat-south',
      pack_price: 27,
    });
    const res = await historyRoute.GET(
      getReq('?vendor=Sysco&sku=SYSCO-ONION&location_id=lariat-south'),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.location_id, 'lariat-south');
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.series[0].pack_price, 27);
  });
});
