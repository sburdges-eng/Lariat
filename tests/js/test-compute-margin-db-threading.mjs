#!/usr/bin/env node
// Regression pin for docs/audit/2026-05-08-codebase-audit.md §4 (Compute,
// Tier-2 HIGH): `recomputeMarginAnalysis(db, locationId)` previously
// dropped the threaded `db` handle when calling `computeMenuEngineering`.
// In a WAL-mode `setImmediate` fire-and-forget context (see
// app/api/receiving/route.js → triggerComputeEngine) that opened a
// second connection that could race a concurrent writer between the
// response flush and the callback execution.
//
// Strategy: open TWO independent SQLite databases via setDbPathForTest.
// Seed sales/dish-component data ONLY into `dbA` and pass it explicitly
// to `recomputeMarginAnalysis(dbA, LOC)`. The cached `getDb()` returns
// `dbB` (empty schema only).
//
//   - Pre-fix: computeMenuEngineering ignores the threaded handle and
//     reads from `getDb()` (= dbB, no sales) → 0 rows → no margin
//     snapshots inserted into dbA.
//   - Post-fix: computeMenuEngineering uses dbA → produces rows →
//     margin_snapshots populated in dbA.
//
// Run: node --experimental-strip-types --test tests/js/test-compute-margin-db-threading.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-margin-threading-'));
const TMP_DB_A = path.join(TMP_DIR, 'lariat-A.db');
const TMP_DB_B = path.join(TMP_DIR, 'lariat-B.db');

const dbMod = await import('../../lib/db.ts');

// Two independent connections, both with the full schema. dbB is the
// cached connection that `getDb()` returns; dbA is opened directly so
// it survives `setDbPathForTest` swaps without being closed.
//
// Order matters: initialize dbB FIRST via setDbPathForTest so the
// cached connection points at it, then open dbA via the raw
// better-sqlite3 constructor and apply schema manually. Reversed order
// would close dbA when setDbPathForTest swaps to dbB.
dbMod.setDbPathForTest(TMP_DB_B);
const dbB = dbMod.getDb(); // cached; what getDb() returns from now on

const dbA = new Database(TMP_DB_A);
dbA.pragma('journal_mode = WAL');
dbA.pragma('foreign_keys = ON');
dbMod.initSchema(dbA);

// Sanity: dbA and dbB are distinct connections.
assert.notStrictEqual(dbA, dbB, 'precondition: dbA and dbB must be distinct connections');

const { recomputeMarginAnalysis } = await import('../../lib/computeEngine/marginAnalysis.ts');
const { computeMenuEngineering } = await import('../../lib/menuEngineering.ts');

const LOC = 'default';

after(() => {
  try { dbA.close(); } catch { /* ignore */ }
  // dbB is the cached handle; setDbPathForTest(null) closes it.
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Seed helpers (apply only to the explicitly-passed db) ─────────

function seedSale(db, item_name, qty, rev) {
  db.prepare(
    `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
     VALUES (?, ?, ?, ?)`,
  ).run(item_name, qty, rev, LOC);
}

function seedRecipeCost(db, slug, recipe_name, cost_per_yield_unit, yield_unit) {
  db.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(location_id, recipe_id) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       cost_per_yield_unit = excluded.cost_per_yield_unit,
       yield_unit = excluded.yield_unit`,
  ).run(slug, recipe_name, cost_per_yield_unit, yield_unit, LOC);
}

function seedDishComponent(db, dish_name, recipe_slug, qty_per_serving, unit) {
  db.prepare(
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
// Threading regression — the threaded db handle MUST be honored end-
// to-end through computeMenuEngineering.
// ─────────────────────────────────────────────────────────────────

describe('recomputeMarginAnalysis threads its db handle through computeMenuEngineering', () => {
  it('seeds sales+components in dbA only; passing dbA must produce margin_snapshots in dbA', () => {
    // Seed a minimal but cost-resolvable dish in dbA: one sale + one
    // dish_component pointing at a recipe with a known cost. This is
    // enough for computeMenuEngineering to emit a row with a non-null
    // margin_pct, which is the gate the INSERT loop requires.
    seedRecipeCost(dbA, 'sauce', 'House Sauce', 1.0, 'oz');
    seedDishComponent(dbA, 'burger', 'sauce', 2, 'oz'); // 2 oz × $1/oz = $2 cost
    seedSale(dbA, 'Burger', 10, 100); // qty=10, rev=$100, avg=$10, margin = (10-2)/10 = 80%

    // Sanity: dbB has the schema but ZERO sales/dish_components.
    const sanityB = dbB.prepare(`SELECT COUNT(*) AS c FROM sales_lines`).get();
    assert.equal(sanityB.c, 0, 'dbB must be empty so the threading bug is observable');

    // The act under test — caller passes dbA.
    recomputeMarginAnalysis(dbA, LOC);

    // Post-fix: rows landed in dbA because computeMenuEngineering used
    // the threaded handle. Pre-fix this would be 0 because
    // computeMenuEngineering would have read from the empty dbB.
    const dbARows = dbA.prepare(
      `SELECT item_name, margin_pct, quadrant FROM margin_snapshots WHERE location_id = ?`,
    ).all(LOC);
    assert.ok(
      dbARows.length > 0,
      'recomputeMarginAnalysis(dbA) must populate margin_snapshots in dbA — ' +
      'a 0-row result indicates computeMenuEngineering opened a second connection ' +
      'via getDb() instead of using the threaded handle (audit §4 Compute HIGH).',
    );
    assert.equal(dbARows[0].item_name, 'Burger');
    assert.ok(dbARows[0].margin_pct != null, 'margin_pct should be populated');

    // dbB must remain empty — the threaded write must not leak across.
    const dbBRows = dbB.prepare(
      `SELECT COUNT(*) AS c FROM margin_snapshots WHERE location_id = ?`,
    ).get(LOC);
    assert.equal(dbBRows.c, 0, 'margin_snapshots on dbB must remain empty');
  });
});

// ─────────────────────────────────────────────────────────────────
// Backwards compatibility — the default-parameter pattern must keep
// existing callers (no db arg) working unchanged.
// ─────────────────────────────────────────────────────────────────

describe('computeMenuEngineering remains callable without an explicit db (backwards-compat)', () => {
  it('falls back to getDb() when no db is passed', () => {
    // Wipe any rows the prior test left behind on dbB and seed fresh
    // sales+components on dbB, which is what getDb() returns.
    dbB.exec(`DELETE FROM sales_lines; DELETE FROM dish_components; DELETE FROM recipe_costs; DELETE FROM margin_snapshots;`);
    seedRecipeCost(dbB, 'sauce', 'House Sauce', 1.0, 'oz');
    seedDishComponent(dbB, 'taco', 'sauce', 1, 'oz');
    seedSale(dbB, 'Taco', 5, 50);

    // No db arg — must not throw, must read from cached getDb().
    const result = computeMenuEngineering(LOC);
    assert.ok(Array.isArray(result.rows), 'result must have rows array');
    const taco = result.rows.find((r) => r.item_name === 'Taco');
    assert.ok(taco, 'Taco row must be present (computeMenuEngineering read from getDb())');
    assert.ok(taco.margin_pct != null, 'taco margin_pct must be computed');
  });
});
