// Tests for the dish→recipe cost bridge.
//
// Pattern mirrors test-receiving-api.mjs: register the TS resolver,
// import the lib via .ts extension, swap to a temp DB, seed inline.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-bridge-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const bridge = await import('../../lib/dishCostBridge.ts');

dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM dish_components;
    DELETE FROM recipe_costs;
    DELETE FROM sales_lines;
  `);
});

function seedRecipeCosts(slug, recipe_name, cost_per_yield_unit, yield_unit) {
  testDb.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, 'default')
     ON CONFLICT(recipe_id) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       cost_per_yield_unit = excluded.cost_per_yield_unit,
       yield_unit = excluded.yield_unit`,
  ).run(slug, recipe_name, cost_per_yield_unit, yield_unit);
}

function seedDishComponent(dish_name, recipe_slug, qty_per_serving, unit) {
  testDb.prepare(
    `INSERT INTO dish_components (location_id, dish_name, recipe_slug, qty_per_serving, unit)
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(location_id, dish_name, recipe_slug) DO UPDATE SET
       qty_per_serving = excluded.qty_per_serving,
       unit = excluded.unit`,
  ).run(dish_name, recipe_slug, qty_per_serving, unit);
}

function seedSale(item_name, qty, rev) {
  testDb.prepare(
    `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
     VALUES (?, ?, ?, 'default')`,
  ).run(item_name, qty, rev);
}

describe('normalizeDishName', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    assert.equal(bridge.normalizeDishName('Mtn Mac & Cheese'), 'mtn mac cheese');
    assert.equal(bridge.normalizeDishName('THE ROPE BURGER'), 'the rope burger');
    assert.equal(bridge.normalizeDishName('  Fish  &  Chips  '), 'fish chips');
  });
  it('returns empty string for null/undefined/empty', () => {
    assert.equal(bridge.normalizeDishName(null), '');
    assert.equal(bridge.normalizeDishName(undefined), '');
    assert.equal(bridge.normalizeDishName(''), '');
  });
  it('intentionally does NOT collapse "and" / "&" — alias is per-dish', () => {
    assert.notEqual(
      bridge.normalizeDishName('mac and cheese'),
      bridge.normalizeDishName('mac & cheese'),
    );
  });
});

describe('cleanedSalesRows', () => {
  it('drops literal TOTAL/TOTALS Toast CSV footer noise', () => {
    const out = bridge.cleanedSalesRows([
      { item_name: 'TOTAL', qty: 100, rev: 1000 },
      { item_name: 'TOTALS', qty: 50, rev: 500 },
      { item_name: 'Real Dish', qty: 10, rev: 100 },
      { item_name: '  total  ', qty: 1, rev: 1 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].item_name, 'Real Dish');
  });
  it('drops empty / whitespace-only item_name', () => {
    const out = bridge.cleanedSalesRows([
      { item_name: '', qty: 1, rev: 1 },
      { item_name: '   ', qty: 1, rev: 1 },
      { item_name: 'Burger', qty: 1, rev: 1 },
    ]);
    assert.equal(out.length, 1);
  });
});

describe('buildDishComponentMap (declared-only path)', () => {
  it('returns empty when no recipes and no dish_components', () => {
    const m = bridge.buildDishComponentMap('default', []);
    assert.equal(m.size, 0);
  });

  it('declared-only: recipe.menu_items[] without dish_components → no_dish_component', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt');
    const m = bridge.buildDishComponentMap('default', [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['The Rope Burger'] },
    ]);
    const comps = m.get('the rope burger');
    assert.ok(comps);
    assert.equal(comps.length, 1);
    assert.equal(comps[0].recipe_slug, 'bacon_jam');
    assert.equal(comps[0].qty_per_serving, null);
    assert.equal(comps[0].cost_per_yield_unit, 4.0);
    assert.equal(comps[0].status, 'no_dish_component');
    assert.equal(comps[0].per_serving_cost, null);
  });
});

