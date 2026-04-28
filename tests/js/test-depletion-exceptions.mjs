#!/usr/bin/env node
// Tests for lib/depletionExceptions.ts — Phase-1 operator triage queue.
//
// The auto-depletion path (lib/salesDepletion.ts) records the *count* of
// unresolved dishes per run on sales_depletion_runs but doesn't persist
// the dish names. listDepletionExceptions() recomputes the queue on
// demand by replaying the pure resolver against current sales_lines +
// dish_components for the location.
//
// Run: node --experimental-strip-types --test tests/js/test-depletion-exceptions.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { listDepletionExceptions, REASON_LABELS } = await import(
  '../../lib/depletionExceptions.ts'
);

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

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

function seedSale(item_name, quantity_sold, net_sales, period_label = '2026-W17') {
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
     VALUES (?, ?, ?, ?, 'toast', 'default')`,
  ).run(period_label, item_name, quantity_sold, net_sales);
}

function seedMappedDish() {
  // A dish with a complete dish_components mapping — should NOT appear
  // in the exception queue.
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', 'Baja Taco', 'vendor_item', 'cabbage slaw mix', 2, 'oz')`,
  ).run();
}

describe('listDepletionExceptions', () => {
  it('returns empty when sales_lines is empty', () => {
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.deepEqual(out, []);
  });

  it('flags a sold dish with no dish_components mapping', () => {
    seedSale('Mystery Plate', 3, 27);
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].dish_name, 'Mystery Plate');
    assert.equal(out[0].reason, 'no_dish_components');
    assert.equal(out[0].affected_sales_count, 1);
    assert.equal(out[0].total_quantity_sold, 3);
    assert.equal(out[0].total_net_sales, 27);
    assert.deepEqual(out[0].sample_period_labels, ['2026-W17']);
  });

  it('omits dishes whose mapping resolves cleanly', () => {
    seedMappedDish();
    seedSale('Baja Taco', 4, 56);
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(out.length, 0, 'mapped dish should not be flagged');
  });

  it('aggregates multiple sales rows for the same unmapped dish', () => {
    seedSale('Mystery Plate', 2, 18, '2026-W17');
    seedSale('Mystery Plate', 5, 45, '2026-W18');
    seedSale('Mystery Plate', 1, 9, '2026-W18');
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].affected_sales_count, 3);
    assert.equal(out[0].total_quantity_sold, 8);
    assert.equal(out[0].total_net_sales, 72);
    assert.deepEqual(
      [...out[0].sample_period_labels].sort(),
      ['2026-W17', '2026-W18'],
    );
  });

  it('orders by net_sales DESC then quantity DESC', () => {
    seedSale('Cheap Item', 100, 50);
    seedSale('Expensive Item', 5, 500);
    seedSale('Mid Item', 10, 200);
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.deepEqual(
      out.map((r) => r.dish_name),
      ['Expensive Item', 'Mid Item', 'Cheap Item'],
    );
  });

  it('respects location scoping', () => {
    seedSale('Mystery Plate', 3, 27);
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Other Mystery', 9, 99, 'toast', 'satellite')`,
    ).run();
    const def = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(def.length, 1);
    assert.equal(def[0].dish_name, 'Mystery Plate');

    const sat = listDepletionExceptions(db, { location_id: 'satellite' });
    assert.equal(sat.length, 1);
    assert.equal(sat[0].dish_name, 'Other Mystery');
  });

  it('respects period_label filter', () => {
    seedSale('Mystery A', 1, 10, '2026-W17');
    seedSale('Mystery B', 1, 12, '2026-W18');
    const w17 = listDepletionExceptions(db, {
      location_id: 'default',
      period_label: '2026-W17',
    });
    assert.equal(w17.length, 1);
    assert.equal(w17[0].dish_name, 'Mystery A');
  });

  it('ignores zero/negative quantity_sold rows', () => {
    seedSale('Refund Plate', 0, 0);
    seedSale('Voided Plate', -1, -10);
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(out.length, 0);
  });

  it('honors limit cap', () => {
    for (let i = 0; i < 5; i++) {
      seedSale(`Mystery ${i}`, 1, 10 - i);
    }
    const out = listDepletionExceptions(db, { location_id: 'default', limit: 2 });
    assert.equal(out.length, 2);
  });

  it('applies the limit after filtering out resolved dishes', () => {
    seedMappedDish();
    seedSale('Baja Taco', 10, 1000);
    seedSale('Mystery Plate', 1, 10);

    const out = listDepletionExceptions(db, { location_id: 'default', limit: 1 });

    assert.equal(out.length, 1);
    assert.equal(out[0].dish_name, 'Mystery Plate');
  });

  it('flags recipe_missing_yield when sub-recipe has no yield', () => {
    db.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, recipe_slug,
          qty_per_serving, unit)
       VALUES ('default', 'Aioli Plate', 'recipe', 'mystery_aioli', 1, 'tsp')`,
    ).run();
    // No entities_recipes row for mystery_aioli → resolver flags it.
    seedSale('Aioli Plate', 1, 10);
    const out = listDepletionExceptions(db, { location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].reason, 'recipe_missing_yield');
  });

  it('REASON_LABELS covers every UnresolvedDish reason', () => {
    const required = [
      'no_dish_components',
      'recipe_missing_yield',
      'cross_dim_unit_mismatch',
      'unknown_unit',
      'invalid_qty',
    ];
    for (const r of required) {
      assert.ok(REASON_LABELS[r], `missing label for ${r}`);
    }
  });
});
