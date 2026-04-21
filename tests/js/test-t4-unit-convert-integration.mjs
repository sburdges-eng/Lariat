#!/usr/bin/env node
// T4 acceptance — volume↔weight density conversion integrated into T3 post-pass.
// Run: node --experimental-strip-types --test tests/js/test-t4-unit-convert-integration.mjs
//
// Verifies scripts/ingest-costing.mjs converts vendor pack_size into the
// BOM line's unit (via lib/unitConvert.mjs + the ingredient_densities seed
// table) before computing the yield/loss delta, and flags rows as
// map_status='NEEDS_DENSITY' whenever the conversion cannot complete.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';
import { ingestCosting } from '../../scripts/ingest-costing.mjs';
import { WEIGHT_TO_G, VOLUME_TO_ML } from '../../lib/unitConvert.mjs';

const LOC = 'default';

/** Scratch DB with seeded yields + densities. */
function buildDb({ yields = [], densities = [] } = {}) {
  const db = new Database(':memory:');
  initSchema(db);
  if (yields.length > 0) {
    const ins = db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, loss_factor, source) VALUES (?, ?, ?, ?)',
    );
    for (const y of yields) {
      ins.run(normalizeIngredientKey(y.raw), y.yield_pct, y.loss_factor ?? null, y.source ?? 'seed');
    }
  }
  if (densities.length > 0) {
    const ins = db.prepare(
      'INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES (?, ?, ?)',
    );
    for (const d of densities) {
      ins.run(normalizeIngredientKey(d.raw), d.g_per_ml, d.source ?? 'seed');
    }
  }
  return db;
}

const recipe = (recipe_id, batch_cost, yieldVal = null) => ({
  recipe_id,
  recipe_name: recipe_id,
  batch_cost,
  yield: yieldVal,
  yield_unit: 'each',
});

const vendorPrice = (ingredient, pack_size, pack_unit, pack_price) => ({
  ingredient,
  vendor: 'sysco',
  sku: '',
  pack_size,
  pack_unit,
  pack_price,
  unit_price: null,
  category: null,
});

const readRecipe = (db, recipe_id) =>
  db.prepare('SELECT batch_cost FROM recipe_costs WHERE recipe_id = ? AND location_id = ?').get(recipe_id, LOC);

const readBomStatus = (db, recipe_id, ingredient) =>
  db
    .prepare('SELECT map_status FROM bom_lines WHERE recipe_id = ? AND ingredient = ? AND location_id = ?')
    .get(recipe_id, ingredient, LOC);

describe('T4 — cross-dim with density present', () => {
  it('cup × lb with density 0.56 g/ml converts pack_size and applies yield-delta correctly', () => {
    // 1 cup diced onion, vendor: 50 lb sack @ $50, yield 0.85, density 0.56.
    //   pack_size in bom unit (cup):
    //     50 lb × 453.59237 g/lb / 0.56 g/ml / 236.5882365 ml/cup
    //     = 171.306… cup
    //   delta = qty × pack_price / pack_size_in_cup × (1/0.85 − 1)
    const db = buildDb({
      yields: [{ raw: 'diced onion', yield_pct: 0.85, loss_factor: null }],
      densities: [{ raw: 'diced onion', g_per_ml: 0.56 }],
    });
    const data = {
      vendor_prices: [vendorPrice('diced onion', 50, 'lb', 50.0)],
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'diced onion', qty: 1, unit: 'cup', pack_price: 50.0, pack_size: 50 },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    const packCupEq = (50 * WEIGHT_TO_G.lb) / 0.56 / VOLUME_TO_ML.cup;
    const delta = (1 * 50.0 / packCupEq) * (1 / 0.85 - 1);
    const expected = 1.0 + delta;
    const r = readRecipe(db, 'r1');
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-6, `got ${r.batch_cost}, expected ${expected}`);
    assert.strictEqual(summary.bom_lines_needs_density, 0);
    // Sanity: with the conversion the delta ≠ the "raw" same-unit delta.
    const naive = 1 * 50.0 / 50 * (1 / 0.85 - 1);
    assert.notStrictEqual(Math.round(delta * 1e9), Math.round(naive * 1e9));
    db.close();
  });
});

