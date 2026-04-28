#!/usr/bin/env node
// Tests for GET /api/menu-engineering/margin-deltas route handler.
//
// Covers:
//   - 200 with empty rows when there are no dish_components AND no
//     vendor_prices_history
//   - Clamping: ?days=999&minPct=-50&limit=99999 returns
//     window_days: 90, min_pct: 0, limit: 500
//   - Happy path: insert one dish with one vendor_item that moved up;
//     verify the response payload echoes the row
//   - Response includes window_days, min_pct, limit, count, rows
//
// Run: node --experimental-strip-types --test tests/js/test-margin-deltas-api.mjs
//
// Mirrors the structure of tests/js/test-price-shocks.mjs.
//
// The route file is .js but pulls a .ts helper via the resolver hook
// — so we import it through the same resolver as the helper-level
// tests do.
//
// (See resolver.mjs in this directory for the extension-walking rules.)

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-margin-deltas-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const route = await import('../../app/api/menu-engineering/margin-deltas/route.js');

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

// ── API tests ─────────────────────────────────────────────────────

describe('GET /api/menu-engineering/margin-deltas', () => {
  it('returns 200 with empty rows when dish_components and history are both empty', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas'),
    );
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    // Defaults are echoed even on the empty path.
    assert.strictEqual(j.window_days, 7);
    assert.strictEqual(j.min_pct, 5);
    assert.strictEqual(j.limit, 50);
    assert.strictEqual(j.count, 0);
    assert.deepStrictEqual(j.rows, []);
  });

  it('clamps days to [1,90], minPct to [0,1000], limit to [1,500]', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas?days=999&minPct=-50&limit=99999'),
    );
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.window_days, 90);
    assert.strictEqual(j.min_pct, 0);
    assert.strictEqual(j.limit, 500);
    // Shape sanity even when no data.
    assert.strictEqual(j.count, 0);
    assert.deepStrictEqual(j.rows, []);
  });

  it('echoes the row for a dish whose vendor_item moved up', async () => {
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

    const res = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas?days=7&minPct=5'),
    );
    assert.strictEqual(res.status, 200);
    const j = await res.json();

    // Envelope echoes the params and includes count + rows.
    assert.strictEqual(j.window_days, 7);
    assert.strictEqual(j.min_pct, 5);
    assert.strictEqual(j.limit, 50);
    assert.strictEqual(j.count, 1);
    assert.strictEqual(j.rows.length, 1);

    const r = j.rows[0];
    assert.strictEqual(r.dish_name, 'Cheeseburger');
    assert.ok(Math.abs(r.baseline_cost - 0.50) < 1e-9);
    assert.ok(Math.abs(r.latest_cost - 0.60) < 1e-9);
    assert.strictEqual(r.direction, 'up');
    assert.ok(Math.abs(r.delta_pct - 20.0) < 1e-6);
    assert.strictEqual(r.top_contributors.length, 1);
    assert.strictEqual(r.top_contributors[0].sku, 'BUN-1');
    assert.strictEqual(r.top_contributors[0].ingredient, 'Brioche Bun');
    assert.ok(Math.abs(r.top_contributors[0].contribution_pct - 100) < 1e-6);
  });

  it('honours location query alias', async () => {
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 1,
      snapshot_at: isoDaysAgo(5), location_id: 'kitchen-a',
    });
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 2,
      snapshot_at: isoDaysAgo(0), location_id: 'kitchen-a',
    });
    insertVendorComponent({
      dish_name: 'Test Dish', vendor_ingredient: 'A',
      qty_per_serving: 1, location_id: 'kitchen-a',
    });

    // location= alias should pick up the kitchen-a rows.
    const resA = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas?location=kitchen-a'),
    );
    const jA = await resA.json();
    assert.strictEqual(jA.count, 1);
    assert.strictEqual(jA.rows[0].dish_name, 'Test Dish');

    // location_id= alias also works (handled by locationFromRequest).
    const resB = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas?location_id=kitchen-a'),
    );
    const jB = await resB.json();
    assert.strictEqual(jB.count, 1);

    // Default location has no rows.
    const resDefault = await route.GET(
      new Request('http://localhost/api/menu-engineering/margin-deltas'),
    );
    const jDefault = await resDefault.json();
    assert.strictEqual(jDefault.count, 0);
  });
});
