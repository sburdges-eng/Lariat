#!/usr/bin/env node
// T3 acceptance — yield + loss applied in costing math.
// Run: node --experimental-strip-types --test tests/js/test-ingest-costing-yield-math.mjs
//
// Verifies the post-INSERT pass inside ingestCosting() adjusts
// recipe_costs.batch_cost by summing per-BOM-line deltas of the form
//   delta = bom_qty × pack_price / pack_size × (1/(yield_pct × (1 − loss_factor)) − 1)
// NULL yield_pct → 1.0 (no trim), NULL loss_factor → 0.0 (no shrinkage), and
// recipes whose every line has yield=1/loss=0 keep Excel's batch_cost byte-exact
// (zero-regression invariant).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';
import { ingestCosting } from '../../scripts/ingest-costing.mjs';

const LOC = 'default';
const EPS = 1e-9;

/**
 * Build a scratch DB with the given ingredient_yields seed rows.
 * @param {Array<{raw: string, yield_pct: number, loss_factor: number | null, source?: string}>} yields
 */
function buildDb(yields = []) {
  const db = new Database(':memory:');
  initSchema(db);
  if (yields.length > 0) {
    const ins = db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, loss_factor, source) VALUES (?, ?, ?, ?)',
    );
    for (const y of yields) {
      ins.run(normalizeIngredientKey(y.raw), y.yield_pct, y.loss_factor, y.source ?? 'seed');
    }
  }
  return db;
}

/** Shape a recipe_cost payload row. */
const recipe = (recipe_id, batch_cost, yieldVal = null, yield_unit = 'each') => ({
  recipe_id,
  recipe_name: recipe_id,
  batch_cost,
  yield: yieldVal,
  yield_unit,
});

/** Shape a BOM line payload row. */
const bom = (recipe_id, ingredient, qty, pack_price, pack_size, overrides = {}) => ({
  recipe_id,
  ingredient,
  qty,
  unit: 'lb',
  pack_price,
  pack_size,
  ...overrides,
});

const readRecipe = (db, recipe_id) =>
  db.prepare('SELECT batch_cost, cost_per_yield_unit, yield FROM recipe_costs WHERE recipe_id = ? AND location_id = ?').get(recipe_id, LOC);

describe('T3 — zero-regression invariant', () => {
  it('recipe with all yield=1.0, loss=0 keeps Excel batch_cost byte-exact', () => {
    const db = buildDb([
      { raw: 'water', yield_pct: 1.0, loss_factor: null },
      { raw: 'salt',  yield_pct: 1.0, loss_factor: null },
      { raw: 'oil',   yield_pct: 1.0, loss_factor: 0.0 },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 100.0)],
      bom_lines: [
        bom('r1', 'water', 10, 2, 1),  // raw = 20
        bom('r1', 'salt', 5, 4, 1),    // raw = 20
        bom('r1', 'oil', 2, 30, 1),    // raw = 60
      ],
    };
    const s = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.strictEqual(r.batch_cost, 100.0);
    assert.strictEqual(s.recipes_yield_adjusted, 0);
    assert.strictEqual(s.total_yield_delta_usd, 0);
    db.close();
  });

  it('NULL yield_pct and NULL loss_factor default to no-adjustment', () => {
    // No ingredient_yields seeded at all → every bom_line gets NULL yield/loss.
    const db = buildDb();
    const data = {
      recipe_costs: [recipe('r1', 100.0)],
      bom_lines: [
        bom('r1', 'unmapped_a', 10, 2, 1),
        bom('r1', 'unmapped_b', 5, 4, 1),
        bom('r1', 'unmapped_c', 2, 30, 1),
      ],
    };
    const s = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.strictEqual(r.batch_cost, 100.0, 'NULL must default to 1.0 / 0.0, not 0');
    assert.strictEqual(s.recipes_yield_adjusted, 0);
    db.close();
  });
});

