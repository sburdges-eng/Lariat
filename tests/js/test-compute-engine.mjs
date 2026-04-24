#!/usr/bin/env node
// Compute-engine regression pins — C1..C4 + R2-C5 + I2 + I4 from
// docs/COMPUTE_ENGINE_REVIEW.md (now deleted; pins live here).
//
// The compute engine (lib/computeEngine/*) orchestrates three on-demand
// recomputes against live vendor_prices / bom_lines / sales_lines:
//
//   1. recomputeRecipeCosts       → UPDATE recipe_costs.batch_cost
//   2. recomputeMarginAnalysis    → INSERT margin_snapshots
//   3. computeAccountingVariance  → INSERT accounting_variance
//
// Each recompute used to have its own ingredient→price resolver. That
// produced divergent costs vs. the T7/D6 costingBenchmarks path. These
// tests pin the unified resolver behavior + the fixes the review
// called out so regressions fail loudly.
//
// Run: node --experimental-strip-types --test tests/js/test-compute-engine.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-compute-engine-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// Seed a PIN so the middleware gate is "on" during the sensitive-path
// check below; route modules read process.env at import time so this
// must be set before the dynamic imports below resolve.
const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

const dbMod = await import('../../lib/db.ts');
dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

const {
  recomputeRecipeCosts,
  computeAccountingVariance,
  triggerComputeEngine,
} = await import('../../lib/computeEngine/index.ts');
const { computeSandboxCost } = await import(
  '../../lib/computeEngine/sandboxCosting.ts'
);

// middleware.js imports next/server (Next.js internal module) which
// doesn't resolve under raw node:test — read the file as text and
// assert on its matcher list instead.
const middlewareSource = fs.readFileSync(
  new URL('../../middleware.js', import.meta.url),
  'utf8',
);

const LOC = 'default';

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

// ── Seed helpers ──────────────────────────────────────────────────

function resetTables() {
  testDb.exec(`
    DELETE FROM vendor_prices;
    DELETE FROM bom_lines;
    DELETE FROM recipe_costs;
    DELETE FROM sales_lines;
    DELETE FROM spend_monthly;
    DELETE FROM ingredient_densities;
    DELETE FROM margin_snapshots;
    DELETE FROM accounting_variance;
    DELETE FROM ingredient_masters;
  `);
}

function seedRecipe(recipe_id, yield_units, cost_per_yield_unit = null, recipe_name = null) {
  testDb.prepare(`
    INSERT INTO recipe_costs (recipe_id, recipe_name, yield, cost_per_yield_unit,
                              batch_cost, location_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    recipe_id,
    recipe_name ?? recipe_id,
    yield_units,
    cost_per_yield_unit,
    cost_per_yield_unit != null ? cost_per_yield_unit * yield_units : null,
    LOC,
  );
}

function seedBom(recipe_id, ingredient, qty, unit = 'lb', yield_pct = 1.0, loss_factor = 0.0) {
  testDb.prepare(`
    INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, yield_pct, loss_factor, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(recipe_id, ingredient, qty, unit, yield_pct, loss_factor, LOC);
}

function seedVendorPrice(ingredient, pack_price, pack_size, pack_unit, importedAt, vendor = 'Sysco') {
  testDb.prepare(`
    INSERT INTO vendor_prices (ingredient, vendor, pack_price, pack_size, pack_unit,
                               yield_pct, location_id, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ingredient, vendor, pack_price, pack_size, pack_unit, 1.0, LOC, importedAt);
}

// ─────────────────────────────────────────────────────────────────
// C1 — latest-vendor-price is actually the latest (determinism)
// ─────────────────────────────────────────────────────────────────

describe('C1 · recomputeRecipeCosts picks the latest vendor_prices row deterministically', () => {
  beforeEach(resetTables);

  it('when two rows exist for the same ingredient, the later imported_at wins', () => {
    // Seed recipe: 1 lb of flour per batch, batch yields 10 servings.
    // cost_per_yield_unit must be non-null for computeCostVariance to
    // consider the recipe (cost_per_yield_unit IS NOT NULL is its gate);
    // we pick a placeholder that the recompute will overwrite.
    seedRecipe('R1', 10, 99.0);
    seedBom('R1', 'flour', 1, 'lb');

    // Older price: $2/lb. Newer price: $3/lb (should win).
    seedVendorPrice('flour', 2.0, 1.0, 'lb', '2026-01-01T00:00:00Z');
    seedVendorPrice('flour', 3.0, 1.0, 'lb', '2026-04-01T00:00:00Z');

    recomputeRecipeCosts(testDb, LOC);

    const row = testDb.prepare(
      `SELECT batch_cost, cost_per_yield_unit FROM recipe_costs WHERE recipe_id = ?`,
    ).get('R1');
    // Expected: actual = 1 * 3.0 / 1.0 / 1.0 (qty × price / pack_size / yield_pct)
    //          per serving = 3.0 / 10 = 0.3
    //          batch_cost  = 3.0
    assert.equal(Math.round(row.cost_per_yield_unit * 1000) / 1000, 0.3);
    assert.equal(Math.round(row.batch_cost * 1000) / 1000, 3.0);
  });

  it('ties on imported_at break by id DESC (latest inserted wins)', () => {
    seedRecipe('R2', 5, 99.0);
    seedBom('R2', 'oil', 1, 'lb');

    // Same imported_at, different prices. Second INSERT has higher id.
    seedVendorPrice('oil', 4.0, 1.0, 'lb', '2026-04-01T00:00:00Z');
    seedVendorPrice('oil', 5.0, 1.0, 'lb', '2026-04-01T00:00:00Z');

    recomputeRecipeCosts(testDb, LOC);
    const row = testDb.prepare(
      `SELECT cost_per_yield_unit FROM recipe_costs WHERE recipe_id = ?`,
    ).get('R2');
    assert.equal(Math.round(row.cost_per_yield_unit * 1000) / 1000, 1.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// C2 — accountingVariance theoretical uses cost_per_yield_unit
// ─────────────────────────────────────────────────────────────────

describe('C2 · computeAccountingVariance multiplies quantity_sold × cost_per_yield_unit', () => {
  beforeEach(resetTables);

  it('theoretical = 10 servings * $1.50/serving = $15 (NOT batch_cost * 10)', () => {
    // batch_cost = $15 (whole batch yields 10 servings) → per-serving = $1.50
    seedRecipe('Burger', 10, 1.5, 'Burger');
    testDb.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('apr', 'Burger', 10, 120, LOC);

    computeAccountingVariance(testDb, LOC, { period_start: '2026-04-01', period_end: '2026-04-30' });
    const row = testDb.prepare(
      `SELECT theoretical_cogs, actual_cogs, period_start, period_end
         FROM accounting_variance WHERE location_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(LOC);
    // If we had mistakenly used batch_cost=15 we'd get 150.
    assert.equal(row.theoretical_cogs, 15);
    assert.equal(row.period_start, '2026-04-01');
    assert.equal(row.period_end, '2026-04-30');
  });
});

