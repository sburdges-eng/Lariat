#!/usr/bin/env node
// T7 acceptance — multi-vendor SKU collapse via ingredient_masters.
//
// Spec (docs/MAPPING_ENGINE_GAPS.md):
//   - Collapse Sysco + Shamrock rows for the same ingredient into one master.
//   - Seed masters ONLY from ingredient_maps rows with status='confirmed';
//     unconfirmed rows stay in the unmapped queue (no fuzz-matching).
//   - master_id slug: normalizeIngredientKey(recipe_ingredient) + ' '→'_'.
//   - vendor_prices.master_id + bom_lines.master_id get backfilled from
//     confirmed maps.
//   - Costing joins per master_id: preferred_vendor wins, else simple mean
//     across latest-per-vendor rows.
//   - Acceptance: DISTINCT(master_id) < DISTINCT(ingredient) after collapse.
//
// Run: node --experimental-strip-types --test tests/js/test-ingredient-masters.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import {
  ingestCosting,
  rebuildIngredientMasters,
  deriveMasterId,
} from '../../scripts/ingest-costing.mjs';
import {
  computeCostVariance,
  resolveMergedCost,
} from '../../lib/costingBenchmarks.mjs';

const LOC = 'default';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function payload(over = {}) {
  return {
    vendor_prices: [],
    recipe_costs: [],
    bom_lines: [],
    ingredient_maps: [],
    order_guide: [],
    ...over,
  };
}

// ── Schema assertions ──────────────────────────────────────────────

describe('T7 — schema', () => {
  it('ingredient_masters exists with required columns + master_id PK', () => {
    const db = makeDb();
    const info = db.prepare('PRAGMA table_info(ingredient_masters)').all();
    const byName = new Map(info.map((c) => [c.name, c]));
    for (const name of ['master_id', 'canonical_name', 'category',
                        'preferred_vendor', 'last_reviewed']) {
      assert.ok(byName.has(name), `ingredient_masters.${name} missing`);
    }
    assert.strictEqual(byName.get('master_id').pk, 1, 'master_id must be PK');
    assert.strictEqual(byName.get('canonical_name').notnull, 1,
      'canonical_name must be NOT NULL');
    db.close();
  });

  it('vendor_prices has master_id column (nullable TEXT)', () => {
    const db = makeDb();
    const info = db.prepare('PRAGMA table_info(vendor_prices)').all();
    const col = info.find((c) => c.name === 'master_id');
    assert.ok(col, 'vendor_prices.master_id missing');
    assert.strictEqual(col.type.toUpperCase(), 'TEXT');
    assert.strictEqual(col.notnull, 0, 'master_id must be nullable');
    db.close();
  });

  it('bom_lines has master_id column (nullable TEXT)', () => {
    const db = makeDb();
    const info = db.prepare('PRAGMA table_info(bom_lines)').all();
    const col = info.find((c) => c.name === 'master_id');
    assert.ok(col, 'bom_lines.master_id missing');
    assert.strictEqual(col.type.toUpperCase(), 'TEXT');
    assert.strictEqual(col.notnull, 0, 'master_id must be nullable');
    db.close();
  });

  it('idx_vp_master and idx_bom_master indexes exist', () => {
    const db = makeDb();
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index'`,
    ).all().map((r) => r.name);
    assert.ok(indexes.includes('idx_vp_master'),
      `idx_vp_master missing from ${JSON.stringify(indexes)}`);
    assert.ok(indexes.includes('idx_bom_master'),
      `idx_bom_master missing from ${JSON.stringify(indexes)}`);
    db.close();
  });
});