describe('T3 — math correctness', () => {
  it('single line at yield=0.85 → batch_cost = 1 × 50/50 × (1/0.85) ≈ $1.1765', () => {
    const db = buildDb([
      { raw: 'diced onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [bom('r1', 'diced onion', 1, 50, 50)],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const expected = 1 * 50 / 50 * (1 / 0.85);
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-3, `got ${r.batch_cost}, expected ${expected}`);
    db.close();
  });

  it('plan canonical: 1 lb diced onion / 50-lb sack @ $50 / yield 0.85 → delta = $0.1765', () => {
    const db = buildDb([
      { raw: 'diced onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [bom('r1', 'diced onion', 1, 50, 50)],
    };
    const s = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const expectedDelta = 1 * 50 / 50 * (1 / 0.85 - 1); // ≈ 0.17647
    // Plan asserts "within 0.01 of expected" for the fixture; also check delta sum.
    assert.ok(Math.abs(r.batch_cost - (1.0 + expectedDelta)) < 1e-6);
    assert.ok(Math.abs(s.total_yield_delta_usd - 0.18) < 0.01, `rounded delta ≈ $0.18, got $${s.total_yield_delta_usd}`);
    db.close();
  });

  it('cooking shrinkage only: yield=1.0, loss=0.25 → adj = 1/0.75 ≈ 1.333', () => {
    const db = buildDb([
      { raw: 'chicken thigh', yield_pct: 1.0, loss_factor: 0.25 },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 10.0)],
      bom_lines: [bom('r1', 'chicken thigh', 1, 10, 1)], // raw = 10
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const expected = 10 + 1 * 10 / 1 * (1 / (1.0 * 0.75) - 1); // 10 + 3.333…
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9, `got ${r.batch_cost}, expected ${expected}`);
    db.close();
  });

  it('ribeye with trim + shrinkage: yield=0.88, loss=0.25 → adj = 1/(0.88×0.75) ≈ 1.5152', () => {
    const db = buildDb([
      { raw: 'ribeye steak', yield_pct: 0.88, loss_factor: 0.25 },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 15.0)],
      bom_lines: [bom('r1', 'ribeye steak', 1, 15, 1)], // raw = 15
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const adj = 1 / (0.88 * 0.75);
    const expected = 15 + 1 * 15 / 1 * (adj - 1);
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9);
    db.close();
  });

  it('mixed recipe: 3 lines with different yield/loss — deltas sum per-recipe', () => {
    const db = buildDb([
      { raw: 'onion',   yield_pct: 0.85, loss_factor: null },
      { raw: 'water',   yield_pct: 1.0,  loss_factor: null },
      { raw: 'brisket', yield_pct: 0.50, loss_factor: 0.25 },
    ]);
    const raw1 = 1 * 50 / 50;   // onion: raw = 1
    const raw2 = 1 * 2 / 1;     // water: raw = 2
    const raw3 = 1 * 100 / 1;   // brisket: raw = 100
    const initialExcel = raw1 + raw2 + raw3; // 103
    const data = {
      recipe_costs: [recipe('r1', initialExcel)],
      bom_lines: [
        bom('r1', 'onion',   1, 50, 50),
        bom('r1', 'water',   1, 2, 1),
        bom('r1', 'brisket', 1, 100, 1),
      ],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const d1 = raw1 * (1 / 0.85 - 1);
    const d2 = raw2 * (1 / 1.0 - 1);   // = 0
    const d3 = raw3 * (1 / (0.5 * 0.75) - 1);
    const expected = initialExcel + d1 + d2 + d3;
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9, `got ${r.batch_cost}, expected ${expected}`);
    db.close();
  });
});

describe('T3 — cost_per_yield_unit', () => {
  it('recomputed as new_batch_cost / yield when yield is set', () => {
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0, /*yield=*/4)],
      bom_lines: [bom('r1', 'onion', 1, 50, 50)],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    const expectedBatch = 1 * 50 / 50 * (1 / 0.85);
    const expectedCpu = expectedBatch / 4;
    assert.ok(Math.abs(r.cost_per_yield_unit - expectedCpu) < 1e-6);
    db.close();
  });

  it('NULL recipe yield → batch_cost still updated; cost_per_yield_unit stays NULL', () => {
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0, /*yield=*/null)],
      bom_lines: [bom('r1', 'onion', 1, 50, 50)],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.ok(r.batch_cost > 1.0, 'batch_cost should have increased');
    assert.strictEqual(r.cost_per_yield_unit, null);
    db.close();
  });
});

