#!/usr/bin/env node
// Tests for lib/db.ts — Phase 1 Component 1: sales_lines service_date /
// service_period migration (GH #267; spec
// docs/superpowers/specs/2026-04-11-food-cost-prep-forecasting-design.md
// §"Component 1 — Schema migration").
// Run: node --experimental-strip-types --test tests/js/test-sales-service-period-migration.mjs
//
// Exercises:
//   - sales_lines gains service_date TEXT (nullable)
//   - sales_lines gains service_period TEXT (nullable)
//   - idx_sales_service_date(service_date, location_id) index exists
//   - backfill tags legacy monthly rows (period_label LIKE '%Item Sales%')
//     with service_period='month', leaves service_date NULL, and does NOT
//     touch non-monthly rows.
//
// All assertions read PRAGMA/sqlite_master against an in-memory DB via
// setDbPathForTest(':memory:') — no mocks, no file side effects.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getDb, setDbPathForTest, initSchema } from '../../lib/db.ts';

setDbPathForTest(':memory:');
const db = getDb();

after(() => {
  setDbPathForTest(null);
});

const infoOf = (table) =>
  /** @type {{name: string, type: string, notnull: number}[]} */ (
    db.prepare(`PRAGMA table_info(${table})`).all()
  );

describe('sales_lines schema — Phase 1 C1 additions', () => {
  it('has service_date column (TEXT, nullable)', () => {
    const c = infoOf('sales_lines').find((x) => x.name === 'service_date');
    assert.ok(c, 'sales_lines.service_date missing');
    assert.strictEqual(c.type.toUpperCase(), 'TEXT');
    assert.strictEqual(c.notnull, 0, 'service_date should be nullable');
  });

  it('has service_period column (TEXT, nullable)', () => {
    const c = infoOf('sales_lines').find((x) => x.name === 'service_period');
    assert.ok(c, 'sales_lines.service_period missing');
    assert.strictEqual(c.type.toUpperCase(), 'TEXT');
    assert.strictEqual(c.notnull, 0, 'service_period should be nullable');
  });

  it('creates idx_sales_service_date', () => {
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sales_service_date'",
      )
      .get();
    assert.ok(idx, 'idx_sales_service_date missing');
  });
});

describe('sales_lines backfill — legacy monthly rows', () => {
  it("tags period_label LIKE '%Item Sales%' as service_period='month' (service_date NULL), leaves others untouched", () => {
    const ins = db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES (?, ?, ?, ?, ?, 'default')`,
    );
    ins.run('March 2026 Item Sales', 'Test Burger', 10, 100.0, 'analytics_csv');
    ins.run('Toast daily 2026-05-01', 'Test Burger', 3, 30.0, 'toast_daily_csv');

    // Re-run the (idempotent) migration to trigger the backfill UPDATE.
    initSchema(db);

    const monthly = db
      .prepare("SELECT service_period, service_date FROM sales_lines WHERE period_label = 'March 2026 Item Sales'")
      .get();
    const daily = db
      .prepare("SELECT service_period, service_date FROM sales_lines WHERE period_label = 'Toast daily 2026-05-01'")
      .get();

    assert.strictEqual(monthly.service_period, 'month', 'Item Sales row should be backfilled to month');
    assert.strictEqual(monthly.service_date, null, 'service_date should stay NULL for monthly rows');
    assert.strictEqual(daily.service_period, null, 'non-Item-Sales row must NOT be backfilled');
  });
});