describe('T4 — cross-dim MISSING density flags NEEDS_DENSITY', () => {
  it('cup × lb with no density row: delta=0 and map_status set', () => {
    const db = buildDb({
      yields: [{ raw: 'mystery pulp', yield_pct: 0.85, loss_factor: null }],
      // no density seeded
    });
    const data = {
      vendor_prices: [vendorPrice('mystery pulp', 50, 'lb', 50.0)],
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'mystery pulp', qty: 1, unit: 'cup', pack_price: 50.0, pack_size: 50 },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.strictEqual(r.batch_cost, 1.0, 'delta skipped → batch_cost unchanged');
    assert.strictEqual(summary.bom_lines_needs_density, 1);
    assert.strictEqual(readBomStatus(db, 'r1', 'mystery pulp').map_status, 'NEEDS_DENSITY');
    db.close();
  });
});

describe('T4 — same-dim weight × weight identity path', () => {
  it('lb × lb skips unit conversion and matches T3 baseline delta', () => {
    const db = buildDb({
      yields: [{ raw: 'ribeye steak', yield_pct: 0.88, loss_factor: 0.25 }],
    });
    const data = {
      vendor_prices: [vendorPrice('ribeye steak', 10, 'lb', 150.0)],
      recipe_costs: [recipe('r1', 15.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'ribeye steak', qty: 1, unit: 'lb', pack_price: 15.0, pack_size: 1 },
      ],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const expected = 15.0 + 1 * 15.0 / 1 * (1 / (0.88 * 0.75) - 1);
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9, `got ${r.batch_cost}, expected ${expected}`);
    db.close();
  });
});

describe('T4 — same-dim volume × volume', () => {
  it('cup × gal converts within the volume dimension (no density needed)', () => {
    // 1 cup water, vendor 1 gal @ $8. yield 1 → no delta. We instead stress
    // the conversion by setting yield < 1 so the delta is non-trivial but
    // uses only the volume factor table.
    const db = buildDb({
      yields: [{ raw: 'pickle brine', yield_pct: 0.9, loss_factor: null }],
    });
    const data = {
      vendor_prices: [vendorPrice('pickle brine', 1, 'gal', 8.0)],
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'pickle brine', qty: 2, unit: 'cup', pack_price: 8.0, pack_size: 1 },
      ],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    // 1 gal in cup = VOLUME_TO_ML.gal / VOLUME_TO_ML.cup = 16
    const packCup = VOLUME_TO_ML.gal / VOLUME_TO_ML.cup;
    const expected = 1.0 + (2 * 8.0 / packCup) * (1 / 0.9 - 1);
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9, `got ${r.batch_cost}, expected ${expected}`);
    assert.strictEqual(readBomStatus(db, 'r1', 'pickle brine').map_status, null);
    db.close();
  });
});

describe('T4 — count-unit BOM flags NEEDS_DENSITY', () => {
  it("bom unit 'ea' against vendor 'lb': conversion refused, delta=0, flagged", () => {
    const db = buildDb({
      yields: [{ raw: 'jalapeno', yield_pct: 0.9, loss_factor: null }],
      // Even with a plausible density seeded, count ↔ weight is out of scope.
      densities: [{ raw: 'jalapeno', g_per_ml: 0.9 }],
    });
    const data = {
      vendor_prices: [vendorPrice('jalapeno', 10, 'lb', 30.0)],
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'jalapeno', qty: 5, unit: 'ea', pack_price: 30.0, pack_size: 10 },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.strictEqual(r.batch_cost, 1.0);
    assert.strictEqual(summary.bom_lines_needs_density, 1);
    assert.strictEqual(readBomStatus(db, 'r1', 'jalapeno').map_status, 'NEEDS_DENSITY');
    db.close();
  });
});

