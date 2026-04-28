#!/usr/bin/env node
// Tests for the empty-parser guard in scripts/ingest-analytics.mjs.
//
// Background: pointing LARIAT_UNIFIED at a stripped working-copy workbook
// (no "Toast - Item Sales*" sheet) used to silently wipe sales_lines via
// DELETE-then-INSERT-zero. The fix guards each DELETE on (data.length > 0
// OR forceEmpty), and main() exits non-zero before reaching the writer
// when the parser returned no Toast sheet at all.
//
// Run: node --experimental-strip-types --test tests/js/test-analytics-empty-guard.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { applyAnalyticsData } = await import('../../scripts/ingest-analytics.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM sales_lines;
    DELETE FROM spend_monthly;
  `);
});

function seedPriorRows() {
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
     VALUES ('prior-period', 'Burger', 10, 100.0, 'toast_import', 'default')`,
  ).run();
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
     VALUES ('prior-period', 'Salad', 4, 40.0, 'toast_import', 'default')`,
  ).run();
  db.prepare(
    `INSERT INTO spend_monthly (month, shamrock_total_spend, source, location_id)
     VALUES ('2026-03', 12345.67, 'analytics_workbook', 'default')`,
  ).run();
}

describe('applyAnalyticsData — empty-parser guard', () => {
  it('does NOT wipe sales_lines when the parser returned zero rows', () => {
    seedPriorRows();
    const stats = applyAnalyticsData(
      db,
      { sales_lines: [], spend_monthly: [], toast_sheet: null },
      { location_id: 'default', period: 'whatever', forceEmpty: false },
    );
    assert.strictEqual(stats.sales_skipped_empty, true);
    assert.strictEqual(stats.spend_skipped_empty, true);
    assert.strictEqual(stats.sales_written, 0);
    assert.strictEqual(stats.spend_written, 0);

    // Prior rows must survive.
    const sales = db.prepare(`SELECT COUNT(*) as c FROM sales_lines`).get().c;
    const spend = db.prepare(`SELECT COUNT(*) as c FROM spend_monthly`).get().c;
    assert.strictEqual(sales, 2);
    assert.strictEqual(spend, 1);
  });

  it('DOES wipe sales_lines when forceEmpty=true even with empty parser', () => {
    seedPriorRows();
    const stats = applyAnalyticsData(
      db,
      { sales_lines: [], spend_monthly: [], toast_sheet: null },
      { location_id: 'default', period: 'whatever', forceEmpty: true },
    );
    assert.strictEqual(stats.sales_skipped_empty, false);
    assert.strictEqual(stats.spend_skipped_empty, false);

    const sales = db.prepare(`SELECT COUNT(*) as c FROM sales_lines`).get().c;
    const spend = db.prepare(`SELECT COUNT(*) as c FROM spend_monthly`).get().c;
    assert.strictEqual(sales, 0);
    assert.strictEqual(spend, 0);
  });

  it('refreshes sales_lines normally when parser returned data', () => {
    seedPriorRows();
    const stats = applyAnalyticsData(
      db,
      {
        sales_lines: [
          { item_name: 'New Burger', quantity_sold: 5, net_sales: 50 },
          { item_name: 'Coors', quantity_sold: 12, net_sales: 60 },
        ],
        spend_monthly: [],
        toast_sheet: 'Toast - Item Sales (Mar 2026)',
      },
      { location_id: 'default', period: 'fresh-period', forceEmpty: false },
    );
    assert.strictEqual(stats.sales_written, 2);
    assert.strictEqual(stats.sales_skipped_empty, false);
    // spend_monthly was empty AND forceEmpty is false → should be skipped.
    assert.strictEqual(stats.spend_skipped_empty, true);

    const sales = db.prepare(
      `SELECT period_label, item_name FROM sales_lines ORDER BY item_name`,
    ).all();
    assert.deepStrictEqual(sales, [
      { period_label: 'fresh-period', item_name: 'Coors' },
      { period_label: 'fresh-period', item_name: 'New Burger' },
    ]);
    // Prior spend_monthly preserved (skipped because empty parser output).
    const spend = db.prepare(`SELECT COUNT(*) as c FROM spend_monthly`).get().c;
    assert.strictEqual(spend, 1);
  });

  it('refreshes both tables when both have data', () => {
    seedPriorRows();
    const stats = applyAnalyticsData(
      db,
      {
        sales_lines: [{ item_name: 'X', quantity_sold: 1, net_sales: 1 }],
        spend_monthly: [{ month: '2026-04', shamrock_total_spend: 999 }],
        toast_sheet: 'Toast - Item Sales (Apr 2026)',
      },
      { location_id: 'default', period: 'apr', forceEmpty: false },
    );
    assert.strictEqual(stats.sales_written, 1);
    assert.strictEqual(stats.spend_written, 1);
    assert.strictEqual(stats.sales_skipped_empty, false);
    assert.strictEqual(stats.spend_skipped_empty, false);

    const sales = db.prepare(`SELECT COUNT(*) as c FROM sales_lines`).get().c;
    const spend = db.prepare(`SELECT month, shamrock_total_spend FROM spend_monthly`).all();
    assert.strictEqual(sales, 1);
    assert.deepStrictEqual(spend, [{ month: '2026-04', shamrock_total_spend: 999 }]);
  });

  it('per-table guard: sales has data, spend is empty — only sales refreshes', () => {
    seedPriorRows();
    const stats = applyAnalyticsData(
      db,
      {
        sales_lines: [{ item_name: 'X', quantity_sold: 1, net_sales: 1 }],
        spend_monthly: [],
        toast_sheet: 'Toast - Item Sales (Apr 2026)',
      },
      { location_id: 'default', period: 'apr', forceEmpty: false },
    );
    assert.strictEqual(stats.sales_skipped_empty, false);
    assert.strictEqual(stats.spend_skipped_empty, true);
    // Prior spend row preserved.
    const spend = db.prepare(`SELECT month FROM spend_monthly`).all();
    assert.deepStrictEqual(spend, [{ month: '2026-03' }]);
  });

  it('handles missing arrays gracefully (parser returned partial JSON)', () => {
    seedPriorRows();
    // Defensive: parser shouldn't omit these keys, but if it does, the
    // helper should treat them as empty rather than crashing.
    const stats = applyAnalyticsData(
      db,
      { toast_sheet: null },
      { location_id: 'default', period: 'whatever', forceEmpty: false },
    );
    assert.strictEqual(stats.sales_written, 0);
    assert.strictEqual(stats.sales_skipped_empty, true);
    assert.strictEqual(stats.spend_skipped_empty, true);
    const sales = db.prepare(`SELECT COUNT(*) as c FROM sales_lines`).get().c;
    assert.strictEqual(sales, 2);
  });

  it('respects location_id scope — other locations are not touched', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('site-b-period', 'Site B Dish', 7, 70.0, 'toast_import', 'site-b')`,
    ).run();

    applyAnalyticsData(
      db,
      {
        sales_lines: [{ item_name: 'Default Dish', quantity_sold: 1, net_sales: 1 }],
        spend_monthly: [],
        toast_sheet: 'Toast - Item Sales',
      },
      { location_id: 'default', period: 'p', forceEmpty: false },
    );

    const siteB = db
      .prepare(`SELECT item_name FROM sales_lines WHERE location_id = 'site-b'`)
      .all();
    assert.deepStrictEqual(siteB, [{ item_name: 'Site B Dish' }]);
  });
});