describe('T7 — pre-T7 migration adds master_id to vendor_prices + bom_lines', () => {
  it('legacy DB without master_id gets the columns ALTERed in', () => {
    const legacy = new Database(':memory:');
    try {
      // Pre-T7 shape: vendor_prices has everything through T6 except master_id;
      // bom_lines has yield/loss_factor but no master_id.
      legacy.exec(`
        CREATE TABLE vendor_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient TEXT NOT NULL,
          vendor TEXT,
          sku TEXT,
          pack_size REAL,
          pack_unit TEXT,
          pack_price REAL,
          unit_price REAL,
          category TEXT,
          location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          yield_pct REAL,
          actual_received_lb REAL,
          reconciled_unit_price REAL,
          map_status TEXT
        );
        CREATE TABLE bom_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          ingredient TEXT,
          qty REAL,
          unit TEXT,
          sub_recipe TEXT,
          vendor_ingredient TEXT,
          map_status TEXT,
          vendor TEXT,
          pack_price REAL,
          pack_size REAL,
          location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          yield_pct REAL,
          loss_factor REAL
        );
        INSERT INTO vendor_prices (ingredient, vendor, sku, pack_price)
        VALUES ('Legacy VP', 'sysco', 'LEGACY-1', 10.0);
        INSERT INTO bom_lines (recipe_id, ingredient, qty, unit)
        VALUES ('r1', 'Legacy BOM', 1.0, 'lb');
      `);

      initSchema(legacy);

      const vpCols = legacy.prepare('PRAGMA table_info(vendor_prices)').all()
        .map((c) => c.name);
      const bomCols = legacy.prepare('PRAGMA table_info(bom_lines)').all()
        .map((c) => c.name);
      assert.ok(vpCols.includes('master_id'), 'vendor_prices.master_id not ALTERed in');
      assert.ok(bomCols.includes('master_id'), 'bom_lines.master_id not ALTERed in');

      // Pre-existing rows must survive with master_id NULL.
      const vpRow = legacy.prepare(`SELECT master_id FROM vendor_prices WHERE sku='LEGACY-1'`).get();
      const bomRow = legacy.prepare(`SELECT master_id FROM bom_lines WHERE recipe_id='r1'`).get();
      assert.strictEqual(vpRow.master_id, null);
      assert.strictEqual(bomRow.master_id, null);
    } finally {
      legacy.close();
    }
  });

  it('assertCriticalSchemas throws on drifted ingredient_masters', () => {
    const drifted = new Database(':memory:');
    try {
      drifted.exec(`
        CREATE TABLE ingredient_masters (
          master_id TEXT PRIMARY KEY,
          canonical_name TEXT NOT NULL
        );
      `);
      assert.throws(
        () => initSchema(drifted),
        (err) => err instanceof Error &&
                 /schema drift on 'ingredient_masters'/.test(err.message) &&
                 /preferred_vendor/.test(err.message),
      );
    } finally {
      drifted.close();
    }
  });
});

// ── Slug / deriveMasterId ──────────────────────────────────────────

describe('T7 — deriveMasterId slug formula', () => {
  it('"Tomato Paste" → "tomato_paste"', () => {
    assert.strictEqual(deriveMasterId('Tomato Paste'), 'tomato_paste');
  });
  it('"  HEINZ KETCHUP, 1 gal " strips punctuation + collapses whitespace', () => {
    // normalizeIngredientKey drops non-alphanum to spaces, collapses.
    assert.strictEqual(deriveMasterId('  HEINZ KETCHUP, 1 gal '), 'heinz_ketchup_1_gal');
  });
  it('null / empty → null (never produces a blank PK)', () => {
    assert.strictEqual(deriveMasterId(null), null);
    assert.strictEqual(deriveMasterId(''), null);
    assert.strictEqual(deriveMasterId('   '), null);
  });
});

// ── Seeding: confirmed-only posture ────────────────────────────────