// ─────────────────────────────────────────────────────────────────
// C3 — spend_monthly is window-filtered AND period is persisted
// ─────────────────────────────────────────────────────────────────

describe('C3 · computeAccountingVariance windows spend_monthly', () => {
  beforeEach(resetTables);

  it('only spend_monthly months within [period_start, period_end] contribute', () => {
    // Three months of spend, 1000 each.
    testDb.prepare(
      `INSERT INTO spend_monthly (month, shamrock_total_spend, location_id) VALUES
         ('2026-02', 1000, ?), ('2026-03', 1000, ?), ('2026-04', 1000, ?)`,
    ).run(LOC, LOC, LOC);

    computeAccountingVariance(testDb, LOC, {
      period_start: '2026-03-01',
      period_end: '2026-04-30',
    });

    const row = testDb.prepare(
      `SELECT actual_cogs, period_start, period_end
         FROM accounting_variance WHERE location_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(LOC);
    // February is outside the window → 2000, not 3000.
    assert.equal(row.actual_cogs, 2000);
    assert.equal(row.period_start, '2026-03-01');
    assert.equal(row.period_end, '2026-04-30');
  });

  it('default window covers current calendar month', () => {
    // We don't pin the exact window (depends on when the test runs),
    // but we can pin that period_start / period_end are populated.
    computeAccountingVariance(testDb, LOC);
    const row = testDb.prepare(
      `SELECT period_start, period_end
         FROM accounting_variance WHERE location_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(LOC);
    assert.match(row.period_start, /^\d{4}-\d{2}-01$/);
    assert.match(row.period_end, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────
// C4 — the SAME batch cost emerges from both paths (unified resolver)
// ─────────────────────────────────────────────────────────────────

describe('C4 · recomputeRecipeCosts and computeCostVariance agree on actual batch cost', () => {
  beforeEach(resetTables);

  it('round-trip: write via compute engine, read via T9 benchmarks — no divergence', async () => {
    const { computeCostVariance } = await import('../../lib/costingBenchmarks.mjs');

    seedRecipe('Chili', 8, 2.0); // baseline cost_per_yield_unit=2.0
    seedBom('Chili', 'bean', 1, 'lb');
    seedBom('Chili', 'beef', 2, 'lb');
    seedVendorPrice('bean', 4.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    seedVendorPrice('beef', 6.0, 1.0, 'lb', '2026-04-10T00:00:00Z');

    // Variance before refresh: theoretical=2.0, actual=(1*4 + 2*6)/8 = 2.0 → 0% variance
    const before = computeCostVariance(testDb, LOC);
    const chiliBefore = before.rows.find((r) => r.recipe_id === 'Chili');
    assert.equal(chiliBefore.actual, 2);

    recomputeRecipeCosts(testDb, LOC);

    // After: recipe_costs now reflects the exact same `actual` value.
    const after = testDb.prepare(
      `SELECT batch_cost, cost_per_yield_unit FROM recipe_costs WHERE recipe_id = ?`,
    ).get('Chili');
    assert.equal(Math.round(after.cost_per_yield_unit * 1000) / 1000, 2);
    assert.equal(Math.round(after.batch_cost * 1000) / 1000, 16);
  });
});

// ─────────────────────────────────────────────────────────────────
// R2-C5 — sandbox costing refuses cross-dim without density
// ─────────────────────────────────────────────────────────────────

describe('R2-C5 · computeSandboxCost refuses cross-dim conversion when density missing', () => {
  beforeEach(resetTables);

  it('1 cup of flour vs vendor by lb: cost=null, note mentions density', () => {
    seedVendorPrice('flour', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [{ item: 'flour', qty: 1, unit: 'cup' }]);
    const line = result.breakdown[0];
    assert.equal(line.cost, null);
    assert.match(line.note, /density|cross-dim/i);
    assert.equal(result.partial, true);
    assert.equal(result.totalCost, 0);
  });

  it('with a density row seeded, the same cross-dim call succeeds', () => {
    seedVendorPrice('flour', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    testDb.prepare(
      `INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source)
       VALUES (?, ?, 'seed')`,
    ).run('flour', 0.53);
    const result = computeSandboxCost(LOC, [{ item: 'flour', qty: 1, unit: 'cup' }]);
    assert.notEqual(result.breakdown[0].cost, null);
    assert.equal(result.partial, false);
  });

  it('same-dimension conversion needs no density', () => {
    seedVendorPrice('beef', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [{ item: 'beef', qty: 8, unit: 'oz' }]);
    // 8 oz = 0.5 lb → 0.5 × $10 = $5.00 (within float tolerance).
    assert.ok(
      Math.abs(result.breakdown[0].cost - 5) < 0.001,
      `expected ~5, got ${result.breakdown[0].cost}`,
    );
    assert.equal(result.partial, false);
  });
});

// ─────────────────────────────────────────────────────────────────
// I2 — retention DELETEs older snapshots per location
// ─────────────────────────────────────────────────────────────────

describe('I2 · triggerComputeEngine prunes old snapshot rows', () => {
  beforeEach(resetTables);

  it('retainPerLocation = 2 leaves at most 2 accounting_variance rows per location', () => {
    // First call → 1 row.
    triggerComputeEngine(LOC, { retainPerLocation: 2 });
    // Second call → 2 rows.
    triggerComputeEngine(LOC, { retainPerLocation: 2 });
    // Third call → 3 inserted but retention trims to 2.
    triggerComputeEngine(LOC, { retainPerLocation: 2 });

    const n = testDb.prepare(
      `SELECT COUNT(*) AS c FROM accounting_variance WHERE location_id = ?`,
    ).get(LOC).c;
    assert.equal(n, 2);
  });

  it('retainPerLocation = 0 disables pruning', () => {
    triggerComputeEngine(LOC, { retainPerLocation: 0 });
    triggerComputeEngine(LOC, { retainPerLocation: 0 });
    const n = testDb.prepare(
      `SELECT COUNT(*) AS c FROM accounting_variance WHERE location_id = ?`,
    ).get(LOC).c;
    assert.equal(n, 2);
  });
});

// ─────────────────────────────────────────────────────────────────
// I4 — /api/compute is in the PIN-gated sensitive prefix list
// ─────────────────────────────────────────────────────────────────

describe('I4 · middleware gates /api/compute when LARIAT_PIN is set', () => {
  it('middleware.js SENSITIVE_PREFIXES includes /api/compute', () => {
    assert.match(middlewareSource, /['"]\/api\/compute['"]/,
      "middleware.js SENSITIVE_PREFIXES must list '/api/compute'");
  });

  it('middleware.js config.matcher includes /api/compute/:path*', () => {
    // If /api/compute/* is missing from this list, Next.js won't even
    // invoke the middleware on compute routes, and the PIN gate is
    // silently bypassed.
    assert.match(middlewareSource, /['"]\/api\/compute\/:path\*['"]/,
      "middleware.js config.matcher must list '/api/compute/:path*'");
  });
});
