#!/usr/bin/env node
// Tests for the sub-recipe pricing rollup pass.
// Run: node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import {
  rollupRecipeCosts,
  _buildRecipeDag,
  _topologicalOrder,
  _priceLeafLine,
  _priceSubRecipeLine,
} from '../../lib/computeEngine/rollupRecipeCosts.ts';
import { recomputeRecipeCosts } from '../../lib/computeEngine/recipeCosting.ts';
import { deriveMasterId } from '../../scripts/ingest-costing.mjs';
import { computeCostVariance } from '../../lib/costingBenchmarks.mjs';
import { WEIGHT_TO_G, VOLUME_TO_ML } from '../../lib/unitConvert.mjs';

const LOC = 'default';

describe('rollupRecipeCosts — smoke', () => {
  it('returns an all-zero result on an empty DB', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const result = rollupRecipeCosts(db, LOC);
    assert.deepEqual(result, {
      updated: 0,
      cycles: [],
      unconverted: [],
      new_subrecipe_flags: 0,
    });
    db.close();
  });
});

describe('rollupRecipeCosts — detection + sub_recipe flag autocorrect', () => {
  it("sets sub_recipe='YES' on BOM lines whose ingredient resolves to an existing recipe_id", () => {
    const db = new Database(':memory:');
    initSchema(db);

    // Parent recipe with one sub-recipe-referencing BOM line that lacks the flag.
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent', 'Parent', 1, 'qt', 10, 10, ?), ('lariat_rub', 'Lariat Rub', 4, 'cup', 8, 2, ?)`,
    ).run(LOC, LOC);

    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub', 1, 'cup', NULL, 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);

    assert.equal(result.new_subrecipe_flags, 1);
    const row = db.prepare(
      `SELECT sub_recipe FROM bom_lines WHERE recipe_id='parent' AND ingredient='lariat rub' AND location_id=?`,
    ).get(LOC);
    assert.equal(row.sub_recipe, 'YES');

    db.close();
  });

  it("does not re-flag a BOM line already marked sub_recipe='YES'", () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',10,10,?), ('lariat_rub','Lariat Rub',4,'cup',8,2,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub', 1, 'cup', 'YES', 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.new_subrecipe_flags, 0);
    db.close();
  });

  it('does not flag BOM lines whose ingredient does not resolve to a recipe_id', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',10,10,?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'kosher salt', 0.5, 'tsp', NULL, 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.new_subrecipe_flags, 0);
    const row = db.prepare(`SELECT sub_recipe FROM bom_lines LIMIT 1`).get();
    assert.equal(row.sub_recipe, null);
    db.close();
  });

  it('sanity: deriveMasterId("Lariat Rub") === "lariat_rub"', () => {
    assert.equal(deriveMasterId('Lariat Rub'), 'lariat_rub');
  });
});

describe('rollupRecipeCosts — DAG construction', () => {
  it('returns adjacency where parent points at every child it references via a sub-recipe BOM line', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',NULL,NULL,?),
              ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('pickle_juice','Pickle Juice',2,'cup',6,3,?)`,
    ).run(LOC, LOC, LOC);

    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub',    0.5, 'cup', 'YES', 'confirmed', ?),
              ('parent', 'pickle juice',  1,   'cup', 'YES', 'confirmed', ?),
              ('parent', 'kosher salt',   1,   'tsp', NULL,  'confirmed', ?)`,
    ).run(LOC, LOC, LOC);

    const { children } = _buildRecipeDag(db, LOC);
    assert.deepEqual(
      [...(children.get('parent') ?? [])].sort(),
      ['lariat_rub', 'pickle_juice'],
    );
    assert.deepEqual(children.get('lariat_rub') ?? [], []);
    assert.deepEqual(children.get('pickle_juice') ?? [], []);

    db.close();
  });
});