describe('buildDishComponentMap (cost roll-up)', () => {
  it('fully linked: dish_component + recipe_cost → unit-converted per-serving $', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt'); // $1/cup
    seedDishComponent('the rope burger', 'bacon_jam', 0.5, 'cup'); // $0.50
    const m = bridge.buildDishComponentMap('default', [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['The Rope Burger'] },
    ]);
    const comps = m.get('the rope burger');
    assert.equal(comps[0].status, 'ok');
    assert.ok(Math.abs(comps[0].per_serving_cost - 0.5) < 0.001,
      `expected ~0.50, got ${comps[0].per_serving_cost}`);
  });

  it('dish_components row introduces a (dish, recipe) pair not in menu_items[]', () => {
    seedRecipeCosts('lariat_rub', 'Lariat Rub', 12.0, 'cup');
    seedDishComponent('grilled chicken', 'lariat_rub', 0.25, 'cup'); // $3
    const m = bridge.buildDishComponentMap('default', [
      { slug: 'lariat_rub', name: 'Lariat Rub', menu_items: [] },
    ]);
    const comps = m.get('grilled chicken');
    assert.ok(comps);
    assert.equal(comps[0].per_serving_cost, 3.0);
  });

  it('unit_convert_failed when component is weight, recipe yield is volume', () => {
    seedRecipeCosts('jam', 'Jam', 8.0, 'qt');
    seedDishComponent('toast plate', 'jam', 30, 'g'); // weight → volume needs density
    const m = bridge.buildDishComponentMap('default', [
      { slug: 'jam', name: 'Jam', menu_items: ['Toast Plate'] },
    ]);
    const comps = m.get('toast plate');
    assert.equal(comps[0].status, 'unit_convert_failed');
    assert.equal(comps[0].per_serving_cost, null);
  });

  it('no_recipe_cost when dish_components exists but recipe_costs missing', () => {
    seedDishComponent('mystery dish', 'mystery_sauce', 1, 'oz');
    const m = bridge.buildDishComponentMap('default', [
      { slug: 'mystery_sauce', name: 'Mystery Sauce', menu_items: [] },
    ]);
    const comps = m.get('mystery dish');
    assert.equal(comps[0].status, 'no_recipe_cost');
    assert.equal(comps[0].per_serving_cost, null);
  });
});

describe('computeDishCost', () => {
  it('multi-component: sum of per-component $ across two recipes', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt');     // $1/cup
    seedRecipeCosts('lariat_rub', 'Lariat Rub', 12.0, 'cup'); // $12/cup
    seedDishComponent('rope', 'bacon_jam', 0.5, 'cup');        // $0.50
    seedDishComponent('rope', 'lariat_rub', 0.1, 'cup');       // $1.20
    const r = bridge.computeDishCost('Rope', 'default', undefined, [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['Rope'] },
      { slug: 'lariat_rub', name: 'Lariat Rub', menu_items: ['Rope'] },
    ]);
    assert.equal(r.link_state, 'fully_linked');
    assert.equal(r.components.length, 2);
    assert.ok(Math.abs(r.total_cost - 1.7) < 0.01);
  });

  it('partial: one component costed, one missing qty', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt');
    seedRecipeCosts('lariat_rub', 'Lariat Rub', 12.0, 'cup');
    seedDishComponent('rope', 'bacon_jam', 0.5, 'cup');
    const r = bridge.computeDishCost('Rope', 'default', undefined, [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['Rope'] },
      { slug: 'lariat_rub', name: 'Lariat Rub', menu_items: ['Rope'] },
    ]);
    assert.equal(r.link_state, 'partial');
    assert.equal(r.fully_costed, false);
    assert.ok(r.total_cost != null);
  });

  it('unlinked: no recipe declares this dish AND no dish_components row', () => {
    const r = bridge.computeDishCost('Bourbon Well', 'default', undefined, []);
    assert.equal(r.link_state, 'unlinked');
    assert.equal(r.components.length, 0);
    assert.equal(r.total_cost, null);
  });
});

describe('computeDishCoverage', () => {
  it('counts coverage tiers correctly and filters TOTAL noise', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt');
    seedDishComponent('rope burger', 'bacon_jam', 0.5, 'cup');
    seedSale('ROPE BURGER', 100, 1000);
    seedSale('Bourbon Well', 50, 250);
    seedSale('TOTAL', 9999, 99999);

    // Pre-build map with stubbed recipes so the coverage call uses our data.
    const map = bridge.buildDishComponentMap('default', [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['ROPE BURGER'] },
    ]);
    // Manually replicate computeDishCoverage's loop with our stubbed map so
    // the test doesn't depend on the real recipes.json on disk.
    const sales = bridge.cleanedSalesRows([
      { item_name: 'ROPE BURGER', qty: 100, rev: 1000 },
      { item_name: 'Bourbon Well', qty: 50, rev: 250 },
      { item_name: 'TOTAL', qty: 9999, rev: 99999 },
    ]);
    assert.equal(sales.length, 2, 'TOTAL must be filtered');
    let fully = 0, unlinked = 0;
    for (const s of sales) {
      const r = bridge.computeDishCost(s.item_name, 'default', map);
      if (r.link_state === 'fully_linked') fully++;
      else if (r.link_state === 'unlinked') unlinked++;
    }
    assert.equal(fully, 1);
    assert.equal(unlinked, 1);
  });
});
