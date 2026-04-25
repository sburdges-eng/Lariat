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
    DELETE FROM vendor_prices;
    DELETE FROM order_guide_items;
  `);
});

function seedRecipeCosts(slug, recipe_name, cost_per_yield_unit, yield_unit) {
  testDb.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, 'default')
     ON CONFLICT(location_id, recipe_id) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       cost_per_yield_unit = excluded.cost_per_yield_unit,
       yield_unit = excluded.yield_unit`,
  ).run(slug, recipe_name, cost_per_yield_unit, yield_unit);
}

function seedDishComponent(dish_name, recipe_slug, qty_per_serving, unit) {
  testDb.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', ?, 'recipe', ?, NULL, ?, ?)
     ON CONFLICT(location_id, dish_name, recipe_slug) WHERE component_type='recipe'
       DO UPDATE SET
         qty_per_serving = excluded.qty_per_serving,
         unit = excluded.unit`,
  ).run(dish_name, recipe_slug, qty_per_serving, unit);
}

function seedVendorDishComponent(dish_name, vendor_ingredient, qty_per_serving, unit) {
  testDb.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', ?, 'vendor_item', NULL, ?, ?, ?)
     ON CONFLICT(location_id, dish_name, vendor_ingredient) WHERE component_type='vendor_item'
       DO UPDATE SET
         qty_per_serving = excluded.qty_per_serving,
         unit = excluded.unit`,
  ).run(dish_name, vendor_ingredient, qty_per_serving, unit);
}