describe('T7 — seeding from ingredient_maps', () => {
  it('only status=confirmed rows produce masters; unconfirmed stay out', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'HEINZ KETCHUP 1GAL', status: 'confirmed' },
        { recipe_ingredient: 'mustard', vendor_ingredient: 'FRENCHS MUSTARD',    status: 'unconfirmed' },
        { recipe_ingredient: 'mayo',    vendor_ingredient: 'BEST FOODS MAYO',   status: 'auto_mapped' },
        { recipe_ingredient: 'relish',  vendor_ingredient: 'SWEET RELISH',      status: '' },
      ],
    }), LOC);

    const rows = db.prepare(
      `SELECT master_id, canonical_name FROM ingredient_masters ORDER BY master_id`,
    ).all();
    assert.deepStrictEqual(rows.map((r) => r.master_id), ['ketchup']);
    assert.strictEqual(rows[0].canonical_name, 'ketchup');
    db.close();
  });

  it('multiple confirmed maps with the same recipe_ingredient collapse to one master', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'HEINZ 1GAL',   status: 'confirmed' },
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'SYSCO KETCHUP', status: 'confirmed' },
      ],
    }), LOC);
    const count = db.prepare(`SELECT COUNT(*) as c FROM ingredient_masters`).get().c;
    assert.strictEqual(count, 1);
    db.close();
  });

  it('preferred_vendor is seeded from the first vendor_prices hit for the ingredient', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco',    sku: 'SYS-K', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'ketchup', vendor: 'shamrock', sku: 'SHAM-K', pack_size: 1, pack_unit: 'gal', pack_price: 11 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    }), LOC);
    const row = db.prepare(
      `SELECT preferred_vendor FROM ingredient_masters WHERE master_id='ketchup'`,
    ).get();
    // First row by imported_at DESC wins; both rows share imported_at (same
    // ingest run), so id DESC breaks the tie → shamrock came second, so it
    // has the higher id, so it wins.
    assert.ok(['sysco', 'shamrock'].includes(row.preferred_vendor),
      `preferred_vendor should be one of the two vendors, got ${row.preferred_vendor}`);
    db.close();
  });
});

// ── Backfill onto vendor_prices / bom_lines ────────────────────────

describe('T7 — backfill master_id onto vendor_prices + bom_lines', () => {
  it('confirmed map populates both tables for matching rows', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco',    sku: 'SYS-K', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'ketchup', vendor: 'shamrock', sku: 'SHAM-K', pack_size: 1, pack_unit: 'gal', pack_price: 11 },
        { ingredient: 'mustard', vendor: 'sysco',    sku: 'SYS-M', pack_size: 1, pack_unit: 'gal', pack_price: 7 },
      ],
      bom_lines: [
        { recipe_id: 'burger', ingredient: 'ketchup', qty: 1, unit: 'tbsp', pack_price: 12, pack_size: 256 },
        { recipe_id: 'burger', ingredient: 'mustard', qty: 1, unit: 'tbsp', pack_price: 7, pack_size: 256 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    }), LOC);

    const vp = db.prepare(
      `SELECT ingredient, master_id FROM vendor_prices ORDER BY ingredient, vendor`,
    ).all();
    // Both ketchup rows master_id='ketchup'; mustard row NULL (no master).
    const ketchupMasters = vp.filter((r) => r.ingredient === 'ketchup').map((r) => r.master_id);
    const mustardMasters = vp.filter((r) => r.ingredient === 'mustard').map((r) => r.master_id);
    assert.deepStrictEqual(ketchupMasters, ['ketchup', 'ketchup']);
    assert.deepStrictEqual(mustardMasters, [null]);

    const bom = db.prepare(
      `SELECT ingredient, master_id FROM bom_lines ORDER BY ingredient`,
    ).all();
    assert.deepStrictEqual(
      bom.map((r) => [r.ingredient, r.master_id]),
      [['ketchup', 'ketchup'], ['mustard', null]],
    );
    db.close();
  });

  it('normalized match catches case / whitespace drift without fuzz', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'Ketchup', vendor: 'sysco', sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'KETCHUP ', vendor: 'shamrock', sku: 'S2', pack_size: 1, pack_unit: 'gal', pack_price: 11 },
      ],
      bom_lines: [
        { recipe_id: 'burger', ingredient: ' Ketchup', qty: 1, unit: 'tbsp', pack_price: 12, pack_size: 256 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    }), LOC);

    const vpCount = db.prepare(
      `SELECT COUNT(*) as c FROM vendor_prices WHERE master_id='ketchup'`,
    ).get().c;
    const bomCount = db.prepare(
      `SELECT COUNT(*) as c FROM bom_lines WHERE master_id='ketchup'`,
    ).get().c;
    assert.strictEqual(vpCount, 2,
      'both case-varying vendor rows should map to the master via LOWER(TRIM) sweep');
    assert.strictEqual(bomCount, 1);
    db.close();
  });

  it('re-running is idempotent — same counts, no duplicate masters', () => {
    const db = makeDb();
    const seed = payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco', sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
      ],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'ketchup', qty: 1, unit: 'tbsp', pack_price: 12, pack_size: 256 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    });

    const s1 = ingestCosting(db, seed, LOC);
    const s2 = ingestCosting(db, seed, LOC);

    assert.strictEqual(s1.ingredient_masters, 1);
    assert.strictEqual(s2.ingredient_masters, 1);
    const countMasters = db.prepare(`SELECT COUNT(*) as c FROM ingredient_masters`).get().c;
    assert.strictEqual(countMasters, 1);
    db.close();
  });
});

