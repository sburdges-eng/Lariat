#!/usr/bin/env node
// Tests for the multi-vendor actual-COGS rollup in
// lib/computeEngine/accountingVariance.ts.
//
// The audit (§7) found that actual_cogs summed only spend_monthly.shamrock_total_spend,
// silently excluding Sysco invoice data. This test exercises:
//   - Shamrock invoice data preferred over the spend_monthly fallback
//   - spend_monthly used when shamrock_invoices contributes 0 across the window
//   - Sysco invoices added when the table exists
//   - sysco_invoices missing → graceful 0 contribution (no crash)
//   - Window filtering by month
//   - Per-vendor breakdown persisted as JSON on accounting_variance
//
// Run: node --experimental-strip-types --test tests/js/test-multi-vendor-cogs.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { computeActualCogsBreakdown, computeAccountingVariance } = await import(
  '../../lib/computeEngine/accountingVariance.ts'
);

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

// shamrock_invoices is created by Python ingest, not initSchema. Tests
// that need it must seed the table themselves.
function ensureShamrockInvoices(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shamrock_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      delivery_date TEXT,
      item TEXT NOT NULL,
      sku TEXT,
      qty REAL,
      pack_size REAL,
      pack_unit TEXT,
      unit_price REAL,
      line_total REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(invoice_no, sku, item, location_id)
    )
  `);
}

function ensureSyscoInvoices(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sysco_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      delivery_date TEXT,
      description TEXT NOT NULL,
      sku TEXT,
      qty INTEGER,
      category TEXT,
      unit_price REAL,
      line_total REAL,
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(invoice_no, description, location_id)
    )
  `);
}

function dropInvoiceTables(db) {
  db.exec(`
    DROP TABLE IF EXISTS shamrock_invoices;
    DROP TABLE IF EXISTS sysco_invoices;
  `);
}

beforeEach(() => {
  db.exec(`
    DELETE FROM accounting_variance;
    DELETE FROM spend_monthly;
    DELETE FROM sales_lines;
    DELETE FROM recipe_costs;
  `);
  dropInvoiceTables(db);
});

// ── computeActualCogsBreakdown ──────────────────────────────────────

describe('computeActualCogsBreakdown', () => {
  it('returns 0 with empty per_vendor when no source tables have data', () => {
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.per_vendor, []);
  });

  it('sums shamrock_invoices.line_total within the month window', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('INV-1', '2026-03-05', 'tomato', 100.00, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('INV-2', '2026-03-19', 'lettuce', 250.00, 'default')`,
    ).run();
    // Out of window — should NOT count.
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('INV-OUT', '2026-02-15', 'oil', 999.00, 'default')`,
    ).run();

    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 350);
    assert.deepStrictEqual(r.per_vendor, [
      // basis 'estimated': shamrock_invoices holds order-confirmation exports.
      { vendor: 'shamrock', source: 'shamrock_invoices', amount: 350, basis: 'estimated' },
    ]);
  });

  it('falls back to spend_monthly only when shamrock_invoices is empty for the window', () => {
    ensureShamrockInvoices(db); // table exists but empty
    db.prepare(
      `INSERT INTO spend_monthly (month, shamrock_total_spend, source, location_id)
       VALUES ('2026-03', 1234.56, 'analytics_workbook', 'default')`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 1234.56);
    assert.deepStrictEqual(r.per_vendor, [
      { vendor: 'shamrock', source: 'spend_monthly', amount: 1234.56, basis: 'estimated' },
    ]);
  });

  it('does NOT double-count when both shamrock_invoices and spend_monthly have data', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('INV-1', '2026-03-05', 'X', 500, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO spend_monthly (month, shamrock_total_spend, source, location_id)
       VALUES ('2026-03', 9999, 'analytics_workbook', 'default')`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    // Invoice path wins; spend_monthly is silently ignored.
    assert.strictEqual(r.total, 500);
    assert.strictEqual(r.per_vendor.length, 1);
    assert.strictEqual(r.per_vendor[0].source, 'shamrock_invoices');
  });

  it('adds sysco when its table exists', () => {
    ensureShamrockInvoices(db);
    ensureSyscoInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('S-1', '2026-03-05', 'X', 100, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO sysco_invoices (invoice_no, delivery_date, description, line_total, location_id)
       VALUES ('Y-1', '2026-03-12', 'Y', 75, 'default')`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 175);
    const sources = r.per_vendor.map((v) => v.vendor).sort();
    assert.deepStrictEqual(sources, ['shamrock', 'sysco']);
  });

  it('tolerates a missing sysco_invoices table — returns shamrock-only', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('S-1', '2026-03-05', 'X', 100, 'default')`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 100);
    assert.strictEqual(r.per_vendor.length, 1);
    assert.strictEqual(r.per_vendor[0].vendor, 'shamrock');
  });

  it('window filtering: includes the start month, excludes after end month', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('A', '2026-01-15', 'X', 10, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('B', '2026-02-15', 'X', 20, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('C', '2026-03-15', 'X', 30, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('D', '2026-04-15', 'X', 40, 'default')`,
    ).run();
    // Window = Feb–Mar inclusive.
    const r = computeActualCogsBreakdown(db, 'default', '2026-02', '2026-03');
    assert.strictEqual(r.total, 50); // 20 + 30
  });

  it('respects location_id scoping', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('A', '2026-03-05', 'X', 100, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('B', '2026-03-05', 'X', 999, 'site-b')`,
    ).run();
    const rDefault = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    const rSiteB = computeActualCogsBreakdown(db, 'site-b', '2026-03', '2026-03');
    assert.strictEqual(rDefault.total, 100);
    assert.strictEqual(rSiteB.total, 999);
  });

  it('ignores rows with NULL delivery_date', () => {
    ensureShamrockInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('A', NULL, 'X', 555, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('B', '2026-03-05', 'X', 100, 'default')`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-03');
    assert.strictEqual(r.total, 100);
  });
});

