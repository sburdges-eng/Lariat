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
import { ingestCosting, runCostingPostPass } from '../../scripts/ingest-costing.mjs';

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

  it('NULL yield_pct and NULL loss_factor default to no-adjustment (both NULL)', () => {
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

  // D5 split (debt-bundle-b, docs/MAPPING_ENGINE_GAPS.md#D5): the
  // original collapsed "NULL yield + NULL loss" test above could mask a
  // broken single-field default (e.g. yield defaulting to 0 instead of
  // 1.0 while loss defaults correctly) with a compensating pass. These
  // two cases isolate each default so the failure mode is localised.
  it('NULL yield_pct + non-null loss_factor=0 defaults yield→1.0 (no-op)', () => {
    // ingredient_yields.yield_pct is schema-level NOT NULL, so the only
    // way to get a NULL yield on a BOM line is to skip the seed lookup
    // (ingest with no yield row) and then patch loss_factor onto the
    // resulting row, rerunning the post-pass. Re-entrance is safe: the
    // post-pass reads the current batch_cost as the starting value, and
    // with adj=1.0/(1.0 × (1 - 0)) = 1.0 the delta is zero regardless
    // of how many times it runs.
    const db = buildDb();
    const data = {
      recipe_costs: [recipe('r1', 50.0)],
      bom_lines: [bom('r1', 'only_loss', 5, 4, 1)], // raw = 20
    };
    ingestCosting(db, data, LOC);
    db.prepare(
      `UPDATE bom_lines SET yield_pct = NULL, loss_factor = 0.0
        WHERE recipe_id = ? AND location_id = ?`,
    ).run('r1', LOC);
    const before = readRecipe(db, 'r1').batch_cost;
    const p = runCostingPostPass(db, LOC);
    const r = readRecipe(db, 'r1');
    // adj = 1 / (1.0 × (1 - 0)) = 1.0 → zero delta, batch_cost unchanged.
    assert.strictEqual(r.batch_cost, before);
    assert.strictEqual(p.recipes_yield_adjusted, 0);
    db.close();
  });

  it('non-null yield_pct=1.0 + NULL loss_factor defaults loss→0.0 (no-op)', () => {
    const db = buildDb([
      { raw: 'only_yield', yield_pct: 1.0, loss_factor: null },
    ]);
    const data = {
      recipe_costs: [recipe('r1', 50.0)],
      bom_lines: [bom('r1', 'only_yield', 5, 4, 1)], // raw = 20
    };
    const s = ingestCosting(db, data, LOC);
    const r = readRecipe(db, 'r1');
    // adj = 1 / (1.0 × (1 - 0)) = 1.0 → zero delta, batch_cost unchanged.
    assert.strictEqual(r.batch_cost, 50.0);
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

// ── D5 (debt-bundle-b, docs/MAPPING_ENGINE_GAPS.md#D5) ─────────────
// Parameterized null-guard matrix. The code at
// `scripts/ingest-costing.mjs` (inside `runCostingPostPass`) guards
// null/zero/infinite qty, pack_price, and pack_size uniformly; the
// pre-D5 test file only exercised 2 of those 6 cells (pack_size=0 and
// pack_price=NULL). Each case seeds ONE bad BOM line alongside zero
// other lines so the recipe's entire delta reduces to guardSkipped
// without noise from compensating lines.
//
// Acceptance per case:
//   - batch_cost unchanged from the Excel-seeded value
//   - recipes_yield_adjusted === 0 (no per-recipe delta)
//   - the row was actually counted in guardSkipped (asserted indirectly
//     via console.warn output capture — a direct counter would require
//     exposing guardSkipped on the summary, which we keep out of the
//     public surface since it's noisy for healthy ingests)
describe('T3 / D5 — null-guard matrix', () => {
  const NULL_GUARD_CASES = [
    { field: 'qty',        value: null },
    { field: 'qty',        value: 0    },
    { field: 'pack_price', value: null },
    { field: 'pack_price', value: 0    },
    { field: 'pack_size',  value: null },
    { field: 'pack_size',  value: 0    },
  ];

  for (const { field, value } of NULL_GUARD_CASES) {
    const label = value === null ? 'NULL' : '0';
    it(`bom_line with ${field}=${label} contributes 0 delta (guard hit)`, () => {
      // Capture console.warn so we can assert the guard counter fired.
      // The post-pass emits a single warning line summarizing the run
      // when guardSkipped > 0, shape `⚠ N bom_line(s) had null/zero …`.
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (msg) => warnings.push(String(msg));

      try {
        const db = buildDb([
          { raw: 'ing', yield_pct: 0.85, loss_factor: null },
        ]);
        // Start from normal values (qty=1, pack_price=10, pack_size=5)
        // so the row would contribute a non-zero delta if NOT guarded;
        // then swap the tested field to the bad value.
        const packSize = field === 'pack_size' ? value : 5;
        const bomRow = bom('r1', 'ing', /*qty*/ 1, /*pack_price*/ 10, packSize);
        if (field === 'qty') bomRow.qty = value;
        if (field === 'pack_price') bomRow.pack_price = value;
        // pack_size already applied via packSize local.

        const data = {
          recipe_costs: [recipe('r1', 42.0)],
          bom_lines: [bomRow],
        };
        const s = ingestCosting(db, data, LOC);
        const r = readRecipe(db, 'r1');

        // Excel batch_cost unchanged.
        assert.strictEqual(
          r.batch_cost, 42.0,
          `${field}=${label}: batch_cost should match Excel seed ($42.00)`,
        );
        assert.strictEqual(
          s.recipes_yield_adjusted, 0,
          `${field}=${label}: no recipe should be yield-adjusted`,
        );
        assert.strictEqual(
          s.total_yield_delta_usd, 0,
          `${field}=${label}: total delta must be zero`,
        );

        // guard-warning surface — exactly one summary line emitted.
        const guardHits = warnings.filter(
          (w) => w.includes('null/zero qty, pack_price, or pack_size'),
        );
        assert.strictEqual(
          guardHits.length, 1,
          `${field}=${label}: expected exactly one guardSkipped warning, got ${guardHits.length}`,
        );
        assert.ok(
          /⚠ 1 bom_line/.test(guardHits[0]),
          `${field}=${label}: guard warning should report 1 skipped row, got: ${guardHits[0]}`,
        );

        db.close();
      } finally {
        console.warn = origWarn;
      }
    });
  }

  it('Infinity pack_price is guarded (Number.isFinite sweep)', () => {
    // Sanity-check the Number.isFinite leg of the uniform guard. Not one
    // of the 6 parameterized cells but sits on the same code path and
    // would be a regression surface if someone swapped `isFinite` for
    // a naive null-check.
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const db = buildDb([{ raw: 'ing', yield_pct: 0.85, loss_factor: null }]);
      const data = {
        recipe_costs: [recipe('r1', 42.0)],
        bom_lines: [bom('r1', 'ing', 1, Infinity, 5)],
      };
      const s = ingestCosting(db, data, LOC);
      assert.strictEqual(readRecipe(db, 'r1').batch_cost, 42.0);
      assert.strictEqual(s.recipes_yield_adjusted, 0);
      assert.ok(
        warnings.some((w) => w.includes('null/zero qty, pack_price, or pack_size')),
        'Infinity should hit the uniform guard and emit the summary warning',
      );
      db.close();
    } finally {
      console.warn = origWarn;
    }
  });
});

// ── D4 (debt-bundle-b, docs/MAPPING_ENGINE_GAPS.md#D4) ─────────────
// Excel batch_cost vs raw-sum drift. Deliberately seeds a recipe whose
// Excel-sourced batch_cost diverges from Σ (qty × pack_price /
// pack_size) by more than the $0.10 threshold, and asserts both (a)
// the excel_drift_warnings counter increments by the expected amount
// and (b) the console.info line fires with the expected shape.
//
// Why this doesn't break other tests: the existing yield-math tests
// all seed batch_cost === Σ (qty × pack_price / pack_size) up-front —
// e.g. the mixed-recipe test computes `initialExcel = raw1 + raw2 +
// raw3` and passes that into recipe(). Those rows have drift ≤ EPS so
// no INFO line fires; excel_drift_warnings stays at 0, which existing
// tests don't inspect anyway.
describe('T3 / D4 — Excel batch_cost vs raw-sum drift', () => {
  it('drift > $0.10 increments excel_drift_warnings counter and logs WARN', () => {
    // Row raw = 1 × 50 / 50 = $1.00; seed batch_cost at $5.00 → drift $4.00.
    const warnLines = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnLines.push(String(msg));
    try {
      const db = buildDb([
        { raw: 'onion', yield_pct: 1.0, loss_factor: null },
      ]);
      const data = {
        recipe_costs: [recipe('r_drift', 5.0)],
        bom_lines: [bom('r_drift', 'onion', 1, 50, 50)],
      };
      const s = ingestCosting(db, data, LOC);
      assert.strictEqual(
        s.excel_drift_warnings, 1,
        'one recipe should trip the drift counter',
      );
      const driftLine = warnLines.find((l) => l.includes('D4 Excel drift'));
      assert.ok(driftLine, `expected WARN line containing "D4 Excel drift"; got: ${JSON.stringify(warnLines)}`);
      assert.ok(driftLine.includes('recipe_id=r_drift'), driftLine);
      assert.ok(driftLine.includes('excel_value=$5.0000'), driftLine);
      assert.ok(driftLine.includes('computed_sum=$1.0000'), driftLine);
      assert.ok(driftLine.includes('drift_usd=$4.0000'), driftLine);
      assert.ok(
        driftLine.includes('docs/audit/2026-05-08-codebase-audit.md'),
        `WARN line must reference the audit doc; got: ${driftLine}`,
      );
      db.close();
    } finally {
      console.warn = origWarn;
    }
  });

  it('drift under threshold ($0.05 < $0.10) does NOT trip', () => {
    // Float arithmetic precludes a clean "exactly $0.10" fixture
    // (1.10 - 1.00 → 0.10000000000000009), so pin well under the
    // threshold to exercise the "noise-floor" branch. The strict-greater
    // semantics are documented on the DRIFT_THRESHOLD_USD constant in
    // ingest-costing.mjs; the key invariant tested here is that small
    // penny-level rounding doesn't trigger a spurious WARN line per
    // ingest.
    const warnLines = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnLines.push(String(msg));
    try {
      // Raw sum = 1, excel = 1.05 → drift $0.05.
      const db = buildDb([
        { raw: 'onion', yield_pct: 1.0, loss_factor: null },
      ]);
      const data = {
        recipe_costs: [recipe('r_edge', 1.05)],
        bom_lines: [bom('r_edge', 'onion', 1, 50, 50)],
      };
      const s = ingestCosting(db, data, LOC);
      assert.strictEqual(s.excel_drift_warnings, 0, 'sub-threshold drift must not fire');
      assert.ok(
        !warnLines.some((l) => l.includes('D4 Excel drift')),
        'no WARN line for sub-threshold drift',
      );
      db.close();
    } finally {
      console.warn = origWarn;
    }
  });

  it('healthy recipe (excel === raw-sum) does not trip the counter', () => {
    // Regression guard: the mixed-recipe test pattern should NEVER fire.
    const warnLines = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnLines.push(String(msg));
    try {
      const db = buildDb([
        { raw: 'onion',   yield_pct: 0.85, loss_factor: null },
        { raw: 'water',   yield_pct: 1.0,  loss_factor: null },
      ]);
      const raw1 = 1 * 50 / 50;
      const raw2 = 1 * 2 / 1;
      const excel = raw1 + raw2; // Excel matches raw sum byte-exact.
      const data = {
        recipe_costs: [recipe('r_ok', excel)],
        bom_lines: [
          bom('r_ok', 'onion', 1, 50, 50),
          bom('r_ok', 'water', 1, 2, 1),
        ],
      };
      const s = ingestCosting(db, data, LOC);
      assert.strictEqual(s.excel_drift_warnings, 0);
      assert.ok(
        !warnLines.some((l) => l.includes('D4 Excel drift')),
        'healthy recipe must not emit the drift WARN line',
      );
      db.close();
    } finally {
      console.warn = origWarn;
    }
  });

  it('negative drift (excel < raw-sum) also trips the counter', () => {
    // Excel $1.00, raw sum $5.00 → drift −$4.00, |drift|=$4 > $0.10.
    const warnLines = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnLines.push(String(msg));
    try {
      const db = buildDb([
        { raw: 'onion', yield_pct: 1.0, loss_factor: null },
      ]);
      const data = {
        recipe_costs: [recipe('r_neg', 1.0)],
        bom_lines: [bom('r_neg', 'onion', 1, 50, 10)], // raw = 5.00
      };
      const s = ingestCosting(db, data, LOC);
      assert.strictEqual(s.excel_drift_warnings, 1);
      const line = warnLines.find((l) => l.includes('D4 Excel drift'));
      assert.ok(line);
      assert.ok(line.includes('drift_usd=$-4.0000'), line);
      db.close();
    } finally {
      console.warn = origWarn;
    }
  });
});