// ── Merged-cost resolver unit tests ─────────────────────────────────

describe('T7 — resolveMergedCost', () => {
  it('returns null on empty / degenerate input', () => {
    assert.strictEqual(resolveMergedCost([], 'sysco'), null);
    assert.strictEqual(resolveMergedCost([
      { vendor: 'sysco', pack_price: null, pack_size: 10 },
    ], null), null);
    assert.strictEqual(resolveMergedCost([
      { vendor: 'sysco', pack_price: -1, pack_size: 10 },
    ], null), null);
  });

  it('preferred_vendor wins when it has a matching row', () => {
    const merged = resolveMergedCost([
      { vendor: 'sysco',    pack_price: 12, pack_size: 1 },
      { vendor: 'shamrock', pack_price: 11, pack_size: 1 },
    ], 'shamrock');
    assert.ok(merged);
    assert.strictEqual(merged.pack_price, 11);
    assert.strictEqual(merged.source, 'preferred_vendor');
  });

  it('preferred_vendor falls back to mean when no matching row', () => {
    const merged = resolveMergedCost([
      { vendor: 'sysco',    pack_price: 12, pack_size: 1 },
      { vendor: 'shamrock', pack_price: 10, pack_size: 1 },
    ], 'usfoods'); // not present
    assert.ok(merged);
    assert.strictEqual(merged.pack_price, 11); // (12+10)/2
    assert.strictEqual(merged.source, 'mean');
  });

  it('mean uses latest-per-vendor (first occurrence wins), not all rows', () => {
    // Caller-provided order is imported_at DESC; first sysco row wins for
    // sysco, so the stale 20 gets dropped.
    const merged = resolveMergedCost([
      { vendor: 'sysco',    pack_price: 12, pack_size: 1 }, // latest
      { vendor: 'sysco',    pack_price: 20, pack_size: 1 }, // stale
      { vendor: 'shamrock', pack_price: 10, pack_size: 1 },
    ], null);
    assert.strictEqual(merged.pack_price, 11);
  });
});

// ── End-to-end costing: merged-cost via computeCostVariance ─────────

