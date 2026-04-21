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
