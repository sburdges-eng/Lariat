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
} from '../../lib/computeEngine/rollupRecipeCosts.ts';
import { deriveMasterId } from '../../scripts/ingest-costing.mjs';

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
    const cost = _priceLeafLine(db, LOC, line);
    // 2 lb * (38.01 / 35) = 2 * 1.086 = 2.172
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost - 2.172) < 0.001, `got ${cost}`);

    db.close();
  });

  it('returns null when no vendor_prices row matches', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const cost = _priceLeafLine(db, LOC, {
      ingredient: 'asafoetida',
      qty: 0.01,
      unit: 'lb',
      master_id: null,
      yield_pct: 1.0,
      loss_factor: null,
    });
    assert.equal(cost, null);
    db.close();
  });
});