// ── computeAccountingVariance — persistence + breakdown JSON ────────

// ── doc_type: order confirmations vs invoices ───────────────────────
//
// sysco_invoices gained a doc_type column when ingest_sysco_order_emails.py
// started writing to it. Sysco splits one submission into several orders billed
// on separate invoices, so the same delivery can reach this table twice — once
// under an order number (04xxxxxx) and later under an invoice number
// (759xxxxxx). Those namespaces never collide, so the rows cannot be matched;
// the roll-up counts one document type per vendor-month instead.
//
// Precedence is invoice over order confirmation: an invoice is what we were
// billed, a confirmation is what we asked for.

function ensureSyscoInvoicesWithDocType(db) {
  ensureSyscoInvoices(db);
  db.exec(`ALTER TABLE sysco_invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'invoice'`);
}

const addSyscoRow = (db, invoiceNo, date, desc, total, docType) =>
  db.prepare(
    `INSERT INTO sysco_invoices (invoice_no, delivery_date, description, line_total, doc_type)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(invoiceNo, date, desc, total, docType);

describe('computeActualCogsBreakdown — doc_type precedence', () => {
  it('counts order confirmations when no invoice covers the month', () => {
    ensureSyscoInvoicesWithDocType(db);
    addSyscoRow(db, '04488128', '2026-04-09', 'Yuzu Kosho', 59.84, 'order_confirmation');
    const r = computeActualCogsBreakdown(db, 'default', '2026-04', '2026-04');
    assert.strictEqual(r.total, 59.84);
  });

  it('does NOT sum invoices and order confirmations in the same month', () => {
    ensureSyscoInvoicesWithDocType(db);
    addSyscoRow(db, '759616979', '2026-04-09', 'Billed Line', 100.0, 'invoice');
    addSyscoRow(db, '04488128', '2026-04-09', 'Ordered Line', 59.84, 'order_confirmation');
    const r = computeActualCogsBreakdown(db, 'default', '2026-04', '2026-04');
    assert.strictEqual(
      r.total, 100.0,
      'invoice must win outright; summing both double-counts one delivery',
    );
  });

  it('resolves precedence per month, not across the whole window', () => {
    ensureSyscoInvoicesWithDocType(db);
    // March billed; April only confirmed. Both months should count, each on
    // its own best available basis.
    addSyscoRow(db, '759616979', '2026-03-09', 'March Billed', 100.0, 'invoice');
    addSyscoRow(db, '04488128', '2026-04-09', 'April Ordered', 59.84, 'order_confirmation');
    const r = computeActualCogsBreakdown(db, 'default', '2026-03', '2026-04');
    assert.strictEqual(r.total, 159.84);
  });

  it('labels the basis so an estimated month is never mistaken for billed', () => {
    ensureSyscoInvoicesWithDocType(db);
    addSyscoRow(db, '04488128', '2026-04-09', 'Yuzu Kosho', 59.84, 'order_confirmation');
    const r = computeActualCogsBreakdown(db, 'default', '2026-04', '2026-04');
    const sysco = r.per_vendor.find((l) => l.vendor === 'sysco');
    assert.strictEqual(sysco.basis, 'estimated');
  });

  it('labels an invoice-backed month as billed', () => {
    ensureSyscoInvoicesWithDocType(db);
    addSyscoRow(db, '759616979', '2026-04-09', 'Billed Line', 100.0, 'invoice');
    const r = computeActualCogsBreakdown(db, 'default', '2026-04', '2026-04');
    assert.strictEqual(r.per_vendor.find((l) => l.vendor === 'sysco').basis, 'invoice');
  });

  it('tolerates a pre-migration table with no doc_type column', () => {
    ensureSyscoInvoices(db); // no doc_type
    db.prepare(
      `INSERT INTO sysco_invoices (invoice_no, delivery_date, description, line_total)
       VALUES ('759616979', '2026-04-09', 'Legacy Row', 77.0)`,
    ).run();
    const r = computeActualCogsBreakdown(db, 'default', '2026-04', '2026-04');
    assert.strictEqual(r.total, 77.0, 'legacy rows are invoices and must still count');
  });
});

describe('computeAccountingVariance', () => {
  it('writes the per-vendor breakdown as JSON on the accounting_variance row', () => {
    ensureShamrockInvoices(db);
    ensureSyscoInvoices(db);
    db.prepare(
      `INSERT INTO shamrock_invoices (invoice_no, delivery_date, item, line_total, location_id)
       VALUES ('S-1', '2026-03-05', 'X', 200, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO sysco_invoices (invoice_no, delivery_date, description, line_total, location_id)
       VALUES ('Y-1', '2026-03-12', 'Y', 150, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('p', 'Burger', 10, 100, 'toast_import', 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, location_id)
       VALUES ('burger', 'Burger', 5, 'default')`,
    ).run();

    computeAccountingVariance(db, 'default', {
      period_start: '2026-03-01',
      period_end: '2026-03-31',
    });

    const row = db.prepare(
      `SELECT theoretical_cogs, actual_cogs, variance_amount, variance_pct,
              actual_cogs_breakdown_json
         FROM accounting_variance ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.strictEqual(row.theoretical_cogs, 50); // 10 × 5
    assert.strictEqual(row.actual_cogs, 350); // 200 + 150
    assert.strictEqual(row.variance_amount, 300); // 350 - 50
    // 300 / 50 * 100 = 600
    assert.strictEqual(row.variance_pct, 600);

    const breakdown = JSON.parse(row.actual_cogs_breakdown_json);
    assert.strictEqual(breakdown.length, 2);
    const byVendor = Object.fromEntries(breakdown.map((b) => [b.vendor, b]));
    assert.strictEqual(byVendor.shamrock.source, 'shamrock_invoices');
    assert.strictEqual(byVendor.shamrock.amount, 200);
    assert.strictEqual(byVendor.sysco.source, 'sysco_invoices');
    assert.strictEqual(byVendor.sysco.amount, 150);
  });

  it('writes an empty breakdown array (not NULL) when no vendor has data', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('p', 'X', 1, 1, 'toast_import', 'default')`,
    ).run();
    computeAccountingVariance(db, 'default', {
      period_start: '2026-03-01',
      period_end: '2026-03-31',
    });
    const row = db.prepare(
      `SELECT actual_cogs, actual_cogs_breakdown_json
         FROM accounting_variance ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.strictEqual(row.actual_cogs, 0);
    assert.deepStrictEqual(JSON.parse(row.actual_cogs_breakdown_json), []);
  });
});
