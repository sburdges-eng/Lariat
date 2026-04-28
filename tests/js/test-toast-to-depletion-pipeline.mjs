#!/usr/bin/env node
// End-to-end pipeline test: Toast sales row → inventory_updates row.
//
// This test demonstrates the complete chain that runs in production
// when the analytics ingest sees fresh sales:
//   sales_lines (Toast import)
//     → runDepletionSweep (Task 1 wire-up in scripts/ingest-analytics.mjs)
//       → applyDepletionsForPeriod (lib/salesDepletion.ts)
//         → resolveDepletionsForSale (vendor_item + recipe-with-shrinkage)
//           → inventory_updates rows + sales_depletion_runs row + audit_events
//
// Distinct from tests/js/test-analytics-depletion-integration.mjs by
// exercising BOTH a recipe-component dish (yield ratio + shrinkage) and a
// vendor-item dish in a single end-to-end run, plus idempotency.
//
// Hand-calculated expected deltas:
//   Burger × 10 servings, recipe burger_assembly (yield 1 each):
//     - beef patty: ratio=1/1=1; 1 × 6 oz × 10 = 60 oz cooked;
//                   loss_factor=0.25 → 60 / 0.75 = 80 oz raw → "-80 oz"
//     - brioche bun: 1 × 1 each × 10 = 10 each, no shrink → "-10 each"
//   Salad × 4 servings, two vendor_items:
//     - lettuce mix: 4 oz × 4 = 16 oz → "-16 oz"
//     - dressing:    1 oz × 4 = 4 oz  → "-4 oz"
//
// Run: node --experimental-strip-types --test tests/js/test-toast-to-depletion-pipeline.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { runDepletionSweep } = await import('../../scripts/ingest-analytics.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const LOC = 'default';
const PERIOD = 'toast_2026_w17';

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

// Seed both dish-shape archetypes the depletion resolver supports:
//   - Burger: dish_components → recipe → bom_lines (with shrinkage)
//   - Salad:  dish_components → vendor_items (no recipe layer)
function seedDishes(db) {
  // ── Burger: recipe-component path with cooking shrinkage ──
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug,
        qty_per_serving, unit)
     VALUES ('default', 'Burger', 'recipe', 'burger_assembly', 1, 'each')`,
  ).run();

  db.prepare(
    `INSERT INTO entities_recipes
       (uuid, slug, display_name, yield_qty, yield_unit, location_id)
     VALUES ('rec-burger-1', 'burger_assembly', 'Burger Assembly',
             1, 'each', 'default')`,
  ).run();

  // 6oz cooked patty with 25% cooking shrink. Raw debit = 6 / 0.75 = 8 oz/serving.
  db.prepare(
    `INSERT INTO bom_lines
       (recipe_id, ingredient, qty, unit, loss_factor, location_id)
     VALUES ('burger_assembly', 'beef patty', 6, 'oz', 0.25, 'default')`,
  ).run();
  db.prepare(
    `INSERT INTO bom_lines
       (recipe_id, ingredient, qty, unit, loss_factor, location_id)
     VALUES ('burger_assembly', 'brioche bun', 1, 'each', NULL, 'default')`,
  ).run();

  // ── Salad: pure vendor_item path, no shrinkage ──
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', 'Salad', 'vendor_item', 'lettuce mix', 4, 'oz')`,
  ).run();
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', 'Salad', 'vendor_item', 'dressing', 1, 'oz')`,
  ).run();
}

function seedSales(db) {
  // Both rows share the same period_label so we test single-period
  // processing (one sales_depletion_runs row covers both dishes).
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, location_id)
     VALUES (?, 'Burger', 10, 'default')`,
  ).run(PERIOD);
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, location_id)
     VALUES (?, 'Salad', 4, 'default')`,
  ).run(PERIOD);
}

