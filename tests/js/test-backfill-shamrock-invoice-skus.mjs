#!/usr/bin/env node
// Tests for scripts/backfill-shamrock-invoice-skus.mjs — runs against an
// :memory: better-sqlite3 fixture so we never touch data/lariat.db.
//
// Covers:
//   - missing-SKU selection (3 missing of 5 invoice SKUs become 3 inserts)
//   - idempotency (a second run inserts zero rows)
//   - per-case branch: CS-style pack 12@$48 → pack_price=$48, unit_price=$4
//   - catch-weight branch: pack_unit='lb', pack_size=15, $5/lb →
//     pack_price=$75, unit_price=$5
//   - skipped_no_pack_size: rows with NULL pack_size produce no INSERT
//   - normalizeIngredient strips "Actual Weight: NNlbs" debris
//
// Run: node --experimental-strip-types --test tests/js/test-backfill-shamrock-invoice-skus.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { runBackfill, recomputePricing, normalizeIngredient } = await import(
  '../../scripts/backfill-shamrock-invoice-skus.mjs'
);

// ── Schema ──────────────────────────────────────────────────────────
// Mirrors lib/db.ts initSchema for the three tables we touch. Kept minimal
// — only the columns the backfill reads or writes.

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE shamrock_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      delivery_date TEXT,
      ordered_date TEXT,
      item TEXT NOT NULL,
      sku TEXT,
      qty REAL,
      pack_size REAL,
      pack_unit TEXT,
      unit_price REAL,
      line_total REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE vendor_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT NOT NULL,
      vendor TEXT,
      sku TEXT,
      pack_size REAL,
      pack_unit TEXT,
      pack_price REAL,
      unit_price REAL,
      category TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      yield_pct REAL,
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      map_status TEXT,
      master_id TEXT
    );

    CREATE TABLE ingest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      rows_in INTEGER,
      rows_out INTEGER,
      status TEXT
    );
  `);
  return db;
}

function seedInvoice(db, rows) {
  const ins = db.prepare(`
    INSERT INTO shamrock_invoices
      (invoice_no, delivery_date, item, sku, qty, pack_size, pack_unit,
       unit_price, line_total, location_id)
    VALUES
      (@invoice_no, @delivery_date, @item, @sku, @qty, @pack_size,
       @pack_unit, @unit_price, @line_total, @location_id)
  `);
  for (const r of rows) {
    ins.run({
      invoice_no: 'INV-1',
      delivery_date: '2026-04-01',
      qty: 1,
      line_total: null,
      location_id: 'default',
      pack_unit: null,
      pack_size: null,
      unit_price: null,
      sku: null,
      item: '',
      ...r,
    });
  }
}

function seedVendorPrice(db, row) {
  db.prepare(`
    INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit,
                               pack_price, unit_price, location_id)
    VALUES (@ingredient, 'shamrock', @sku, @pack_size, @pack_unit,
            @pack_price, @unit_price, 'default')
  `).run(row);
}

// ── Pure-function unit tests ────────────────────────────────────────

describe('normalizeIngredient', () => {
  it('strips Actual Weight suffix and collapses whitespace', () => {
    assert.equal(
      normalizeIngredient('BEEF, CHEEK MEAT REFRIG Actual Weight: 30.60lbs'),
      'BEEF, CHEEK MEAT REFRIG',
    );
    assert.equal(
      normalizeIngredient('HAM Actual Weight: 19lbs'),
      'HAM',
    );
  });

  it('leaves non-catch-weight text intact (preserves ALL CAPS)', () => {
    assert.equal(
      normalizeIngredient('OIL, CANOLA CLR FRY ZTF'),
      'OIL, CANOLA CLR FRY ZTF',
    );
  });

  it('handles non-string input', () => {
    assert.equal(normalizeIngredient(null), '');
    assert.equal(normalizeIngredient(undefined), '');
  });
});

describe('recomputePricing', () => {
  it('per_case branch: pack_size=12, unit_price=48 → pack=48, unit=4', () => {
    const out = recomputePricing({
      item: 'WATER, BOTTLED 24Z',
      pack_size: 12,
      pack_unit: 'cs',
      unit_price: 48,
    });
    assert.equal(out.branch, 'per_case');
    assert.equal(out.pack_price, 48);
    assert.equal(out.unit_price, 4);
  });

  it('catch_weight branch: pack_size=15, unit_price=5 → pack=75, unit=5', () => {
    const out = recomputePricing({
      item: 'CHEESE Actual Weight: 14.80lbs',
      pack_size: 15,
      pack_unit: 'lb',
      unit_price: 5,
    });
    assert.equal(out.branch, 'catch_weight');
    assert.equal(out.pack_price, 75);
    assert.equal(out.unit_price, 5);
  });

  it('returns null when pack_size is null or 0', () => {
    assert.equal(recomputePricing({ item: 'X', pack_size: null, unit_price: 5 }), null);
    assert.equal(recomputePricing({ item: 'X', pack_size: 0, unit_price: 5 }), null);
  });

  it('returns null when unit_price is not finite', () => {
    assert.equal(recomputePricing({ item: 'X', pack_size: 10, unit_price: null }), null);
  });
});

// ── Integration tests against fixture DB ─────────────────────────────

describe('runBackfill — fixture DB', () => {
  it('inserts only missing SKUs (3 new + 2 pre-existing = 5 shamrock rows)', () => {
    const db = freshDb();
    // 5 invoice SKUs (each on a single distinct invoice_no to satisfy any
    // future UNIQUE; we don't enforce it here):
    seedInvoice(db, [
      { invoice_no: 'A', sku: 'SKU-EXISTS-1', item: 'OIL, CANOLA',
        pack_size: 35, pack_unit: 'lb', unit_price: 37.54 },
      { invoice_no: 'B', sku: 'SKU-EXISTS-2', item: 'BUN, BRIOCHE',
        pack_size: 80, pack_unit: 'pk', unit_price: 51.31 },
      { invoice_no: 'C', sku: 'SKU-NEW-1', item: 'CHILE, HATCH MILD',
        pack_size: 25, pack_unit: 'lb', unit_price: 35.4 },
      { invoice_no: 'D', sku: 'SKU-NEW-2', item: 'HONEY, LT AMBER',
        pack_size: 30, pack_unit: 'lb', unit_price: 106.79 },
      { invoice_no: 'E', sku: 'SKU-NEW-3', item: 'CHICKEN, WOG Actual Weight: 51.37lbs',
        pack_size: 48, pack_unit: 'lb', unit_price: 1.87 },
    ]);
    seedVendorPrice(db, {
      ingredient: 'OIL, CANOLA', sku: 'SKU-EXISTS-1',
      pack_size: 35, pack_unit: 'lb', pack_price: 37.54, unit_price: 1.073,
    });
    seedVendorPrice(db, {
      ingredient: 'BUN, BRIOCHE', sku: 'SKU-EXISTS-2',
      pack_size: 80, pack_unit: 'pk', pack_price: 51.31, unit_price: 0.641,
    });

    const result = runBackfill(db, { locationId: 'default' });
    assert.equal(result.candidates, 3);
    assert.equal(result.inserted, 3);
    assert.equal(result.before_count, 2);
    assert.equal(result.after_count, 5, 'total shamrock vendor_prices = 5, not 7');
    assert.equal(result.branch_catch_weight, 1);
    assert.equal(result.branch_per_case, 2);

    // Verify the catch-weight row has correct pricing semantics.
    const cw = db
      .prepare(
        "SELECT * FROM vendor_prices WHERE vendor='shamrock' AND sku='SKU-NEW-3'",
      )
      .get();
    assert.equal(cw.unit_price, 1.87);
    assert.equal(cw.pack_price, 89.76); // 1.87 * 48
    assert.equal(cw.category, 'shamrock_invoice_backfill');
    assert.equal(cw.ingredient, 'CHICKEN, WOG'); // Actual Weight stripped

    // Verify a per-case row.
    const pc = db
      .prepare(
        "SELECT * FROM vendor_prices WHERE vendor='shamrock' AND sku='SKU-NEW-2'",
      )
      .get();
    assert.equal(pc.pack_price, 106.79);
    // unit_price = 106.79 / 30, allow float drift
    assert.ok(Math.abs(pc.unit_price - 106.79 / 30) < 1e-9);
    assert.equal(pc.category, 'shamrock_invoice_backfill');
  });

  it('idempotency: a second run inserts 0 rows', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-A', item: 'AAA', pack_size: 10, pack_unit: 'cs', unit_price: 20 },
      { sku: 'SKU-B', item: 'BBB Actual Weight: 12.5lbs', pack_size: 12,
        pack_unit: 'lb', unit_price: 3 },
    ]);

    const first = runBackfill(db, { locationId: 'default' });
    assert.equal(first.inserted, 2);

    const second = runBackfill(db, { locationId: 'default' });
    assert.equal(second.candidates, 0);
    assert.equal(second.inserted, 0);
    assert.equal(second.before_count, second.after_count);
  });

  it('skip_no_pack_size: rows with NULL pack_size are not inserted', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-OK', item: 'OK', pack_size: 6, pack_unit: 'cs', unit_price: 12 },
      { sku: 'SKU-NULL', item: 'NO PACK', pack_size: null, pack_unit: 'cs',
        unit_price: 7 },
      { sku: 'SKU-ZERO', item: 'ZERO PACK', pack_size: 0, pack_unit: 'cs',
        unit_price: 7 },
    ]);

    const result = runBackfill(db, { locationId: 'default' });
    assert.equal(result.candidates, 3);
    assert.equal(result.inserted, 1);
    assert.equal(result.skipped_no_pack_size, 2);
    assert.deepEqual(result.skipped_skus.sort(), ['SKU-NULL', 'SKU-ZERO']);
  });

  it('dry-run does not write rows or create ingest_runs row', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-DRY', item: 'DRY', pack_size: 6, pack_unit: 'cs',
        unit_price: 12 },
    ]);

    const result = runBackfill(db, { locationId: 'default', dryRun: true });
    assert.equal(result.inserted, 1, 'counter reflects what would be inserted');
    assert.equal(result.before_count, 0);
    assert.equal(result.after_count, 0);
    assert.equal(result.run_id, null);
    const runs = db.prepare('SELECT COUNT(*) c FROM ingest_runs').get().c;
    assert.equal(runs, 0);
  });

  it('latest-row selection: picks newest delivery_date per SKU', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-X', invoice_no: 'OLD', item: 'OLD ITEM',
        delivery_date: '2025-01-01', pack_size: 10, pack_unit: 'cs',
        unit_price: 100 },
      { sku: 'SKU-X', invoice_no: 'NEW', item: 'NEW ITEM',
        delivery_date: '2026-03-01', pack_size: 20, pack_unit: 'cs',
        unit_price: 60 },
    ]);

    const result = runBackfill(db, { locationId: 'default' });
    assert.equal(result.inserted, 1);

    const row = db
      .prepare("SELECT * FROM vendor_prices WHERE sku='SKU-X'")
      .get();
    assert.equal(row.ingredient, 'NEW ITEM');
    assert.equal(row.pack_size, 20);
    assert.equal(row.pack_price, 60); // per-case
    assert.equal(row.unit_price, 3); // 60 / 20
  });

  it('writes an ingest_runs row with kind=backfill-shamrock-invoice-skus', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-Y', item: 'Y', pack_size: 4, pack_unit: 'cs', unit_price: 16 },
    ]);

    const result = runBackfill(db, { locationId: 'default' });
    assert.ok(result.run_id !== null);

    const row = db
      .prepare('SELECT * FROM ingest_runs WHERE id = ?')
      .get(result.run_id);
    assert.equal(row.kind, 'backfill-shamrock-invoice-skus');
    assert.equal(row.status, 'ok');
    assert.equal(row.rows_in, 1);
    assert.equal(row.rows_out, 1);
    assert.ok(row.finished_at);
  });

  it('limit option caps the number of SKUs processed', () => {
    const db = freshDb();
    seedInvoice(db, [
      { sku: 'SKU-1', item: 'A', pack_size: 10, pack_unit: 'cs', unit_price: 20 },
      { sku: 'SKU-2', item: 'B', pack_size: 10, pack_unit: 'cs', unit_price: 20 },
      { sku: 'SKU-3', item: 'C', pack_size: 10, pack_unit: 'cs', unit_price: 20 },
    ]);

    const result = runBackfill(db, { locationId: 'default', limit: 2 });
    assert.equal(result.candidates, 3);
    assert.equal(result.inserted, 2);
    assert.equal(result.after_count, 2);
  });

  it('respects location_id scoping', () => {
    const db = freshDb();
    // Same SKU at two locations; vendor_prices has it at 'other' but not 'default'.
    seedInvoice(db, [
      { sku: 'SKU-LOC', item: 'X', pack_size: 5, pack_unit: 'cs',
        unit_price: 10, location_id: 'default' },
    ]);
    db.prepare(`
      INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size,
                                 pack_unit, pack_price, unit_price, location_id)
      VALUES ('X', 'shamrock', 'SKU-LOC', 5, 'cs', 10, 2, 'other')
    `).run();

    const result = runBackfill(db, { locationId: 'default' });
    assert.equal(result.inserted, 1, 'inserts at default even though SKU exists at other');

    const counts = db
      .prepare("SELECT location_id, COUNT(*) c FROM vendor_prices WHERE sku='SKU-LOC' GROUP BY location_id")
      .all();
    assert.equal(counts.length, 2);
  });
});
