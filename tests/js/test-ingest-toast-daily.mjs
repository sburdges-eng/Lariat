#!/usr/bin/env node
// Tests for scripts/ingest-toast-daily.mjs — Phase 1 Component 2 (GH #267;
// spec 2026-04-11-food-cost-prep-forecasting-design §"Component 2 — Manual
// daily Toast CSV ingest"). Run:
//   node --experimental-strip-types --test tests/js/test-ingest-toast-daily.mjs
//
// Exercises the importable core (no CLI / filesystem side effects beyond an
// in-memory DB): filename→date parsing, lenient CSV header mapping with
// numeric coercion, and the idempotent day-level insert into sales_lines.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getDb, setDbPathForTest } from '../../lib/db.ts';
import {
  parseToastDailyCsv,
  dateFromFilename,
  ingestToastDaily,
} from '../../scripts/ingest-toast-daily.mjs';

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

describe('dateFromFilename', () => {
  it('parses YYYY-MM-DD from a CSV filename (incl. full paths)', () => {
    assert.strictEqual(dateFromFilename('2026-04-01.csv'), '2026-04-01');
    assert.strictEqual(dateFromFilename('/x/y/2026-12-31.csv'), '2026-12-31');
  });
  it('returns null for an unparseable or out-of-range name', () => {
    assert.strictEqual(dateFromFilename('garbage.csv'), null);
    assert.strictEqual(dateFromFilename('2026-13-40.csv'), null);
  });
});

describe('parseToastDailyCsv — lenient header mapping', () => {
  it('maps alternate header names and coerces non-numeric/blank to 0', () => {
    const csv = ['Menu Item,Qty,Net $', 'Cheeseburger,12,"$144.00"', 'Fries,abc,'].join('\n');
    const { rows } = parseToastDailyCsv(csv);
    assert.deepStrictEqual(rows, [
      { item_name: 'Cheeseburger', quantity_sold: 12, net_sales: 144 },
      { item_name: 'Fries', quantity_sold: 0, net_sales: 0 },
    ]);
  });
  it('flags missing required field when no item column is present', () => {
    const { rows, missingFields } = parseToastDailyCsv('Foo,Bar\n1,2');
    assert.deepStrictEqual(rows, []);
    assert.ok(missingFields.includes('item name'), 'should report missing item name');
  });
});

describe('ingestToastDaily — day-level rows + idempotency', () => {
  const rows = [
    { item_name: 'Cheeseburger', quantity_sold: 12, net_sales: 144 },
    { item_name: 'Fries', quantity_sold: 30, net_sales: 90 },
  ];

  it('inserts day-level rows tagged service_period=day with the right metadata', () => {
    const res = ingestToastDaily(db, { date: '2026-04-01', rows });
    assert.strictEqual(res.inserted, 2);
    assert.strictEqual(res.uniqueItems, 2);
    const got = db
      .prepare(
        `SELECT item_name, quantity_sold, net_sales, source, period_label, service_date, service_period
           FROM sales_lines WHERE service_date='2026-04-01' ORDER BY item_name`,
      )
      .all();
    assert.strictEqual(got.length, 2);
    assert.deepStrictEqual(got[0], {
      item_name: 'Cheeseburger',
      quantity_sold: 12,
      net_sales: 144,
      source: 'toast_daily_csv',
      period_label: 'Toast daily 2026-04-01',
      service_date: '2026-04-01',
      service_period: 'day',
    });
  });

  it('is idempotent — re-ingesting the same date replaces rather than duplicates', () => {
    ingestToastDaily(db, { date: '2026-04-01', rows });
    ingestToastDaily(db, { date: '2026-04-01', rows });
    const { c } = db
      .prepare("SELECT COUNT(*) c FROM sales_lines WHERE service_date='2026-04-01'")
      .get();
    assert.strictEqual(c, 2);
  });
});
