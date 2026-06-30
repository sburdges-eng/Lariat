// Tests for lib/beoFoodCost.ts — per-line + blended food-cost over the existing
// dish-cost bridge. Harness mirrors test-dish-cost-bridge.mjs (TS resolver,
// temp DB, inline seed via dish_components + recipe_costs).
//
// Scenarios seeded once: a fully_linked line, a partial line, a declared_only
// line, and an unlinked (freeform, no dish_components) line.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-foodcost-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const foodCost = await import('../../lib/beoFoodCost.ts');

dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seedRecipeCost(slug, name, costPerYield, yieldUnit) {
  testDb.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, 'default')
     ON CONFLICT(location_id, recipe_id) DO UPDATE SET
       cost_per_yield_unit = excluded.cost_per_yield_unit, yield_unit = excluded.yield_unit`,
  ).run(slug, name, costPerYield, yieldUnit);
}

function seedDishComponent(dish, slug, qty, unit) {
  testDb.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit)
     VALUES ('default', ?, 'recipe', ?, NULL, ?, ?)
     ON CONFLICT(location_id, dish_name, recipe_slug) WHERE component_type='recipe'
       DO UPDATE SET qty_per_serving = excluded.qty_per_serving, unit = excluded.unit`,
  ).run(dish, slug, qty, unit);
}

before(() => {
  testDb.exec(
    'DELETE FROM dish_components; DELETE FROM recipe_costs; DELETE FROM vendor_prices; DELETE FROM order_guide_items;',
  );
  // fully_linked: bacon_jam $4/qt -> $1/cup; 0.5 cup => $0.50
  seedRecipeCost('bacon_jam', 'Bacon Jam', 4.0, 'qt');
  seedDishComponent('bacon platter', 'bacon_jam', 0.5, 'cup');
  // partial: one costed (bacon_jam) + one with no recipe_cost (null)
  seedDishComponent('combo platter', 'bacon_jam', 0.5, 'cup');
  seedDishComponent('combo platter', 'uncosted_recipe', 1, 'cup');
  // declared_only: a recipe component declared, but no recipe_cost at all
  seedDishComponent('mystery platter', 'mystery_sauce', 1, 'cup');
  // unlinked: "Bare Item" intentionally has NO dish_components row
});

// Title-cased item_name on purpose (normalizeDishName lowercases for the lookup).
const LINES = [
  { id: 1, item_name: 'Bacon Platter', unit_cost: 5, quantity: 10 }, // fully_linked
  { id: 2, item_name: 'Combo Platter', unit_cost: 2, quantity: 4 },  // partial
  { id: 3, item_name: 'Mystery Platter', unit_cost: 3, quantity: 2 }, // declared_only
  { id: 4, item_name: 'Bare Item', unit_cost: 1, quantity: 1 },      // unlinked
];

describe('computeLineFoodCosts — per line', () => {
  it('fully_linked: cost present, pct = cost/sell', () => {
    const { perLine } = foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    const l = perLine.find((p) => p.id === 1);
    assert.equal(l.link_state, 'fully_linked');
    assert.ok(Math.abs(l.cost - 0.5) < 0.001, `cost ${l.cost}`);
    assert.ok(Math.abs(l.food_cost_pct - 0.1) < 0.001, `pct ${l.food_cost_pct}`);
  });

  it('partial: cost present, link_state partial, pct = cost/sell', () => {
    const { perLine } = foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    const l = perLine.find((p) => p.id === 2);
    assert.equal(l.link_state, 'partial');
    assert.ok(l.cost != null);
    assert.ok(Math.abs(l.food_cost_pct - l.cost / 2) < 0.001);
  });

  it('declared_only: cost null, pct null', () => {
    const { perLine } = foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    const l = perLine.find((p) => p.id === 3);
    assert.equal(l.link_state, 'declared_only');
    assert.equal(l.cost, null);
    assert.equal(l.food_cost_pct, null);
  });

  it('unlinked: cost null, link_state unlinked, pct null', () => {
    const { perLine } = foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    const l = perLine.find((p) => p.id === 4);
    assert.equal(l.link_state, 'unlinked');
    assert.equal(l.cost, null);
    assert.equal(l.food_cost_pct, null);
  });

  it('food_cost_pct is null when unit_cost is 0 (no divide-by-zero)', () => {
    const { perLine } = foodCost.computeLineFoodCosts(
      [{ id: 9, item_name: 'Bacon Platter', unit_cost: 0, quantity: 1 }], 'default', testDb);
    assert.equal(perLine[0].food_cost_pct, null);
    assert.equal(perLine[0].link_state, 'fully_linked'); // still linked, just no sell price
  });
});

describe('computeLineFoodCosts — blended', () => {
  it('blends over costed lines only; counts linked vs not-linked', () => {
    const { blended } = foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    // numerator Σ(cost·qty) = 0.5*10 + 0.5*4 = 7 ; denominator Σ(sell·qty) = 5*10 + 2*4 = 58
    assert.ok(Math.abs(blended.pct - 7 / 58) < 0.002, `pct ${blended.pct}`);
    assert.equal(blended.costedCount, 2);
    assert.equal(blended.unlinkedCount, 2);
  });

  it('pct is null when no line is costed', () => {
    const { blended } = foodCost.computeLineFoodCosts(
      [{ id: 1, item_name: 'Bare Item', unit_cost: 1, quantity: 1 }], 'default', testDb);
    assert.equal(blended.pct, null);
    assert.equal(blended.costedCount, 0);
    assert.equal(blended.unlinkedCount, 1);
  });
});

describe('computeLineFoodCosts — read-only', () => {
  it('performs no DB writes', () => {
    const before = testDb.prepare('SELECT COUNT(*) AS c FROM dish_components').get().c;
    foodCost.computeLineFoodCosts(LINES, 'default', testDb);
    const after = testDb.prepare('SELECT COUNT(*) AS c FROM dish_components').get().c;
    assert.equal(after, before);
  });
});
