#!/usr/bin/env node
// Tests for listMarginDeltas() helper.
//
// Covers:
//   - Single-vendor_item dish with one SKU that moved up
//   - Two-component dish where one SKU moved up, one moved down
//     (contributors sorted by absolute contribution)
//   - Recipe-only dish returns nothing (recipe components are
//     intentionally skipped — see NOTE in lib/marginDeltas.ts)
//   - minPctMove threshold gates dishes
//   - Location scoping: dish_components and snapshots from another
//     location don't leak in
//   - windowDays clamping (out-of-range values fall to bounds)
//   - limit ordering by absolute delta DESC, then trim
//   - When an ingredient maps to multiple SKUs (different vendors),
//     pick the one whose latest snapshot is most recent
//
// Run: node --experimental-strip-types --test tests/js/test-margin-deltas.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-margin-deltas-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const repo = await import('../../lib/marginDeltas.ts');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  db.exec('DELETE FROM vendor_prices_history; DELETE FROM dish_components;');
});

// ── Helpers ────────────────────────────────────────────────────────

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function insertSnapshot({
  vendor, sku, ingredient, unit_price,
  category = null, snapshot_at, location_id = 'default',
  pack_size = 1, pack_unit = 'lb', pack_price = null,
  run_id = 1,
}) {
  db.prepare(
    `INSERT INTO vendor_prices_history
       (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, category, location_id, snapshot_at, snapshot_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run_id, ingredient, vendor, sku, pack_size, pack_unit,
    pack_price ?? unit_price * pack_size, unit_price, category,
    location_id, snapshot_at, 'test',
  );
}

function insertVendorComponent({
  dish_name, vendor_ingredient, qty_per_serving,
  unit = 'lb', location_id = 'default',
}) {
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES (?, ?, 'vendor_item', ?, ?, ?)`,
  ).run(location_id, dish_name, vendor_ingredient, qty_per_serving, unit);
}

