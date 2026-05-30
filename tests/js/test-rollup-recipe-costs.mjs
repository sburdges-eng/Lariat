#!/usr/bin/env node
// Tests for the sub-recipe pricing rollup pass.
// Run: node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { rollupRecipeCosts } from '../../lib/computeEngine/rollupRecipeCosts.ts';
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