describe('T3 — edge-case guards', () => {
  it('bom_line with pack_size=0 contributes 0 delta (no divide-by-zero crash)', () => {
    const db = buildDb([
      { raw: 'bad', yield_pct: 0.85, loss_factor: null },
      { raw: 'good', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 10.0)],
      bom_lines: [
        bom('r1', 'bad', 1, 50, 0),     // guarded → 0 delta
        bom('r1', 'good', 1, 50, 50),   // raw 1, delta = 1 × (1/0.85 − 1)
      ],
    };
    assert.doesNotThrow(() => ingestCosting(db, data, LOC));
    const r = readRecipe(db, 'r1');
    const expected = 10.0 + 1 * (1 / 0.85 - 1);
    assert.ok(Math.abs(r.batch_cost - expected) < 1e-9);
    db.close();
  });

  it('bom_line with NULL pack_price contributes 0 delta', () => {
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 5.0)],
      bom_lines: [bom('r1', 'onion', 1, null, 50)],
    };
    ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    assert.strictEqual(r.batch_cost, 5.0);
    db.close();
  });
});

describe('T3 — summary counters', () => {
  it('recipes_yield_adjusted counts only recipes with non-zero delta', () => {
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
      { raw: 'water', yield_pct: 1.0,  loss_factor: null },
    ]);
    const data = {
      recipe_costs: [
        recipe('r_adj',   1.0),
        recipe('r_noop',  2.0),
        recipe('r_empty', 3.0),
      ],
      bom_lines: [
        bom('r_adj',  'onion', 1, 50, 50),  // delta ≠ 0
        bom('r_noop', 'water', 1, 2, 1),    // delta == 0 (yield = 1.0)
        // r_empty has no BOM lines
      ],
    };
    const s = ingestCosting(db, data, LOC);
    assert.strictEqual(s.recipes_yield_adjusted, 1, 'only r_adj gets updated');
    const expectedDeltaCents = Math.round((1 * 50 / 50 * (1 / 0.85 - 1)) * 100);
    assert.strictEqual(Math.round(s.total_yield_delta_usd * 100), expectedDeltaCents);
    // Verify the no-op recipe is byte-exact unchanged.
    assert.strictEqual(readRecipe(db, 'r_noop').batch_cost, 2.0);
    assert.strictEqual(readRecipe(db, 'r_empty').batch_cost, 3.0);
    db.close();
  });

  it('total_yield_delta_usd is rounded to 2 decimal places', () => {
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [bom('r1', 'onion', 1, 50, 50)],
    };
    const s = ingestCosting(db, data, LOC);
    // 0.17647… rounds to 0.18
    assert.strictEqual(s.total_yield_delta_usd, 0.18);
    db.close();
  });
});

describe('T3 — idempotency across back-to-back ingests', () => {
  it('running ingestCosting twice with the same payload does NOT double-apply delta', () => {
    // The DELETE+INSERT sweep reinserts Excel's raw batch_cost before the T3
    // pass every time, so the final batch_cost must match after both runs.
    const db = buildDb([
      { raw: 'onion', yield_pct: 0.85, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 1.0)],
      bom_lines: [bom('r1', 'onion', 1, 50, 50)],
    };
    ingestCosting(db, data, LOC);
    const firstBatch = readRecipe(db, 'r1').batch_cost;

    ingestCosting(db, data, LOC);
    const secondBatch = readRecipe(db, 'r1').batch_cost;

    assert.strictEqual(firstBatch, secondBatch, 'second ingest must yield identical batch_cost');
    const expected = 1.0 + 1 * 50 / 50 * (1 / 0.85 - 1);
    assert.ok(Math.abs(secondBatch - expected) < 1e-9);
    db.close();
  });
});
