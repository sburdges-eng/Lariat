#!/usr/bin/env node
// Integration tests for scripts/ingest-toast-invoices.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-toast-invoices-ingest.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { ingestToastInvoices, parseArgs } from '../../scripts/ingest-toast-invoices.mjs';

const LOC = 'default';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function payload(over = {}) {
  const headers = over.headers ?? [
    {
      invoice_no: 'INV1000001',
      invoice_date: '2025-01-07',
      invoice_total: 325.0,
      line_count: 5,
      pdf_path: '/archive/INV1000001.pdf',
    },
    {
      invoice_no: 'INV1000002',
      invoice_date: '2025-02-07',
      invoice_total: 225.0,  // 25 + 200 + 50 - 50 credit
      line_count: 4,
      pdf_path: '/archive/INV1000002.pdf',
    },
  ];
  const lines = over.lines ?? [
    { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'API Monthly Subscription', qty: 1, rate: 25.0, amount: 25.0 },
    { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'Gift Card Program Monthly Subscription', qty: 1, rate: 50.0, amount: 50.0 },
    { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'Handheld Monthly Software Subscription', qty: 4, rate: 50.0, amount: 200.0 },
    { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'Kitchen Display Screen Monthly Subscription', qty: 4, rate: 0.0, amount: 0.0 },
    { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'Software Monthly Subscription', qty: 1, rate: 50.0, amount: 50.0 },
    { invoice_no: 'INV1000002', invoice_date: '2025-02-07', item: 'API Monthly Subscription', qty: 1, rate: 25.0, amount: 25.0 },
    { invoice_no: 'INV1000002', invoice_date: '2025-02-07', item: 'Handheld Monthly Software Subscription', qty: 4, rate: 50.0, amount: 200.0 },
    { invoice_no: 'INV1000002', invoice_date: '2025-02-07', item: 'Software Monthly Subscription', qty: 1, rate: 50.0, amount: 50.0 },
    // Credit line — negative qty + amount.
    { invoice_no: 'INV1000002', invoice_date: '2025-02-07', item: 'Handheld Monthly Software Subscription', qty: -1, rate: 50.0, amount: -50.0 },
  ];
  return { headers, lines };
}

