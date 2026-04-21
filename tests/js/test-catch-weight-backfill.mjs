#!/usr/bin/env node
// T5b.3 acceptance — backfillCatchWeightsIntoVendorPrices joins the latest
// per-SKU catch-weight from shamrock_invoices into vendor_prices. Runs
// inside ingestCosting so the costing DELETE+INSERT sweep doesn't wipe
// the audit trail.
//
// Run: node --experimental-strip-types --test tests/js/test-catch-weight-backfill.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { backfillCatchWeightsIntoVendorPrices } from '../../scripts/ingest-costing.mjs';

const LOC = 'default';

function buildDb({ vendorPrices = [], shamrockInvoices = [] } = {}) {
  const db = new Database(':memory:');
  initSchema(db);

  // Mirror the shamrock_invoices schema from scripts/ingest_shamrock_invoices.py
  // (including the T5b columns).
  db.exec(`
    CREATE TABLE IF NOT EXISTS shamrock_invoices (
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
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(invoice_no, sku, item, location_id)
    );
  `);

  const insVp = db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
     VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @pack_price, @unit_price, @location_id)`,
  );
  for (const vp of vendorPrices) {
    insVp.run({ ingredient: vp.ingredient, vendor: vp.vendor, sku: vp.sku,
      pack_size: vp.pack_size ?? null, pack_unit: vp.pack_unit ?? null,
      pack_price: vp.pack_price ?? null, unit_price: vp.unit_price ?? null,
      location_id: LOC });
  }

  const insSi = db.prepare(
    `INSERT INTO shamrock_invoices
       (invoice_no, delivery_date, item, sku, qty, line_total, actual_received_lb, reconciled_unit_price, location_id)
     VALUES (@invoice_no, @delivery_date, @item, @sku, @qty, @line_total, @actual_received_lb, @reconciled_unit_price, @location_id)`,
  );
  for (const si of shamrockInvoices) {
    insSi.run({ invoice_no: si.invoice_no, delivery_date: si.delivery_date,
      item: si.item, sku: si.sku, qty: si.qty ?? null, line_total: si.line_total ?? null,
      actual_received_lb: si.actual_received_lb ?? null,
      reconciled_unit_price: si.reconciled_unit_price ?? null,
      location_id: LOC });
  }
  return db;
}

const readVp = (db, sku) =>
  db.prepare(
    `SELECT actual_received_lb, reconciled_unit_price FROM vendor_prices
      WHERE vendor='shamrock' AND sku=? AND location_id=?`,
  ).get(sku, LOC);

describe('T5b.3 — vendor_prices backfill from shamrock_invoices', () => {
  it('copies actual_received_lb + reconciled_unit_price from latest invoice per sku', () => {
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'BEEF, CHEEK MEAT', vendor: 'shamrock', sku: '3091571',
          pack_size: 1, pack_unit: 'cs', pack_price: 150.0 },
      ],
      shamrockInvoices: [
        // Older invoice with catch-weight.
        { invoice_no: 'A', delivery_date: '2026-01-15', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 29.2, reconciled_unit_price: 5.136 },
        // Newer invoice — should win.
        { invoice_no: 'B', delivery_date: '2026-03-28', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 30.0, reconciled_unit_price: 5.0 },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 1);
    const vp = readVp(db, '3091571');
    assert.strictEqual(vp.actual_received_lb, 30.0);
    assert.strictEqual(vp.reconciled_unit_price, 5.0);
    db.close();
  });

  it('leaves vendor_prices rows untouched when no invoice matches', () => {
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'LETTUCE', vendor: 'shamrock', sku: '5555555',
          pack_size: 24, pack_unit: 'ct', pack_price: 30.0 },
      ],
      shamrockInvoices: [
        { invoice_no: 'A', delivery_date: '2026-03-01', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 30.0, reconciled_unit_price: 5.0 },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 0);
    const vp = readVp(db, '5555555');
    assert.strictEqual(vp.actual_received_lb, null);
    assert.strictEqual(vp.reconciled_unit_price, null);
    db.close();
  });

  it('skips rows whose invoice row has NULL actual_received_lb', () => {
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'X', vendor: 'shamrock', sku: '1111',
          pack_size: 1, pack_unit: 'cs', pack_price: 10.0 },
      ],
      shamrockInvoices: [
        { invoice_no: 'A', delivery_date: '2026-03-01', item: 'Non-catch-weight',
          sku: '1111', qty: 1, line_total: 10.0,
          actual_received_lb: null, reconciled_unit_price: null },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 0);
    db.close();
  });

  it('is a no-op when shamrock_invoices table does not exist', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 0);
    db.close();
  });

  it('updates all vendor_prices rows sharing the same sku', () => {
    // Two vendor_prices rows for the same sku (different ingredient labels).
    // The backfill should touch both — the reconciliation is keyed on SKU,
    // not on ingredient name.
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'BEEF CHEEK', vendor: 'shamrock', sku: '3091571',
          pack_size: 1, pack_unit: 'cs', pack_price: 150.0 },
        { ingredient: 'Beef Cheek Meat Refrig', vendor: 'shamrock', sku: '3091571',
          pack_size: 1, pack_unit: 'cs', pack_price: 150.0 },
      ],
      shamrockInvoices: [
        { invoice_no: 'A', delivery_date: '2026-03-28', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 30.0, reconciled_unit_price: 5.0 },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 2);
    db.close();
  });
});

import { ingestCosting } from '../../scripts/ingest-costing.mjs';

describe('T5b.3 — catch_weight_backfilled_rows flows through ingestCosting summary', () => {
  it('ingestCosting.summary surfaces the backfill counter', () => {
    // Build a payload that exercises ingestCosting end-to-end. The shamrock
    // invoice row matches one vendor_prices sku, so the backfill updates
    // one row and the summary must surface it.
    const db = new Database(':memory:');
    initSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS shamrock_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL, delivery_date TEXT, ordered_date TEXT,
        item TEXT NOT NULL, sku TEXT, qty REAL, pack_size REAL, pack_unit TEXT,
        unit_price REAL, line_total REAL,
        actual_received_lb REAL, reconciled_unit_price REAL,
        source_file TEXT, location_id TEXT DEFAULT 'default',
        imported_at TEXT DEFAULT (datetime('now')),
        UNIQUE(invoice_no, sku, item, location_id)
      );
      INSERT INTO shamrock_invoices
        (invoice_no, delivery_date, item, sku, qty, line_total,
         actual_received_lb, reconciled_unit_price, location_id)
      VALUES
        ('INV1', '2026-03-28', 'Beef Cheek', '3091571', 1, 150.0, 30.0, 5.0, 'default');
    `);
    const data = {
      vendor_prices: [{ ingredient: 'beef cheek', vendor: 'shamrock', sku: '3091571',
        pack_size: 1, pack_unit: 'cs', pack_price: 150.0, unit_price: 150.0 }],
      recipe_costs: [],
      bom_lines: [],
      ingredient_maps: [],
      order_guide: [],
    };
    const summary = ingestCosting(db, data, LOC);
    assert.strictEqual(summary.catch_weight_backfilled_rows, 1);
    const vp = db.prepare(
      `SELECT actual_received_lb, reconciled_unit_price FROM vendor_prices
        WHERE sku='3091571' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vp.actual_received_lb, 30.0);
    assert.strictEqual(vp.reconciled_unit_price, 5.0);
    db.close();
  });
});

describe('T5b.3 follow-up — sysco_invoices is scanned alongside shamrock_invoices', () => {
  function buildDbWithSysco({ vendorPrices = [], syscoInvoices = [] } = {}) {
    const db = new Database(':memory:');
    initSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sysco_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL,
        delivery_date TEXT, description TEXT NOT NULL,
        sku TEXT, qty INTEGER, category TEXT,
        unit_price REAL, line_total REAL,
        actual_received_lb REAL, reconciled_unit_price REAL,
        source_file TEXT, location_id TEXT DEFAULT 'default',
        imported_at TEXT DEFAULT (datetime('now')),
        UNIQUE(invoice_no, description, location_id)
      );
    `);
    const insVp = db.prepare(
      `INSERT INTO vendor_prices
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, location_id)
       VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @pack_price, @location_id)`,
    );
    for (const vp of vendorPrices) {
      insVp.run({ ingredient: vp.ingredient, vendor: vp.vendor, sku: vp.sku,
        pack_size: vp.pack_size ?? null, pack_unit: vp.pack_unit ?? null,
        pack_price: vp.pack_price ?? null, location_id: LOC });
    }
    const insSi = db.prepare(
      `INSERT INTO sysco_invoices
         (invoice_no, delivery_date, description, sku, qty, line_total,
          actual_received_lb, reconciled_unit_price, location_id)
       VALUES (@invoice_no, @delivery_date, @description, @sku, @qty, @line_total,
               @actual_received_lb, @reconciled_unit_price, @location_id)`,
    );
    for (const si of syscoInvoices) {
      insSi.run({ invoice_no: si.invoice_no, delivery_date: si.delivery_date,
        description: si.description ?? 'x', sku: si.sku, qty: si.qty ?? null,
        line_total: si.line_total ?? null,
        actual_received_lb: si.actual_received_lb ?? null,
        reconciled_unit_price: si.reconciled_unit_price ?? null,
        location_id: LOC });
    }
    return db;
  }

  it('sysco invoices backfill to vendor_prices with vendor=sysco', () => {
    const db = buildDbWithSysco({
      vendorPrices: [
        { ingredient: 'Pork Chop', vendor: 'sysco', sku: '4874526',
          pack_size: 1, pack_unit: 'cs', pack_price: 318.25 },
      ],
      syscoInvoices: [
        { invoice_no: '759616979', delivery_date: '2026-03-12',
          description: 'Pork Chop B/I Frchd Lngbn Fr', sku: '4874526',
          qty: 2, line_total: 318.25, actual_received_lb: 17.4,
          reconciled_unit_price: 18.29 },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 1);
    assert.strictEqual(res.by_vendor.sysco, 1);
    const vp = db.prepare(
      `SELECT actual_received_lb, reconciled_unit_price FROM vendor_prices
        WHERE vendor='sysco' AND sku='4874526' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vp.actual_received_lb, 17.4);
    assert.strictEqual(vp.reconciled_unit_price, 18.29);
    db.close();
  });

  it('both shamrock + sysco invoices backfill in the same call', () => {
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'Beef Cheek', vendor: 'shamrock', sku: '3091571',
          pack_size: 1, pack_unit: 'cs', pack_price: 150.0 },
      ],
      shamrockInvoices: [
        { invoice_no: 'S1', delivery_date: '2026-03-28', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 30.0, reconciled_unit_price: 5.0 },
      ],
    });
    // Add sysco_invoices table + a vendor_prices row + a sysco row too.
    db.exec(`
      CREATE TABLE IF NOT EXISTS sysco_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL, delivery_date TEXT, description TEXT NOT NULL,
        sku TEXT, qty INTEGER, category TEXT, unit_price REAL, line_total REAL,
        actual_received_lb REAL, reconciled_unit_price REAL,
        source_file TEXT, location_id TEXT DEFAULT 'default',
        imported_at TEXT DEFAULT (datetime('now')),
        UNIQUE(invoice_no, description, location_id)
      );
    `);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, location_id)
       VALUES ('Pork Chop', 'sysco', '4874526', 1, 'cs', 318.25, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO sysco_invoices (invoice_no, delivery_date, description, sku, qty, line_total,
                                    actual_received_lb, reconciled_unit_price, location_id)
       VALUES ('759616979', '2026-03-12', 'Pork Chop', '4874526', 2, 318.25, 17.4, 18.29, ?)`,
    ).run(LOC);

    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 2);
    assert.strictEqual(res.by_vendor.shamrock, 1);
    assert.strictEqual(res.by_vendor.sysco, 1);
    db.close();
  });

  it('missing sysco_invoices table is a no-op for the sysco path (shamrock still runs)', () => {
    const db = buildDb({
      vendorPrices: [
        { ingredient: 'Beef Cheek', vendor: 'shamrock', sku: '3091571',
          pack_size: 1, pack_unit: 'cs', pack_price: 150.0 },
      ],
      shamrockInvoices: [
        { invoice_no: 'S1', delivery_date: '2026-03-28', item: 'Beef Cheek',
          sku: '3091571', qty: 1, line_total: 150.0,
          actual_received_lb: 30.0, reconciled_unit_price: 5.0 },
      ],
    });
    const res = backfillCatchWeightsIntoVendorPrices(db, LOC);
    assert.strictEqual(res.updated, 1);
    assert.strictEqual(res.by_vendor.shamrock, 1);
    assert.ok(!('sysco' in res.by_vendor), 'sysco key should be absent when table missing');
    db.close();
  });
});
