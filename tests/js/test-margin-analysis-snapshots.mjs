#!/usr/bin/env node
// Regression pin for docs/audit/2026-05-08-codebase-audit.md §4 (Compute,
// MEDIUM): `recomputeMarginAnalysis` previously dropped rows where
// `quadrant === 'unknown'` or `margin_pct === null` via the if-guard
// at lib/computeEngine/marginAnalysis.ts:22. Dishes with no costing
// data therefore vanished from `margin_snapshots`, so operators
// auditing margin history saw a shrinking snapshot as costing
// coverage dropped, with no signal that rows were omitted.
//
// Post-fix: every MenuEngineeringRow is persisted; quadrant='unknown'
// + margin_pct=null together signal "no costing data" and should be
// filtered at query time by UI surfaces.
//
// Run: node --experimental-strip-types --test tests/js/test-margin-analysis-snapshots.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-margin-snapshots-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

const { recomputeMarginAnalysis } = await import(
  '../../lib/computeEngine/marginAnalysis.ts'
);

const LOC = 'default';

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Seed helpers ──────────────────────────────────────────────────

function resetTables() {
  testDb.exec(`
    DELETE FROM sales_lines;
    DELETE FROM dish_components;
    DELETE FROM recipe_costs;
    DELETE FROM margin_snapshots;
  `);
}

function seedSale(item_name, qty, rev) {
  testDb.prepare(
    `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
     VALUES (?, ?, ?, ?)`,
  ).run(item_name, qty, rev, LOC);
}

function seedRecipeCost(slug, recipe_name, cost_per_yield_unit, yield_unit) {
  testDb.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(location_id, recipe_id) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       cost_per_yield_unit = excluded.cost_per_yield_unit,
       yield_unit = excluded.yield_unit`,
  ).run(slug, recipe_name, cost_per_yield_unit, yield_unit, LOC);
}

function seedDishComponent(dish_name, recipe_slug, qty_per_serving, unit) {
  testDb.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit)
     VALUES (?, ?, 'recipe', ?, NULL, ?, ?)
     ON CONFLICT(location_id, dish_name, recipe_slug) WHERE component_type='recipe'
       DO UPDATE SET
         qty_per_serving = excluded.qty_per_serving,
         unit = excluded.unit`,
  ).run(LOC, dish_name, recipe_slug, qty_per_serving, unit);
}

// ─────────────────────────────────────────────────────────────────
// Unknown-quadrant rows are persisted (the regression these tests pin)
// ─────────────────────────────────────────────────────────────────

describe('recomputeMarginAnalysis persists every MenuEngineeringRow', () => {
  before(resetTables);

  it('case 1 — both linked and unlinked dishes appear in margin_snapshots', () => {
    // Linked dish: full costing chain → emits a real quadrant + margin_pct.
    seedRecipeCost('sauce', 'House Sauce', 1.0, 'oz');
    seedDishComponent('burger', 'sauce', 2, 'oz'); // 2 oz × $1/oz = $2 cost
    seedSale('Burger', 10, 100); // qty=10, rev=$100, avg=$10, margin=80%

    // Unlinked dish: a sale with no dish_components → quadrant='unknown',
    // margin_pct=null. Pre-fix the if-guard at marginAnalysis.ts:22
    // skipped this row entirely.
    seedSale('Mystery Item', 5, 50);

    recomputeMarginAnalysis(testDb, LOC);

    const rows = testDb.prepare(
      `SELECT item_name, margin_pct, quadrant FROM margin_snapshots
        WHERE location_id = ? ORDER BY item_name`,
    ).all(LOC);

    const names = rows.map((r) => r.item_name).sort();
    assert.deepEqual(
      names,
      ['Burger', 'Mystery Item'],
      'margin_snapshots must contain BOTH the linked and the unknown-quadrant dish — ' +
        'pre-fix only the linked dish was persisted (audit §4 Compute MEDIUM).',
    );
  });

  it('case 2 — snapshot count matches distinct sales-line items after recompute', () => {
    resetTables();

    // Three distinct items: one fully linked, two unlinked.
    seedRecipeCost('sauce', 'House Sauce', 1.0, 'oz');
    seedDishComponent('burger', 'sauce', 2, 'oz');
    seedSale('Burger', 10, 100);
    seedSale('Mystery Item A', 5, 50);
    seedSale('Mystery Item B', 3, 30);

    recomputeMarginAnalysis(testDb, LOC);

    const distinctItems = testDb.prepare(
      `SELECT COUNT(DISTINCT item_name) AS c FROM sales_lines WHERE location_id = ?`,
    ).get(LOC).c;
    const snapshotCount = testDb.prepare(
      `SELECT COUNT(*) AS c FROM margin_snapshots WHERE location_id = ?`,
    ).get(LOC).c;

    assert.equal(
      snapshotCount,
      distinctItems,
      'snapshot rows must equal distinct sales-line items — pre-fix the count ' +
        'was lower because unknown-quadrant rows were silently dropped.',
    );
  });

  it('case 3 — unknown-quadrant rows are persisted with margin_pct IS NULL', () => {
    resetTables();

    seedSale('Mystery Item', 5, 50);
    recomputeMarginAnalysis(testDb, LOC);

    const row = testDb.prepare(
      `SELECT item_name, margin_pct, quadrant FROM margin_snapshots
        WHERE location_id = ? AND item_name = ?`,
    ).get(LOC, 'Mystery Item');

    assert.ok(row, 'unknown-quadrant row must exist in margin_snapshots');
    assert.equal(row.quadrant, 'unknown');
    assert.equal(
      row.margin_pct,
      null,
      'unknown-quadrant rows must carry margin_pct IS NULL — together they ' +
        'are the "no costing data" signal UI surfaces should filter on.',
    );
  });
});