describe('ingestToastInvoices', () => {
  it('inserts headers and lines and reconciles to invoice totals', () => {
    const db = makeDb();
    const summary = ingestToastInvoices(db, payload(), LOC);
    assert.equal(summary.headers, 2);
    assert.equal(summary.lines, 9);

    const headerRows = db.prepare(
      `SELECT invoice_no, invoice_date, invoice_total, line_count
         FROM toast_subscription_invoices
        WHERE location_id = ?
        ORDER BY invoice_date`,
    ).all(LOC);
    assert.equal(headerRows.length, 2);
    assert.equal(headerRows[0].invoice_no, 'INV1000001');
    assert.equal(headerRows[0].invoice_total, 325.0);

    // Per-invoice line sums must match the header total (the same
    // reconciliation guarantee the Python parser asserts).
    for (const h of headerRows) {
      const sum = db.prepare(
        `SELECT ROUND(COALESCE(SUM(amount),0),2) AS s
           FROM toast_subscription_invoice_lines
          WHERE location_id = ? AND invoice_no = ?`,
      ).get(LOC, h.invoice_no).s;
      assert.equal(sum, h.invoice_total, `invoice ${h.invoice_no} lines should sum to header total`);
    }
  });

  it('assigns 1-based line_seq within each invoice in input order', () => {
    const db = makeDb();
    ingestToastInvoices(db, payload(), LOC);
    const lines = db.prepare(
      `SELECT invoice_no, line_seq, item
         FROM toast_subscription_invoice_lines
        WHERE location_id = ? AND invoice_no = 'INV1000001'
        ORDER BY line_seq`,
    ).all(LOC);
    assert.deepEqual(
      lines.map((l) => l.line_seq),
      [1, 2, 3, 4, 5],
    );
    assert.equal(lines[0].item, 'API Monthly Subscription');
  });

  it('full-refresh: re-running wipes prior rows for the location', () => {
    const db = makeDb();
    ingestToastInvoices(db, payload(), LOC);

    // Second pass — only the first invoice. Second invoice + its lines
    // must disappear.
    const second = payload({
      headers: [
        {
          invoice_no: 'INV1000001',
          invoice_date: '2025-01-07',
          invoice_total: 325.0,
          line_count: 5,
          pdf_path: '/archive/INV1000001.pdf',
        },
      ],
      lines: [
        { invoice_no: 'INV1000001', invoice_date: '2025-01-07', item: 'API Monthly Subscription', qty: 1, rate: 25.0, amount: 25.0 },
      ],
    });
    ingestToastInvoices(db, second, LOC);

    const headerCount = db.prepare(
      `SELECT COUNT(*) AS c FROM toast_subscription_invoices WHERE location_id = ?`,
    ).get(LOC).c;
    const lineCount = db.prepare(
      `SELECT COUNT(*) AS c FROM toast_subscription_invoice_lines WHERE location_id = ?`,
    ).get(LOC).c;
    assert.equal(headerCount, 1);
    assert.equal(lineCount, 1);
  });

  it('isolates locations: a re-run for one does not touch the other', () => {
    const db = makeDb();
    ingestToastInvoices(db, payload(), 'main');
    ingestToastInvoices(db, payload(), 'satellite');

    // Wipe just 'main'.
    ingestToastInvoices(db, { headers: [], lines: [] }, 'main');

    assert.equal(
      db.prepare(`SELECT COUNT(*) AS c FROM toast_subscription_invoices WHERE location_id = 'main'`).get().c,
      0,
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS c FROM toast_subscription_invoices WHERE location_id = 'satellite'`).get().c,
      2,
    );
  });

  it('records an ingest_runs row with status=ok and rows_out', () => {
    const db = makeDb();
    const data = payload();
    ingestToastInvoices(db, data, LOC);
    const run = db.prepare(
      `SELECT kind, status, rows_in, rows_out
         FROM ingest_runs
        WHERE kind = 'toast_invoices'
        ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.equal(run.kind, 'toast_invoices');
    assert.equal(run.status, 'ok');
    assert.equal(run.rows_in, data.headers.length + data.lines.length);
    assert.equal(run.rows_out, data.headers.length + data.lines.length);
  });

  it('handles credit lines (negative qty + amount)', () => {
    const db = makeDb();
    ingestToastInvoices(db, payload(), LOC);
    const credit = db.prepare(
      `SELECT qty, amount
         FROM toast_subscription_invoice_lines
        WHERE location_id = ? AND invoice_no = 'INV1000002' AND amount < 0`,
    ).get(LOC);
    assert.ok(credit, 'expected at least one credit line');
    assert.equal(credit.qty, -1);
    assert.equal(credit.amount, -50.0);
  });

  it('marks the run failed on bad data and propagates the error', () => {
    const db = makeDb();
    const bad = payload({
      // Missing required NOT NULL invoice_date in the header.
      headers: [{ invoice_no: 'INVBAD', invoice_total: 1, line_count: 0 }],
      lines: [],
    });
    assert.throws(() => ingestToastInvoices(db, bad, LOC));
    const run = db.prepare(
      `SELECT status FROM ingest_runs WHERE kind = 'toast_invoices' ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.equal(run.status, 'failed');
  });
});

describe('parseArgs', () => {
  it('accepts both --dir path and --dir=path forms documented for operators', () => {
    assert.deepEqual(
      parseArgs(['node', 'script', '--dir', 'data/imports/toast-pdfs']),
      { location: 'default', skipPython: false, dir: 'data/imports/toast-pdfs' },
    );
    assert.deepEqual(
      parseArgs(['node', 'script', '--dir=data/imports/toast-pdfs']),
      { location: 'default', skipPython: false, dir: 'data/imports/toast-pdfs' },
    );
  });

  it('accepts both --location main and --location=main for symmetry with --dir', () => {
    assert.deepEqual(
      parseArgs(['node', 'script', '--location', 'main', '--skip-python']),
      { location: 'main', skipPython: true, dir: null },
    );
    assert.deepEqual(
      parseArgs(['node', 'script', '--location=main', '--skip-python']),
      { location: 'main', skipPython: true, dir: null },
    );
  });
});
