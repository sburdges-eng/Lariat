#!/usr/bin/env node
// Tests for listPriceShocks() helper and /api/vendor-prices/shocks route.
//
// Covers:
//   - Picks the EARLIEST snapshot in window as baseline (mental model:
//     "what changed since Monday")
//   - Picks the LATEST snapshot overall as the comparison point
//   - Filters by minPctMove (absolute)
//   - Sorts by absolute % move desc, then trims to limit
//   - Skips SKUs with only one snapshot in window (no comparison)
//   - Skips rows where baseline_unit_price is null/zero
//   - Direction up vs down based on signed delta
//   - Location scoping: rows from another location don't leak
//   - API: clamps days/minPct/limit to allowed ranges; returns 200 on
//     empty history
//
// Run: node --experimental-strip-types --test tests/js/test-price-shocks.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-price-shocks-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const repo = await import('../../lib/vendorPricesRepo.ts');
const route = await import('../../app/api/vendor-prices/shocks/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  db.exec('DELETE FROM vendor_prices_history;');
});

// ── Helpers ────────────────────────────────────────────────────────

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  // SQLite's datetime('now') drops sub-seconds in shocks query, so use a
  // matching format here: 'YYYY-MM-DD HH:MM:SS'.
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

// ── Helper unit tests ──────────────────────────────────────────────

describe('listPriceShocks — baseline = earliest in window', () => {
  it('uses earliest in window vs latest overall, computes signed % delta', () => {
    insertSnapshot({
      vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado',
      unit_price: 2.00, snapshot_at: isoDaysAgo(6),
    });
    insertSnapshot({
      vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado',
      unit_price: 2.50, snapshot_at: isoDaysAgo(0),
    });
    const rows = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.baseline_unit_price, 2.00);
    assert.strictEqual(r.latest_unit_price, 2.50);
    assert.strictEqual(r.direction, 'up');
    assert.ok(Math.abs(r.delta_pct - 25.0) < 1e-6);
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
    const rows = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].direction, 'down');
    assert.ok(rows[0].delta_pct < 0);
  });

  it('filters out SKUs whose move is below the threshold', () => {
    insertSnapshot({
      vendor: 'sysco', sku: 'A', ingredient: 'A',
      unit_price: 100, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'sysco', sku: 'A', ingredient: 'A',
      unit_price: 102, snapshot_at: isoDaysAgo(0),
    }); // 2% — below default 5%
    insertSnapshot({
      vendor: 'sysco', sku: 'B', ingredient: 'B',
      unit_price: 100, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'sysco', sku: 'B', ingredient: 'B',
      unit_price: 110, snapshot_at: isoDaysAgo(0),
    }); // 10% — above
    const rows = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].sku, 'B');
  });

  it('sorts by absolute % move desc and trims to limit', () => {
    for (const [sku, oldP, newP] of [
      ['A', 100, 110], // +10%
      ['B', 100, 130], // +30%
      ['C', 100, 80],  // -20%
      ['D', 100, 105], // +5% (right at threshold)
    ]) {
      insertSnapshot({ vendor: 'v', sku, ingredient: sku, unit_price: oldP, snapshot_at: isoDaysAgo(5) });
      insertSnapshot({ vendor: 'v', sku, ingredient: sku, unit_price: newP, snapshot_at: isoDaysAgo(0) });
    }
    const rows = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 5, limit: 3 });
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.sku), ['B', 'C', 'A']);
  });

  it('skips SKUs with only one snapshot in window', () => {
    insertSnapshot({
      vendor: 'v', sku: 'lonely', ingredient: 'lonely',
      unit_price: 100, snapshot_at: isoDaysAgo(0),
    });
    const rows = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 0 });
    assert.strictEqual(rows.length, 0);
  });

  it('scopes to location_id', () => {
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 100,
      snapshot_at: isoDaysAgo(5), location_id: 'kitchen-a',
    });
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 200,
      snapshot_at: isoDaysAgo(0), location_id: 'kitchen-a',
    });
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 100,
      snapshot_at: isoDaysAgo(5), location_id: 'kitchen-b',
    });
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A', unit_price: 100.1,
      snapshot_at: isoDaysAgo(0), location_id: 'kitchen-b',
    });
    const a = repo.listPriceShocks(db, { location_id: 'kitchen-a', windowDays: 7, minPctMove: 5 });
    const b = repo.listPriceShocks(db, { location_id: 'kitchen-b', windowDays: 7, minPctMove: 5 });
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 0);
  });

  it('honours windowDays — older snapshots fall outside', () => {
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 100, snapshot_at: isoDaysAgo(40),
    });
    insertSnapshot({
      vendor: 'v', sku: 'A', ingredient: 'A',
      unit_price: 200, snapshot_at: isoDaysAgo(0),
    });
    // 7-day window: only the latest snapshot is inside, no baseline.
    const week = repo.listPriceShocks(db, { windowDays: 7, minPctMove: 5 });
    assert.strictEqual(week.length, 0);
    // 90-day window: both visible, baseline is the older one.
    const quarter = repo.listPriceShocks(db, { windowDays: 90, minPctMove: 5 });
    assert.strictEqual(quarter.length, 1);
    assert.strictEqual(quarter[0].baseline_unit_price, 100);
  });
});

// ── API tests ─────────────────────────────────────────────────────

describe('GET /api/vendor-prices/shocks', () => {
  it('returns 200 with empty rows when history is empty', async () => {
    const res = await route.GET(new Request('http://localhost/api/vendor-prices/shocks'));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.count, 0);
    assert.strictEqual(j.window_days, 7);
    assert.strictEqual(j.min_pct, 5);
  });

  it('clamps days to [1,90] and minPct to [0,1000]', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/vendor-prices/shocks?days=999&minPct=-50&limit=99999'),
    );
    const j = await res.json();
    assert.strictEqual(j.window_days, 90);
    assert.strictEqual(j.min_pct, 0);
    assert.strictEqual(j.limit, 500);
  });

  it('honours category filter (case-insensitive)', async () => {
    insertSnapshot({
      vendor: 'v', sku: 'BEER1', ingredient: 'Pilsner', category: 'Beer',
      unit_price: 1, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'v', sku: 'BEER1', ingredient: 'Pilsner', category: 'Beer',
      unit_price: 1.2, snapshot_at: isoDaysAgo(0),
    });
    insertSnapshot({
      vendor: 'v', sku: 'OIL1', ingredient: 'Oil', category: 'Pantry',
      unit_price: 5, snapshot_at: isoDaysAgo(5),
    });
    insertSnapshot({
      vendor: 'v', sku: 'OIL1', ingredient: 'Oil', category: 'Pantry',
      unit_price: 7, snapshot_at: isoDaysAgo(0),
    });
    const res = await route.GET(
      new Request('http://localhost/api/vendor-prices/shocks?days=7&minPct=5&category=beer'),
    );
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].sku, 'BEER1');
  });
});