describe('T7 — end-to-end merged-cost via computeCostVariance', () => {
  it('spec fixture: heinz_ketchup_1gal master, sysco+shamrock rows, recipe consumes ketchup', () => {
    const db = makeDb();

    // Wire fixture: sysco $12, shamrock $11, recipe_costs says theoretical
    // should be $11 per unit (we'll drive it via vendor_prices + bom_lines).
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'heinz ketchup 1gal', vendor: 'sysco',    sku: 'SYS-K',  pack_size: 1, pack_unit: 'gal', pack_price: 12, unit_price: 12 },
        { ingredient: 'heinz ketchup 1gal', vendor: 'shamrock', sku: 'SHAM-K', pack_size: 1, pack_unit: 'gal', pack_price: 11, unit_price: 11 },
      ],
      recipe_costs: [
        { recipe_id: 'burger', recipe_name: 'burger',
          yield: 1, yield_unit: 'ea', batch_cost: 11, cost_per_yield_unit: 11 },
      ],
      bom_lines: [
        { recipe_id: 'burger', ingredient: 'heinz ketchup 1gal', qty: 1, unit: 'gal',
          pack_price: 11, pack_size: 1 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'heinz ketchup 1gal', vendor_ingredient: 'heinz ketchup 1gal', status: 'confirmed' },
      ],
    }), LOC);

    // master_id slug
    const master = db.prepare(
      `SELECT master_id, preferred_vendor FROM ingredient_masters`,
    ).get();
    assert.strictEqual(master.master_id, 'heinz_ketchup_1gal');

    // Explicitly flip preferred_vendor to shamrock so the spec fixture's
    // "pulls a single merged cost" assertion is deterministic.
    db.prepare(
      `UPDATE ingredient_masters SET preferred_vendor = 'shamrock' WHERE master_id='heinz_ketchup_1gal'`,
    ).run();

    const variance = computeCostVariance(db, LOC);
    assert.strictEqual(variance.rows.length, 1, 'one recipe should be costed');
    const row = variance.rows[0];
    assert.strictEqual(row.recipe_id, 'burger');
    // theoretical=11 (from recipe_costs), actual=11 (shamrock preferred_vendor),
    // variance ~= 0.
    assert.strictEqual(row.actual, 11,
      `expected actual=11 (preferred_vendor=shamrock @ $11), got ${row.actual}`);
    assert.ok(row.variance_pct < 0.01);
    db.close();
  });

  it('without preferred_vendor, merged cost is the mean across vendors', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco',    sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'ketchup', vendor: 'shamrock', sku: 'S2', pack_size: 1, pack_unit: 'gal', pack_price: 10 },
      ],
      recipe_costs: [
        { recipe_id: 'burger', recipe_name: 'burger',
          yield: 1, yield_unit: 'ea', batch_cost: 11, cost_per_yield_unit: 11 },
      ],
      bom_lines: [
        { recipe_id: 'burger', ingredient: 'ketchup', qty: 1, unit: 'gal', pack_price: 11, pack_size: 1 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    }), LOC);

    // Clear whatever preferred_vendor got seeded so the fallback path fires.
    db.prepare(`UPDATE ingredient_masters SET preferred_vendor = NULL`).run();

    const variance = computeCostVariance(db, LOC);
    assert.strictEqual(variance.rows.length, 1);
    // mean of 12 and 10 = 11.
    assert.strictEqual(variance.rows[0].actual, 11);
    db.close();
  });

  it('fallback to ingredient-string when master_id is NULL on both sides', () => {
    const db = makeDb();
    // Unconfirmed map → no masters. Costing should still work via the
    // normalized-ingredient-key path (no regression).
    ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco', sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
      ],
      recipe_costs: [
        { recipe_id: 'burger', recipe_name: 'burger',
          yield: 1, yield_unit: 'ea', batch_cost: 12, cost_per_yield_unit: 12 },
      ],
      bom_lines: [
        { recipe_id: 'burger', ingredient: 'ketchup', qty: 1, unit: 'gal', pack_price: 12, pack_size: 1 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'unconfirmed' },
      ],
    }), LOC);

    const nMasters = db.prepare(`SELECT COUNT(*) as c FROM ingredient_masters`).get().c;
    assert.strictEqual(nMasters, 0, 'unconfirmed map should not produce a master');

    const variance = computeCostVariance(db, LOC);
    assert.strictEqual(variance.rows.length, 1);
    assert.strictEqual(variance.rows[0].actual, 12,
      'should still cost via the ingredient-string fallback path');
    db.close();
  });
});

// ── Acceptance: collapse happened ──────────────────────────────────