describe('T4 — unknown unit flags NEEDS_DENSITY', () => {
  it('bom unit "#10 can" against vendor "lb" triggers the flag', () => {
    const db = buildDb({
      yields: [{ raw: 'tomato puree', yield_pct: 1.0, loss_factor: null }],
      densities: [{ raw: 'tomato puree', g_per_ml: 1.04 }],
    });
    const data = {
      vendor_prices: [vendorPrice('tomato puree', 25, 'lb', 30.0)],
      recipe_costs: [recipe('r1', 2.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'tomato puree', qty: 1, unit: '#10 can', pack_price: 30.0, pack_size: 25 },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    assert.strictEqual(summary.bom_lines_needs_density, 1);
    assert.strictEqual(readBomStatus(db, 'r1', 'tomato puree').map_status, 'NEEDS_DENSITY');
    db.close();
  });
});

describe('T4 — mixed recipe partially flagged', () => {
  it('3 BOM lines: 2 convert (cross-dim + same-dim) + 1 missing density; only the convertible ones contribute delta', () => {
    const db = buildDb({
      yields: [
        { raw: 'diced onion', yield_pct: 0.85, loss_factor: null },
        { raw: 'kosher salt', yield_pct: 1.0, loss_factor: null },
        { raw: 'exotic spice', yield_pct: 0.9, loss_factor: null },
      ],
      densities: [
        { raw: 'diced onion', g_per_ml: 0.56 },
        // kosher salt: not seeded but same-dim, no density needed.
        // exotic spice: no density seeded → should be flagged.
      ],
    });
    const data = {
      vendor_prices: [
        vendorPrice('diced onion', 50, 'lb', 50.0),
        vendorPrice('kosher salt', 3, 'lb', 33.0),
        vendorPrice('exotic spice', 1, 'lb', 120.0),
      ],
      recipe_costs: [recipe('r1', 10.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'diced onion', qty: 1, unit: 'cup', pack_price: 50.0, pack_size: 50 },   // cross-dim OK
        { recipe_id: 'r1', ingredient: 'kosher salt', qty: 2, unit: 'lb', pack_price: 33.0, pack_size: 3 },     // same-dim OK
        { recipe_id: 'r1', ingredient: 'exotic spice', qty: 1, unit: 'tsp', pack_price: 120.0, pack_size: 1 },  // missing density
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');

    const packCup = (50 * WEIGHT_TO_G.lb) / 0.56 / VOLUME_TO_ML.cup;
    const d1 = (1 * 50.0 / packCup) * (1 / 0.85 - 1);   // onion: non-zero
    const d2 = (2 * 33.0 / 3) * (1 / 1.0 - 1);           // salt: zero (yield=1)
    // d3 skipped due to missing density
    const expected = 10.0 + d1 + d2;
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-6, `got ${r.batch_cost}, expected ${expected}`);

    assert.strictEqual(summary.bom_lines_needs_density, 1);
    assert.strictEqual(readBomStatus(db, 'r1', 'exotic spice').map_status, 'NEEDS_DENSITY');
    assert.notStrictEqual(readBomStatus(db, 'r1', 'diced onion').map_status, 'NEEDS_DENSITY');
    assert.notStrictEqual(readBomStatus(db, 'r1', 'kosher salt').map_status, 'NEEDS_DENSITY');
    db.close();
  });
});

describe('T4 — summary counter accuracy', () => {
  it('bom_lines_needs_density matches the number of rows flagged in the DB', () => {
    const db = buildDb({
      yields: [
        { raw: 'apple', yield_pct: 0.9, loss_factor: null },
        { raw: 'banana', yield_pct: 0.9, loss_factor: null },
        { raw: 'cherry', yield_pct: 0.9, loss_factor: null },
      ],
      // No densities seeded — all three cup×lb rows must flag.
    });
    const data = {
      vendor_prices: [
        vendorPrice('apple', 10, 'lb', 20.0),
        vendorPrice('banana', 10, 'lb', 20.0),
        vendorPrice('cherry', 10, 'lb', 20.0),
      ],
      recipe_costs: [recipe('r1', 3.0)],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'apple',  qty: 1, unit: 'cup', pack_price: 20.0, pack_size: 10 },
        { recipe_id: 'r1', ingredient: 'banana', qty: 1, unit: 'cup', pack_price: 20.0, pack_size: 10 },
        { recipe_id: 'r1', ingredient: 'cherry', qty: 1, unit: 'cup', pack_price: 20.0, pack_size: 10 },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    const flagged = db.prepare(
      `SELECT COUNT(*) AS n FROM bom_lines WHERE location_id = ? AND map_status = 'NEEDS_DENSITY'`,
    ).get(LOC).n;
    assert.strictEqual(flagged, 3);
    assert.strictEqual(summary.bom_lines_needs_density, 3);
    db.close();
  });

  it('protected map_status values are NOT downgraded to NEEDS_DENSITY', () => {
    const db = buildDb({
      yields: [{ raw: 'curated item', yield_pct: 0.9, loss_factor: null }],
    });
    const data = {
      vendor_prices: [vendorPrice('curated item', 10, 'lb', 20.0)],
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [
        // map_status='confirmed' — operator-curated mapping. Cross-dim but
        // without density. We should NOT clobber the curator's flag.
        {
          recipe_id: 'r1',
          ingredient: 'curated item',
          qty: 1,
          unit: 'cup',
          pack_price: 20.0,
          pack_size: 10,
          map_status: 'confirmed',
        },
      ],
    };
    const summary = ingestCosting(db, data, LOC);
    assert.strictEqual(readBomStatus(db, 'r1', 'curated item').map_status, 'confirmed');
    assert.strictEqual(summary.bom_lines_needs_density, 0);
    db.close();
  });
});