function seedVendorPrice(ingredient, unit_price, pack_unit, vendor = 'sysco') {
  testDb.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit, unit_price, location_id)
     VALUES (?, ?, 1, ?, ?, 'default')`,
  ).run(ingredient, vendor, pack_unit, unit_price);
}

function seedOrderGuide(ingredient, unit_price, unit, is_placeholder = 0) {
  testDb.prepare(
    `INSERT INTO order_guide_items (ingredient, unit_price, unit, location_id, is_placeholder)
     VALUES (?, ?, ?, 'default', ?)`,
  ).run(ingredient, unit_price, unit, is_placeholder ? 1 : 0);
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
    assert.equal(comps[0].component_type, 'recipe');
    assert.equal(comps[0].recipe_slug, 'bacon_jam');
    assert.equal(comps[0].qty_per_serving, null);
    assert.equal(comps[0].unit_price, 4.0);
    assert.equal(comps[0].base_unit, 'qt');
    assert.equal(comps[0].status, 'no_dish_component');
    assert.equal(comps[0].per_serving_cost, null);
  });
});

describe('buildDishComponentMap (recipe-side cost roll-up)', () => {
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

describe('buildDishComponentMap (vendor_item path)', () => {
  it('vendor_item with vendor_prices match → per-serving $ via unit_price × qty', () => {
    // Brioche Bun: $0.50 each. Burger uses 1 each.
    seedVendorPrice('Brioche Bun', 0.50, 'each');
    seedVendorDishComponent('rope burger', 'Brioche Bun', 1, 'each');
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('rope burger');
    assert.ok(comps);
    assert.equal(comps[0].component_type, 'vendor_item');
    assert.equal(comps[0].vendor_ingredient, 'Brioche Bun');
    assert.equal(comps[0].status, 'ok');
    assert.ok(Math.abs(comps[0].per_serving_cost - 0.5) < 0.001);
  });

  it('vendor_item falls back to order_guide_items when not in vendor_prices', () => {
    seedOrderGuide('American Cheese Slice', 0.12, 'each');
    seedVendorDishComponent('cheeseburger', 'American Cheese Slice', 2, 'each'); // $0.24
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('cheeseburger');
    assert.equal(comps[0].status, 'ok');
    assert.ok(Math.abs(comps[0].per_serving_cost - 0.24) < 0.001);
  });

  it('vendor_item lookup is case-insensitive on ingredient', () => {
    seedVendorPrice('BRIOCHE BUN', 0.50, 'each');
    seedVendorDishComponent('any dish', 'brioche bun', 1, 'each');
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('any dish');
    assert.equal(comps[0].status, 'ok');
    assert.ok(Math.abs(comps[0].per_serving_cost - 0.5) < 0.001);
  });

  it('no_vendor_price status when neither vendor_prices nor order_guide has the ingredient', () => {
    seedVendorDishComponent('mystery dish', 'Unicorn Bacon', 1, 'each');
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('mystery dish');
    assert.equal(comps[0].status, 'no_vendor_price');
    assert.equal(comps[0].per_serving_cost, null);
  });

  it('vendor_item unit conversion: lb-priced item with oz qty', () => {
    // Ground beef priced at $5/lb. Burger uses 8 oz = 0.5 lb → $2.50.
    seedVendorPrice('80/20 Ground Beef', 5.0, 'lb');
    seedVendorDishComponent('rope burger', '80/20 Ground Beef', 8, 'oz');
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('rope burger');
    assert.equal(comps[0].status, 'ok');
    assert.ok(Math.abs(comps[0].per_serving_cost - 2.5) < 0.001,
      `expected $2.50, got $${comps[0].per_serving_cost}`);
  });

  it('vendor_prices preferred over order_guide_items when both exist', () => {
    seedVendorPrice('Brioche Bun', 0.40, 'each');           // newer
    seedOrderGuide('Brioche Bun', 0.99, 'each');             // older fallback
    seedVendorDishComponent('rope burger', 'Brioche Bun', 1, 'each');
    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('rope burger');
    assert.equal(comps[0].unit_price, 0.40, 'vendor_prices should win');
  });
});

describe('buildDishComponentMap (order_guide placeholder skip)', () => {
  it('skips order_guide rows marked is_placeholder=1 when resolving vendor_item cost', () => {
    // Two rows for the same ingredient: a placeholder-priced row (recipe-derived
    // ~$0.0005/cup value that got written in as a cost) and a real vendor row.
    // The bridge must pick the real one regardless of insertion order.
    seedOrderGuide('rye whiskey', 0.000502325771845, 'cup', /* is_placeholder */ 1);
    seedOrderGuide('rye whiskey', 0.50, 'oz', /* is_placeholder */ 0);
    seedVendorDishComponent('old fashioned', 'rye whiskey', 2, 'oz'); // $1.00

    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('old fashioned');
    assert.ok(comps, 'dish should resolve');
    assert.equal(comps[0].status, 'ok');
    assert.equal(comps[0].unit_price, 0.50, 'real row must win over placeholder');
    assert.ok(Math.abs(comps[0].per_serving_cost - 1.0) < 0.001,
      `expected $1.00, got $${comps[0].per_serving_cost}`);
  });

  it('treats the placeholder row as absent: no_vendor_price when it is the only row', () => {
    // If the ONLY order_guide row for an ingredient is a placeholder, the
    // bridge should report no_vendor_price rather than silently applying the
    // bogus unit_price.
    seedOrderGuide('dry white wine', 0.000502325771845, 'cup', /* is_placeholder */ 1);
    seedVendorDishComponent('wine sauce plate', 'dry white wine', 0.25, 'cup');

    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('wine sauce plate');
    assert.equal(comps[0].status, 'no_vendor_price');
    assert.equal(comps[0].per_serving_cost, null);
  });

  it('vendor_prices still wins over a real (non-placeholder) order_guide row', () => {
    // Regression guard: the placeholder filter must not disturb the existing
    // vendor_prices-preferred-over-order_guide behavior.
    seedVendorPrice('stout beer', 0.08, 'oz');
    seedOrderGuide('stout beer', 0.20, 'oz', /* is_placeholder */ 0);
    seedVendorDishComponent('beer braise', 'stout beer', 4, 'oz'); // $0.32 via vendor_prices

    const m = bridge.buildDishComponentMap('default', []);
    const comps = m.get('beer braise');
    assert.equal(comps[0].unit_price, 0.08, 'vendor_prices should still win');
  });
});

describe('buildDishComponentMap (mixed dish: recipe + vendor_item)', () => {
  it('a single dish can hold both a sub-recipe and a distributor item', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt'); // $1/cup
    seedVendorPrice('Brioche Bun', 0.50, 'each');
    seedDishComponent('rope burger', 'bacon_jam', 0.5, 'cup');     // $0.50
    seedVendorDishComponent('rope burger', 'Brioche Bun', 1, 'each'); // $0.50
    const r = bridge.computeDishCost('Rope Burger', 'default', undefined, [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: [] },
    ]);
    assert.equal(r.link_state, 'fully_linked');
    assert.equal(r.components.length, 2);
    assert.ok(Math.abs(r.total_cost - 1.0) < 0.001);
  });
});

describe('computeDishCost', () => {
  it('multi-component recipe sum', () => {
    seedRecipeCosts('bacon_jam', 'Bacon Jam', 4.0, 'qt');
    seedRecipeCosts('lariat_rub', 'Lariat Rub', 12.0, 'cup');
    seedDishComponent('rope', 'bacon_jam', 0.5, 'cup');
    seedDishComponent('rope', 'lariat_rub', 0.1, 'cup');
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

    const map = bridge.buildDishComponentMap('default', [
      { slug: 'bacon_jam', name: 'Bacon Jam', menu_items: ['ROPE BURGER'] },
    ]);
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