describe('Toast → depletion full pipeline (Task 3)', () => {
  it('vendor_item + recipe-with-shrinkage paths produce the expected deltas', async () => {
    seedDishes(db);
    seedSales(db);

    // Sanity: confirm the seeded sales row count before the sweep.
    const salesCount = db.prepare(`SELECT COUNT(*) as c FROM sales_lines`).get().c;
    assert.strictEqual(salesCount, 2, 'two sales_lines rows seeded');

    // ── Drive the Task-1 wire-up directly ──
    const summary = await runDepletionSweep(db, { location_id: LOC });

    assert.strictEqual(summary.skipped, false);
    assert.strictEqual(summary.periods, 1, 'one distinct period_label');
    // 2 from Burger (patty + bun) + 2 from Salad (lettuce + dressing) = 4.
    assert.strictEqual(summary.writes, 4);

    // ── sales_depletion_runs: exactly one row ──
    const runs = db
      .prepare(
        `SELECT id, period_label, location_id, depletions_written
           FROM sales_depletion_runs`,
      )
      .all();
    assert.strictEqual(runs.length, 1, 'one sales_depletion_runs row');
    assert.strictEqual(runs[0].period_label, PERIOD);
    assert.strictEqual(runs[0].location_id, LOC);
    assert.strictEqual(runs[0].depletions_written, 4);

    // ── inventory_updates: row count + per-row content ──
    const invRows = db
      .prepare(
        `SELECT item, delta, direction, note FROM inventory_updates
          ORDER BY id`,
      )
      .all();
    assert.strictEqual(invRows.length, 4, 'exactly 4 inventory_updates rows');

    // Common shape: every row direction='out' and note tagged with run id.
    for (const row of invRows) {
      assert.strictEqual(row.direction, 'out', `direction for ${row.item}`);
      assert.match(
        row.note,
        /^\[deplete-run=\d+\]/,
        `note tag for ${row.item}: ${row.note}`,
      );
    }

    // Index rows by item for hand-calculated delta assertions.
    const byItem = Object.fromEntries(invRows.map((r) => [r.item, r]));

    // ── Burger (recipe path) ──
    // beef patty: 10 × 6oz cooked × 1/(1-0.25) = 80 oz raw.
    assert.ok(byItem['beef patty'], 'beef patty row written');
    assert.strictEqual(
      byItem['beef patty'].delta,
      '-80 oz',
      `beef patty delta should be exactly "-80 oz" (10 × 6 / 0.75); got ${byItem['beef patty'].delta}`,
    );

    // brioche bun: 10 × 1 each, no shrinkage.
    assert.ok(byItem['brioche bun'], 'brioche bun row written');
    assert.strictEqual(
      byItem['brioche bun'].delta,
      '-10 each',
      `brioche bun delta should be "-10 each"; got ${byItem['brioche bun'].delta}`,
    );

    // ── Salad (vendor_item path) ──
    // lettuce mix: 4 sales × 4oz = 16 oz.
    assert.ok(byItem['lettuce mix'], 'lettuce mix row written');
    assert.strictEqual(
      byItem['lettuce mix'].delta,
      '-16 oz',
      `lettuce mix delta should be "-16 oz" (4 × 4); got ${byItem['lettuce mix'].delta}`,
    );

    // dressing: 4 sales × 1oz = 4 oz.
    assert.ok(byItem['dressing'], 'dressing row written');
    assert.strictEqual(
      byItem['dressing'].delta,
      '-4 oz',
      `dressing delta should be "-4 oz" (4 × 1); got ${byItem['dressing'].delta}`,
    );

    // ── audit_events: one per inventory_updates row ──
    const auditRows = db
      .prepare(
        `SELECT entity, actor_source FROM audit_events
          WHERE entity = 'inventory_updates'`,
      )
      .all();
    assert.strictEqual(auditRows.length, 4, 'four audit_events rows');
    for (const row of auditRows) {
      assert.strictEqual(row.entity, 'inventory_updates');
      assert.strictEqual(row.actor_source, 'sales_depletion');
    }
  });

  it('re-running runDepletionSweep is idempotent — no new rows', async () => {
    seedDishes(db);
    seedSales(db);

    // First sweep: writes the 4 inventory_updates rows + 1 runs row.
    await runDepletionSweep(db, { location_id: LOC });

    const invBefore = db.prepare(`SELECT COUNT(*) as c FROM inventory_updates`).get().c;
    const runsBefore = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    const auditBefore = db
      .prepare(`SELECT COUNT(*) as c FROM audit_events WHERE entity='inventory_updates'`)
      .get().c;
    assert.strictEqual(invBefore, 4);
    assert.strictEqual(runsBefore, 1);
    assert.strictEqual(auditBefore, 4);

    // Second sweep: same period already in sales_depletion_runs → skip.
    const summary2 = await runDepletionSweep(db, { location_id: LOC });
    assert.strictEqual(summary2.skippedAlready, 1, 'period was already-applied');
    assert.strictEqual(summary2.writes, 0, 'no new writes on re-run');

    const invAfter = db.prepare(`SELECT COUNT(*) as c FROM inventory_updates`).get().c;
    const runsAfter = db.prepare(`SELECT COUNT(*) as c FROM sales_depletion_runs`).get().c;
    const auditAfter = db
      .prepare(`SELECT COUNT(*) as c FROM audit_events WHERE entity='inventory_updates'`)
      .get().c;
    assert.strictEqual(invAfter, 4, 'inventory_updates count UNCHANGED');
    assert.strictEqual(runsAfter, 1, 'sales_depletion_runs count UNCHANGED');
    assert.strictEqual(auditAfter, 4, 'audit_events count UNCHANGED');
  });
});
