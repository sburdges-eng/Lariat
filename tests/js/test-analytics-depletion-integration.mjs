#!/usr/bin/env node
// Integration tests for the depletion wiring in scripts/ingest-analytics.mjs.
//
// We do not invoke the Python `ingest_analytics.py` step — that's
// orthogonal to the wiring we want to verify. Instead we seed
// dish_components + sales_lines directly and call the exported
// `runDepletionSweep` helper to confirm:
//
//   - it runs depletion for every period in sales_lines for the location,
//   - inventory_updates rows + sales_depletion_runs row are written,
//   - re-running is a no-op (already-applied skip),
//   - skipDepletion=true bypasses the sweep entirely.
//
// Run: node --experimental-strip-types --test tests/js/test-analytics-depletion-integration.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { runDepletionSweep } = await import('../../scripts/ingest-analytics.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const LOC = 'default';

beforeEach(() => {
  db.exec(`
    DELETE FROM sales_depletion_runs;
    DELETE FROM inventory_updates;
    DELETE FROM audit_events;
    DELETE FROM dish_components;
    DELETE FROM bom_lines;
    DELETE FROM sales_lines;
    DELETE FROM entities_recipes;
  `);
});

function seedTestBurger(db) {
  // 6oz patty + 1 each bun, both pure vendor_items so we don't need to
  // exercise the recipe-expansion path here (that's already covered in
  // tests/js/test-sales-depletion.mjs).
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', 'Test Burger', 'vendor_item', 'ground beef 80/20', 6, 'oz')`,
  ).run();
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', 'Test Burger', 'vendor_item', 'brioche bun', 1, 'each')`,
  ).run();
}

function seedSalesRow(db, period, qty) {
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, location_id)
     VALUES (?, 'Test Burger', ?, 'default')`,
  ).run(period, qty);
}

describe('runDepletionSweep — analytics ingest hook', () => {
  it('writes a sales_depletion_runs row + 2 inventory_updates rows on first run', async () => {
    seedTestBurger(db);
    seedSalesRow(db, 'period-A', 5);

    const summary = await runDepletionSweep(db, { location_id: LOC, skipDepletion: false });

    assert.strictEqual(summary.periods, 1);
    assert.strictEqual(summary.writes, 2);

    const runs = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    assert.strictEqual(runs, 1, 'one sales_depletion_runs row');

    const invRows = db
      .prepare(`SELECT item, delta, direction, note FROM inventory_updates ORDER BY id`)
      .all();
    assert.strictEqual(invRows.length, 2, 'two inventory_updates rows (patty + bun)');
    for (const row of invRows) {
      assert.strictEqual(row.direction, 'out');
      assert.match(row.note, /^\[deplete-run=\d+\]/, `note shape: ${row.note}`);
      assert.match(row.delta, /^-\d/, `delta shape: ${row.delta}`);
    }
    const items = invRows.map((r) => r.item).sort();
    assert.deepStrictEqual(items, ['brioche bun', 'ground beef 80/20']);
  });

  it('is idempotent — re-running does not add rows', async () => {
    seedTestBurger(db);
    seedSalesRow(db, 'period-B', 3);

    await runDepletionSweep(db, { location_id: LOC, skipDepletion: false });
    const runsBefore = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    const invBefore = db.prepare(`SELECT COUNT(*) as c FROM inventory_updates`).get().c;
    assert.strictEqual(runsBefore, 1);
    assert.strictEqual(invBefore, 2);

    const summary = await runDepletionSweep(db, { location_id: LOC, skipDepletion: false });
    assert.strictEqual(summary.skippedAlready, 1, 'period-B was already-applied');

    const runsAfter = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    const invAfter = db.prepare(`SELECT COUNT(*) as c FROM inventory_updates`).get().c;
    assert.strictEqual(runsAfter, 1, 'sales_depletion_runs unchanged');
    assert.strictEqual(invAfter, 2, 'inventory_updates unchanged');
  });

  it('skipDepletion=true bypasses the sweep — no runs row written', async () => {
    seedTestBurger(db);
    seedSalesRow(db, 'period-C', 2);

    const summary = await runDepletionSweep(db, { location_id: LOC, skipDepletion: true });
    assert.strictEqual(summary.skipped, true);

    const runs = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    assert.strictEqual(runs, 0, 'no sales_depletion_runs row when skipped');
    const inv = db.prepare(`SELECT COUNT(*) as c FROM inventory_updates`).get().c;
    assert.strictEqual(inv, 0, 'no inventory_updates rows when skipped');
  });

  it('processes every distinct period in sales_lines for the location', async () => {
    seedTestBurger(db);
    seedSalesRow(db, 'period-D1', 1);
    seedSalesRow(db, 'period-D2', 4);

    const summary = await runDepletionSweep(db, { location_id: LOC, skipDepletion: false });
    assert.strictEqual(summary.periods, 2);
    // 2 components × 2 periods = 4 inventory_updates rows.
    assert.strictEqual(summary.writes, 4);

    const runs = db.prepare(`SELECT period_label FROM sales_depletion_runs ORDER BY period_label`).all();
    assert.deepStrictEqual(runs.map((r) => r.period_label), ['period-D1', 'period-D2']);
  });

  it('uses today UTC for shift_date on every inventory_updates row', async () => {
    seedTestBurger(db);
    seedSalesRow(db, 'period-E', 1);

    const expected = new Date().toISOString().slice(0, 10);
    await runDepletionSweep(db, { location_id: LOC, skipDepletion: false });

    const dates = db
      .prepare(`SELECT DISTINCT shift_date FROM inventory_updates`)
      .all()
      .map((r) => r.shift_date);
    assert.deepStrictEqual(dates, [expected]);
  });
});