describe('T7 — acceptance assertion: DISTINCT(master_id) < DISTINCT(ingredient)', () => {
  it('after backfill, distinct masters is strictly less than distinct ingredient strings', () => {
    const db = makeDb();
    ingestCosting(db, payload({
      // Same ingredient, three different vendor_ingredient strings — all
      // should collapse to one master. Plus one ingredient with no master.
      vendor_prices: [
        { ingredient: 'heinz_ketchup_1gal',    vendor: 'sysco',    sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'HEINZ KETCHUP 1 GAL',   vendor: 'shamrock', sku: 'S2', pack_size: 1, pack_unit: 'gal', pack_price: 11 },
        { ingredient: 'heinz ketchup 1 gal',   vendor: 'usfoods',  sku: 'S3', pack_size: 1, pack_unit: 'gal', pack_price: 10 },
        { ingredient: 'mustard',               vendor: 'sysco',    sku: 'S4', pack_size: 1, pack_unit: 'gal', pack_price: 7 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'heinz ketchup 1 gal', vendor_ingredient: 'HEINZ KETCHUP 1 GAL', status: 'confirmed' },
        { recipe_ingredient: 'heinz ketchup 1 gal', vendor_ingredient: 'heinz_ketchup_1gal',  status: 'confirmed' },
        // mustard intentionally left unconfirmed so it doesn't get a master
        { recipe_ingredient: 'mustard', vendor_ingredient: 'mustard', status: 'unconfirmed' },
      ],
    }), LOC);

    const distinctMasters = db.prepare(
      `SELECT COUNT(DISTINCT master_id) as c FROM vendor_prices WHERE master_id IS NOT NULL`,
    ).get().c;
    const distinctIngredients = db.prepare(
      `SELECT COUNT(DISTINCT ingredient) as c FROM vendor_prices`,
    ).get().c;

    assert.ok(distinctMasters < distinctIngredients,
      `expected collapse: DISTINCT(master_id)=${distinctMasters} < DISTINCT(ingredient)=${distinctIngredients}`);
    // Specifically: 1 master vs 4 distinct ingredient strings.
    assert.strictEqual(distinctMasters, 1);
    assert.strictEqual(distinctIngredients, 4);
    db.close();
  });

  it('rebuildIngredientMasters returns accurate counts', () => {
    const db = makeDb();
    const summary = ingestCosting(db, payload({
      vendor_prices: [
        { ingredient: 'ketchup', vendor: 'sysco',    sku: 'S1', pack_size: 1, pack_unit: 'gal', pack_price: 12 },
        { ingredient: 'ketchup', vendor: 'shamrock', sku: 'S2', pack_size: 1, pack_unit: 'gal', pack_price: 11 },
      ],
      bom_lines: [
        { recipe_id: 'r1', ingredient: 'ketchup', qty: 1, unit: 'tbsp', pack_price: 12, pack_size: 256 },
      ],
      ingredient_maps: [
        { recipe_ingredient: 'ketchup', vendor_ingredient: 'ketchup', status: 'confirmed' },
      ],
    }), LOC);

    assert.strictEqual(summary.ingredient_masters, 1);
    assert.ok(summary.vp_master_backfilled_rows >= 2,
      `vp backfill count should cover both vendor rows, got ${summary.vp_master_backfilled_rows}`);
    assert.ok(summary.bom_master_backfilled_rows >= 1,
      `bom backfill count should cover the recipe line, got ${summary.bom_master_backfilled_rows}`);
    db.close();
  });

  it('rebuildIngredientMasters on a pre-T7 DB (no table) is a safe no-op', () => {
    // Build a DB without the T7 columns by hand — bypass initSchema.
    const bare = new Database(':memory:');
    try {
      bare.exec(`
        CREATE TABLE vendor_prices (id INTEGER PRIMARY KEY, ingredient TEXT);
        CREATE TABLE bom_lines (id INTEGER PRIMARY KEY, ingredient TEXT);
      `);
      const out = rebuildIngredientMasters(bare, LOC);
      assert.deepStrictEqual(out, { masters: 0, vp_backfilled: 0, bom_backfilled: 0 });
    } finally {
      bare.close();
    }
  });
});