function insertRecipeComponent({
  dish_name, recipe_slug, qty_per_serving,
  unit = 'oz', location_id = 'default',
}) {
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug,
        qty_per_serving, unit)
     VALUES (?, ?, 'recipe', ?, ?, ?)`,
  ).run(location_id, dish_name, recipe_slug, qty_per_serving, unit);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('listMarginDeltas — single vendor_item dish', () => {
  it('computes signed delta_pct from a SKU that moved up', () => {
    insertSnapshot({
      vendor: 'sysco', sku: 'BUN-1', ingredient: 'Brioche Bun',
      unit_price: 0.50, snapshot_at: isoDaysAgo(6),
    });
    insertSnapshot({
      vendor: 'sysco', sku: 'BUN-1', ingredient: 'Brioche Bun',
      unit_price: 0.60, snapshot_at: isoDaysAgo(0),
    });
    insertVendorComponent({
      dish_name: 'Cheeseburger', vendor_ingredient: 'Brioche Bun',
      qty_per_serving: 1,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.dish_name, 'Cheeseburger');
    assert.ok(Math.abs(r.baseline_cost - 0.50) < 1e-9);
    assert.ok(Math.abs(r.latest_cost - 0.60) < 1e-9);
    assert.strictEqual(r.direction, 'up');
    assert.ok(Math.abs(r.delta_pct - 20.0) < 1e-6);
    assert.strictEqual(r.top_contributors.length, 1);
    assert.strictEqual(r.top_contributors[0].sku, 'BUN-1');
    // Sole contributor accounts for 100% of the change.
    assert.ok(Math.abs(r.top_contributors[0].contribution_pct - 100) < 1e-6);
  });

  it('handles a price drop with direction=down', () => {
    insertSnapshot({
      vendor: 'shamrock', sku: 'OIL-1', ingredient: 'Canola Oil',
      unit_price: 10, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'shamrock', sku: 'OIL-1', ingredient: 'Canola Oil',
      unit_price: 8, snapshot_at: isoDaysAgo(0),
    });
    insertVendorComponent({
      dish_name: 'Fries', vendor_ingredient: 'Canola Oil',
      qty_per_serving: 0.1,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].direction, 'down');
    assert.ok(rows[0].delta_pct < 0);
    assert.ok(Math.abs(rows[0].delta_pct + 20.0) < 1e-6);
  });
});

describe('listMarginDeltas — multi-component dishes', () => {
  it('one component up + one down, contributors sorted by abs', () => {
    // Patty: 8 → 10 (up, qty 0.5 → +1.0)
    insertSnapshot({ vendor: 'sysco', sku: 'PATTY-1', ingredient: 'Beef Patty',
      unit_price: 8, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'sysco', sku: 'PATTY-1', ingredient: 'Beef Patty',
      unit_price: 10, snapshot_at: isoDaysAgo(0) });
    // Bun: 1.00 → 0.80 (down, qty 1 → -0.20)
    insertSnapshot({ vendor: 'shamrock', sku: 'BUN-1', ingredient: 'Brioche Bun',
      unit_price: 1.00, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'shamrock', sku: 'BUN-1', ingredient: 'Brioche Bun',
      unit_price: 0.80, snapshot_at: isoDaysAgo(0) });

    insertVendorComponent({
      dish_name: 'Cheeseburger', vendor_ingredient: 'Beef Patty',
      qty_per_serving: 0.5,
    });
    insertVendorComponent({
      dish_name: 'Cheeseburger', vendor_ingredient: 'Brioche Bun',
      qty_per_serving: 1,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 1 });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    // baseline = 8*0.5 + 1.00*1 = 5.00; latest = 10*0.5 + 0.80*1 = 5.80
    assert.ok(Math.abs(r.baseline_cost - 5.00) < 1e-9);
    assert.ok(Math.abs(r.latest_cost - 5.80) < 1e-9);
    assert.strictEqual(r.direction, 'up');
    assert.ok(Math.abs(r.delta_pct - 16.0) < 1e-6);

    assert.strictEqual(r.top_contributors.length, 2);
    // Patty drove +1.00 of +0.80 net = +125%; Bun drove -0.20 of +0.80 = -25%
    // Patty has the larger absolute contribution → first.
    assert.strictEqual(r.top_contributors[0].ingredient, 'Beef Patty');
    assert.ok(r.top_contributors[0].contribution_pct > 0);
    assert.strictEqual(r.top_contributors[1].ingredient, 'Brioche Bun');
    assert.ok(r.top_contributors[1].contribution_pct < 0);
    // Contributions sum to 100% of the dish-level change.
    const total =
      r.top_contributors[0].contribution_pct + r.top_contributors[1].contribution_pct;
    assert.ok(Math.abs(total - 100) < 1e-6);
  });
});

describe('listMarginDeltas — recipe-only dish', () => {
  it('returns no row when a dish only has recipe components', () => {
    insertRecipeComponent({
      dish_name: 'Bowl of Chili', recipe_slug: 'green_chili',
      qty_per_serving: 8,
    });
    // Even with vendor history present in the DB, no vendor_item
    // component on the dish ⇒ skipped.
    insertSnapshot({
      vendor: 'sysco', sku: 'IRRELEVANT', ingredient: 'Tomato',
      unit_price: 1, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'sysco', sku: 'IRRELEVANT', ingredient: 'Tomato',
      unit_price: 2, snapshot_at: isoDaysAgo(0),
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 1 });
    assert.deepStrictEqual(rows, []);
  });

  it('mixed recipe + vendor_item dish only counts the vendor_item', () => {
    insertSnapshot({ vendor: 'v', sku: 'CH', ingredient: 'Cheddar',
      unit_price: 4, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'v', sku: 'CH', ingredient: 'Cheddar',
      unit_price: 5, snapshot_at: isoDaysAgo(0) });

    insertRecipeComponent({
      dish_name: 'Cheesy Mac', recipe_slug: 'mac_sauce',
      qty_per_serving: 4,
    });
    insertVendorComponent({
      dish_name: 'Cheesy Mac', vendor_ingredient: 'Cheddar',
      qty_per_serving: 0.25,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 1 });
    assert.strictEqual(rows.length, 1);
    // baseline 4*0.25=1.00, latest 5*0.25=1.25, +25%
    assert.ok(Math.abs(rows[0].delta_pct - 25.0) < 1e-6);
    assert.strictEqual(rows[0].top_contributors.length, 1);
  });
});

describe('listMarginDeltas — gating and clamping', () => {
  it('filters dishes whose move is below minPctMove', () => {
    insertSnapshot({ vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 100, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 102, snapshot_at: isoDaysAgo(0) });
    insertVendorComponent({
      dish_name: 'Dish A', vendor_ingredient: 'A', qty_per_serving: 1,
    });

    insertSnapshot({ vendor: 'v', sku: 'B', ingredient: 'B',
      unit_price: 100, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'v', sku: 'B', ingredient: 'B',
      unit_price: 110, snapshot_at: isoDaysAgo(0) });
    insertVendorComponent({
      dish_name: 'Dish B', vendor_ingredient: 'B', qty_per_serving: 1,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].dish_name, 'Dish B');
  });

  it('scopes dish_components and snapshots by location_id', () => {
    // kitchen-a: SKU moves 100 → 200
    insertSnapshot({ vendor: 'v', sku: 'X', ingredient: 'X',
      unit_price: 100, snapshot_at: isoDaysAgo(5), location_id: 'kitchen-a' });
    insertSnapshot({ vendor: 'v', sku: 'X', ingredient: 'X',
      unit_price: 200, snapshot_at: isoDaysAgo(0), location_id: 'kitchen-a' });
    insertVendorComponent({
      dish_name: 'Dish A', vendor_ingredient: 'X', qty_per_serving: 1,
      location_id: 'kitchen-a',
    });

    // kitchen-b: SKU barely moves
    insertSnapshot({ vendor: 'v', sku: 'X', ingredient: 'X',
      unit_price: 100, snapshot_at: isoDaysAgo(5), location_id: 'kitchen-b' });
    insertSnapshot({ vendor: 'v', sku: 'X', ingredient: 'X',
      unit_price: 100.5, snapshot_at: isoDaysAgo(0), location_id: 'kitchen-b' });
    insertVendorComponent({
      dish_name: 'Dish A', vendor_ingredient: 'X', qty_per_serving: 1,
      location_id: 'kitchen-b',
    });

    const a = repo.listMarginDeltas(db, {
      location_id: 'kitchen-a', windowDays: 7, minPctMove: 5,
    });
    const b = repo.listMarginDeltas(db, {
      location_id: 'kitchen-b', windowDays: 7, minPctMove: 5,
    });
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 0);
  });

  it('clamps windowDays to [1, 90]', () => {
    // Snapshot 40 days ago; only a 90-day window can see it.
    insertSnapshot({ vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 100, snapshot_at: isoDaysAgo(40) });
    insertSnapshot({ vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 200, snapshot_at: isoDaysAgo(0) });
    insertVendorComponent({
      dish_name: 'Dish A', vendor_ingredient: 'A', qty_per_serving: 1,
    });

    // 0 / negative falls back to default 7 ⇒ 40-day-ago snapshot invisible.
    const zero = repo.listMarginDeltas(db, { windowDays: 0, minPctMove: 5 });
    assert.strictEqual(zero.length, 0);

    // Out-of-range high clamps to 90 ⇒ baseline visible.
    const huge = repo.listMarginDeltas(db, { windowDays: 9999, minPctMove: 5 });
    assert.strictEqual(huge.length, 1);
    assert.strictEqual(huge[0].baseline_cost, 100);
  });

  it('sorts by abs delta_pct DESC and trims to limit', () => {
    const cases = [
      ['Dish_A', 100, 110], // +10%
      ['Dish_B', 100, 130], // +30%
      ['Dish_C', 100, 80],  // -20%
      ['Dish_D', 100, 105], //  +5%
    ];
    for (const [dish, oldP, newP] of cases) {
      const sku = `SKU_${dish}`;
      const ing = `Ing_${dish}`;
      insertSnapshot({ vendor: 'v', sku, ingredient: ing,
        unit_price: oldP, snapshot_at: isoDaysAgo(5) });
      insertSnapshot({ vendor: 'v', sku, ingredient: ing,
        unit_price: newP, snapshot_at: isoDaysAgo(0) });
      insertVendorComponent({
        dish_name: dish, vendor_ingredient: ing, qty_per_serving: 1,
      });
    }
    const rows = repo.listMarginDeltas(db, {
      windowDays: 7, minPctMove: 5, limit: 3,
    });
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.dish_name),
      ['Dish_B', 'Dish_C', 'Dish_A']);
  });
});

describe('listMarginDeltas — multi-vendor SKU resolution', () => {
  it('picks the SKU whose latest snapshot is most recent', () => {
    // Two vendors carry the same ingredient name. Vendor B was
    // refreshed today; vendor A was last refreshed 3 days ago.
    insertSnapshot({ vendor: 'A', sku: 'OLD', ingredient: 'Tomato',
      unit_price: 1.00, snapshot_at: isoDaysAgo(6) });
    insertSnapshot({ vendor: 'A', sku: 'OLD', ingredient: 'Tomato',
      unit_price: 1.50, snapshot_at: isoDaysAgo(3) });
    insertSnapshot({ vendor: 'B', sku: 'NEW', ingredient: 'Tomato',
      unit_price: 2.00, snapshot_at: isoDaysAgo(5) });
    insertSnapshot({ vendor: 'B', sku: 'NEW', ingredient: 'Tomato',
      unit_price: 3.00, snapshot_at: isoDaysAgo(0) });

    insertVendorComponent({
      dish_name: 'Salsa', vendor_ingredient: 'Tomato', qty_per_serving: 1,
    });

    const rows = repo.listMarginDeltas(db, { windowDays: 7, minPctMove: 1 });
    assert.strictEqual(rows.length, 1);
    // Vendor B wins → baseline 2.00 → 3.00 = +50%.
    assert.strictEqual(rows[0].top_contributors[0].vendor, 'B');
    assert.strictEqual(rows[0].top_contributors[0].sku, 'NEW');
    assert.ok(Math.abs(rows[0].delta_pct - 50) < 1e-6);
  });
});