describe('rollupRecipeCosts — cycle detection', () => {
  it('returns a topo order over a clean DAG (leaves first)', () => {
    const children = new Map([
      ['parent', ['lariat_rub']],
      ['lariat_rub', []],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, ['lariat_rub', 'parent']);
    assert.deepEqual(cycles, []);
  });

  it('detects a 2-cycle A->B->A and reports both members as cycles', () => {
    const children = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, []); // nothing can be rolled up
    assert.deepEqual(cycles.slice().sort(), ['a', 'b']);
  });

  it('detects a self-loop A->A', () => {
    const children = new Map([['a', ['a']]]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, []);
    assert.deepEqual(cycles, ['a']);
  });

  it('partial cycle: clean recipe is still ordered, cycle members are reported separately', () => {
    const children = new Map([
      ['clean', []],
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, ['clean']);
    assert.deepEqual(cycles.slice().sort(), ['a', 'b']);
  });

  it('end-to-end: rollupRecipeCosts surfaces cycle members in result.cycles', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('a','A',1,'cup',1,1,?), ('b','B',1,'cup',1,1,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('a','b',0.5,'cup','YES','confirmed',?),
              ('b','a',0.5,'cup','YES','confirmed',?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.deepEqual(result.cycles.slice().sort(), ['a', 'b']);
    db.close();
  });
});

describe('rollupRecipeCosts — leaf line pricing', () => {
  it('prices a vendor_prices-matched line via the existing T7 path', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('OIL, CANOLA CLR FRY ZTF', 'shamrock', '1950621', 35, 'lb', 38.01, 1.086, ?)`,
    ).run(LOC);

    // T7 master_id: the line carries it, the vendor_prices row carries it.
    db.prepare(`UPDATE vendor_prices SET master_id = 'canola_oil' WHERE ingredient = 'OIL, CANOLA CLR FRY ZTF'`).run();

    // qty=2 lb of canola oil, yield_pct=1.0, loss_factor=0.
    const line = {
      ingredient: 'canola oil',
      qty: 2,
      unit: 'lb',
      master_id: 'canola_oil',
      yield_pct: 1.0,
      loss_factor: null,
    };
    const { cost, reason } = _priceLeafLine(db, LOC, line);
    // 2 lb * (38.01 / 35) = 2 * 1.086 = 2.172
    assert.ok(cost !== null);
    assert.equal(reason, null);
    assert.ok(Math.abs(cost - 2.172) < 0.001, `got ${cost}`);

    db.close();
  });

  it('returns null cost (no reason) when no vendor_prices row matches', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const { cost, reason } = _priceLeafLine(db, LOC, {
      ingredient: 'asafoetida',
      qty: 0.01,
      unit: 'lb',
      master_id: null,
      yield_pct: 1.0,
      loss_factor: null,
    });
    assert.equal(cost, null);
    assert.equal(reason, null);
    db.close();
  });

  it('converts cross-dim pack units via density: 1 cup line off a 50 lb sack', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('diced onion', 'sysco', '7', 50, 'lb', 50, 1, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES ('diced onion', 0.56, 'seed')`,
    ).run();

    const { cost, reason } = _priceLeafLine(db, LOC, {
      ingredient: 'diced onion',
      qty: 1,
      unit: 'cup',
      master_id: null,
      yield_pct: 0.85,
      loss_factor: null,
    });
    const packCup = (50 * WEIGHT_TO_G.lb) / 0.56 / VOLUME_TO_ML.cup;
    const expected = (1 * 50 / packCup) * (1 / 0.85);
    assert.equal(reason, null);
    assert.ok(cost !== null && Math.abs(cost - expected) < 1e-6, `got ${cost}, expected ${expected}`);
    db.close();
  });

  it("flags 'no_density' on cross-dim pack units when no density is seeded", () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('mystery pulp', 'sysco', '8', 50, 'lb', 50, 1, ?)`,
    ).run(LOC);

    const { cost, reason } = _priceLeafLine(db, LOC, {
      ingredient: 'mystery pulp',
      qty: 1,
      unit: 'cup',
      master_id: null,
      yield_pct: 0.85,
      loss_factor: null,
    });
    assert.equal(cost, null);
    assert.equal(reason, 'no_density');
    db.close();
  });

  it('bridges count units via ingredient_unit_weights: 5 ea off a 10 lb pack', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('jalapeno', 'sysco', '9', 10, 'lb', 31.95, 3.195, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO ingredient_unit_weights (ingredient_key, unit, g_per_unit, source) VALUES ('jalapeno', 'ea', 30, 'seed')`,
    ).run();

    const { cost, reason } = _priceLeafLine(db, LOC, {
      ingredient: 'jalapeno',
      qty: 5,
      unit: 'ea',
      master_id: null,
      yield_pct: 1.0,
      loss_factor: null,
    });
    const packEa = (10 * WEIGHT_TO_G.lb) / 30;
    const expected = 5 * 31.95 / packEa;
    assert.equal(reason, null);
    assert.ok(cost !== null && Math.abs(cost - expected) < 1e-6, `got ${cost}, expected ${expected}`);
    db.close();
  });

  it('falls back to the identity assumption when the vendor row has no pack_unit', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('bay leaf', 'sysco', '10', 16, NULL, 8, 0.5, ?)`,
    ).run(LOC);

    const { cost, reason } = _priceLeafLine(db, LOC, {
      ingredient: 'bay leaf',
      qty: 2,
      unit: 'oz',
      master_id: null,
      yield_pct: 1.0,
      loss_factor: null,
    });
    // No pack_unit → T3 identity assumption: 2 × 8/16 = 1.
    assert.equal(reason, null);
    assert.ok(cost !== null && Math.abs(cost - 1.0) < 1e-9, `got ${cost}`);
    db.close();
  });
});

describe('rollupRecipeCosts — sub-recipe line pricing', () => {
  it('converts the BOM qty from line.unit to child.yield_unit and computes cost', () => {
    // child: lariat_rub, yield=4 cup, batch_cost=$8 -> $2/cup
    const child = { recipe_id: 'lariat_rub', yield: 4, yield_unit: 'cup', batch_cost: 8 };
    // line: parent consumes 16 tbsp lariat rub. 16 tbsp = 1 cup. Cost = 1 * 2 = $2.
    const cost = _priceSubRecipeLine(
      { ingredient: 'lariat rub', qty: 16, unit: 'tbsp', yield_pct: 1.0, loss_factor: null },
      child,
    );
    assert.ok(cost.cost !== null);
    assert.ok(Math.abs(cost.cost - 2.0) < 0.0001, `got ${cost.cost}`);
    assert.equal(cost.reason, null);
  });

  it('handles identity units (line.unit == child.yield_unit)', () => {
    const child = { recipe_id: 'pickle_juice', yield: 2, yield_unit: 'cup', batch_cost: 6 };
    // 1 cup of pickle juice = $6/2 cup * 1 cup = $3
    const cost = _priceSubRecipeLine(
      { ingredient: 'pickle juice', qty: 1, unit: 'cup', yield_pct: 1.0, loss_factor: null },
      child,
    );
    assert.ok(Math.abs(cost.cost - 3.0) < 0.0001);
  });

  it('applies yield_pct/loss_factor', () => {
    const child = { recipe_id: 'rub', yield: 1, yield_unit: 'cup', batch_cost: 10 };
    // qty=1 cup * $10 * adj. yield 0.5, loss 0 -> adj = 1 / (0.5 * 1) = 2.
    const cost = _priceSubRecipeLine(
      { ingredient: 'rub', qty: 1, unit: 'cup', yield_pct: 0.5, loss_factor: null },
      child,
    );
    assert.ok(Math.abs(cost.cost - 20.0) < 0.0001, `got ${cost.cost}`);
  });
});

describe('rollupRecipeCosts — end-to-end batch_cost rewrite', () => {
  it('rolls up a parent that uses a sub-recipe and a vendor-priced leaf', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);

    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, master_id, location_id)
       VALUES ('OIL, CANOLA CLR FRY ZTF', 'shamrock', '1', 35, 'lb', 35, 1, 'canola_oil', ?)`,
    ).run(LOC);

    // parent consumes 1 cup lariat rub ($2) + 1 lb canola oil ($1) = $3.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, master_id, location_id)
       VALUES ('parent','lariat rub',1,'cup','YES','confirmed',1.0,NULL,NULL,?),
              ('parent','canola oil',1,'lb',NULL,'confirmed',1.0,NULL,'canola_oil',?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.updated, 1); // only parent was actually overwritten
    assert.deepEqual(result.cycles, []);

    const parent = db.prepare(
      `SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent' AND location_id=?`,
    ).get(LOC);
    assert.ok(Math.abs(parent.batch_cost - 3.0) < 0.001, `got ${parent.batch_cost}`);
    db.close();
  });

  it('converts cross-dim leaf lines inside a sub-recipe-bearing parent', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, master_id, location_id)
       VALUES ('diced onion', 'sysco', '11', 50, 'lb', 50, 1, NULL, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES ('diced onion', 0.56, 'seed')`,
    ).run();
    // parent = 1 cup lariat rub ($2) + 1 cup diced onion off a 50 lb sack.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','lariat rub',1,'cup','YES','confirmed',1.0,NULL,?),
              ('parent','diced onion',1,'cup',NULL,'confirmed',1.0,NULL,?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.updated, 1);
    const packCup = (50 * WEIGHT_TO_G.lb) / 0.56 / VOLUME_TO_ML.cup;
    const expected = 2.0 + (1 * 50 / packCup);
    const parent = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent'`).get();
    assert.ok(Math.abs(parent.batch_cost - expected) < 1e-6, `got ${parent.batch_cost}, expected ${expected}`);
    db.close();
  });

  it('flags a cross-dim leaf with no density inside a sub-recipe-bearing parent and skips it', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, master_id, location_id)
       VALUES ('mystery pulp', 'sysco', '12', 50, 'lb', 50, 1, NULL, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','lariat rub',1,'cup','YES','confirmed',1.0,NULL,?),
              ('parent','mystery pulp',1,'cup',NULL,NULL,1.0,NULL,?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    // Sub-recipe line still prices; the unconvertible leaf is flagged + skipped.
    const parent = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent'`).get();
    assert.ok(Math.abs(parent.batch_cost - 2.0) < 1e-9, `got ${parent.batch_cost}`);
    assert.ok(result.unconverted.some(
      (u) => u.recipe_id === 'parent' && u.ingredient === 'mystery pulp' && u.reason === 'no_density',
    ), `unconverted: ${JSON.stringify(result.unconverted)}`);
    const status = db.prepare(
      `SELECT map_status FROM bom_lines WHERE recipe_id='parent' AND ingredient='mystery pulp'`,
    ).get();
    assert.equal(status.map_status, 'NEEDS_DENSITY');
    db.close();
  });

  it('does NOT rewrite leaf-only recipes — their batch_cost is owned by the T4 baseline+delta path', () => {
    // Regression guard: rollup's _priceLeafLine is unit-naive (qty ×
    // pack_price / pack_size with no cup↔lb conversion). Letting it
    // rewrite recipes without sub-recipe lines clobbers the unit-converted
    // yield-delta math from scripts/ingest-costing.mjs (T4/T4.1) with
    // wrong numbers. Leaf-only recipes must keep their imported batch_cost.
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('soup','Soup',1,'qt',12.5,12.5,?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, master_id, location_id)
       VALUES ('diced onion', 'sysco', '2', 50, 'lb', 50, 1, NULL, ?)`,
    ).run(LOC);
    // 1 cup of diced onion priced off a 50 lb sack — cross-dim. The naive
    // leaf path would price this as 1 × $50/50 = $1 and overwrite $12.50.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('soup','diced onion',1,'cup',NULL,'confirmed',0.85,NULL,?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.updated, 0, 'leaf-only recipe must not be rewritten');
    const soup = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='soup'`).get();
    assert.equal(soup.batch_cost, 12.5);
    db.close();
  });

  it('skips cycle members and leaves their batch_cost untouched', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('a','A',1,'cup',99,99,?), ('b','B',1,'cup',88,88,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('a','b',0.5,'cup','YES','confirmed',?),
              ('b','a',0.5,'cup','YES','confirmed',?)`,
    ).run(LOC, LOC);

    rollupRecipeCosts(db, LOC);
    const a = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='a'`).get();
    const b = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='b'`).get();
    assert.equal(a.batch_cost, 99);
    assert.equal(b.batch_cost, 88);
    db.close();
  });

  it('records a NEEDS_DENSITY entry when sub-recipe units are cross-dimensional and no density is available', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('rub','Rub',4,'cup',8,2,?), ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','rub',1,'lb','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.unconverted.length, 1);
    assert.equal(result.unconverted[0].reason, 'no_density');
    assert.equal(result.unconverted[0].recipe_id, 'parent');

    const status = db.prepare(
      `SELECT map_status FROM bom_lines WHERE recipe_id='parent' AND ingredient='rub'`,
    ).get();
    assert.equal(status.map_status, 'NEEDS_DENSITY');
    db.close();
  });
});

describe('recomputeRecipeCosts — uses rollupRecipeCosts under the hood', () => {
  it('produces the same batch_cost values as a direct rollup call', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('child','Child',2,'cup',6,3,?), ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','child',1,'cup','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    recomputeRecipeCosts(db, LOC);
    const parent = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent'`).get();
    // 1 cup * $3/cup = $3
    assert.ok(Math.abs(parent.batch_cost - 3.0) < 0.001, `got ${parent.batch_cost}`);
    db.close();
  });
});

describe('computeCostVariance — sub-recipe fallback', () => {
  it("a recipe whose only unmatched lines are sub-recipes now gets an actual + variance_pct", () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('child','Child',2,'cup',6,3,?), ('parent','Parent',1,'cup',NULL,5,?)`,
    ).run(LOC, LOC);
    // Parent: 1 cup of child = $3. Theoretical = $5. Variance = (5-3)/5 = 40%.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','child',1,'cup','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    const v = computeCostVariance(db, LOC);
    const parent = v.rows.find((r) => r.recipe_id === 'parent');
    assert.ok(parent, 'parent should appear in variance rows');
    assert.equal(parent.excluded, false);
    assert.ok(parent.actual !== null, 'parent.actual should be non-null after sub-recipe fallback');
    assert.ok(Math.abs(parent.actual - 3.0) < 0.001, `got actual=${parent.actual}`);
    assert.ok(parent.variance_pct !== null);
    db.close();
  });
});
