#!/usr/bin/env node
// T2c acceptance — ingest-costing yield wiring.
// Run: node --experimental-strip-types --test tests/js/test-ingest-costing-yields.mjs
//
// Verifies that scripts/ingest-costing.mjs populates:
//   - vendor_prices.yield_pct
//   - bom_lines.yield_pct
//   - bom_lines.loss_factor
// by joining on the ingredient_yields table via normalizeIngredientKey().
//
// Shape: seed a fresh in-memory DB with a realistic mix of yield rows, drive
// the refactored ingestCosting(db, data, locationId) callable with a synthetic
// payload, then assert coverage + NULL-preservation + exact loss_factor
// roundtrip + byte-exact normalization across common BOM-ingredient variants.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';
import { ingestCosting } from '../../scripts/ingest-costing.mjs';

const LOC = 'default';

// Seed spread: 4-5 yields <1.0 (produce/protein trim), 3-4 yields = 1.0
// (liquids/spices), and at least one loss_factor. Keys are produced via the
// shared normalizer — never pre-computed — so any drift between seed-time and
// ingest-time normalization surfaces here.
/** @type {Array<{raw: string, yield_pct: number, loss_factor: number | null, source: 'book_of_yields'|'lariat_measured'|'seed'}>} */
const YIELD_SEED = [
  { raw: 'Yellow Onion', yield_pct: 0.82, loss_factor: null, source: 'book_of_yields' },
  { raw: 'Avocado', yield_pct: 0.75, loss_factor: null, source: 'book_of_yields' },
  { raw: 'Tomato', yield_pct: 0.91, loss_factor: null, source: 'book_of_yields' },
  { raw: 'Cilantro', yield_pct: 0.56, loss_factor: null, source: 'book_of_yields' },
  { raw: 'Ribeye Steak', yield_pct: 0.88, loss_factor: 0.25, source: 'lariat_measured' },
  { raw: 'Water', yield_pct: 1.0, loss_factor: null, source: 'seed' },
  { raw: 'Salt', yield_pct: 1.0, loss_factor: null, source: 'seed' },
  { raw: 'Olive Oil', yield_pct: 1.0, loss_factor: null, source: 'seed' },
  { raw: 'Cumin', yield_pct: 1.0, loss_factor: null, source: 'seed' },
];

// 10 BOM rows: 6 distinct-seed matches + 4 misses.
// Row 3/4/5 exercise normalizer variants (bracket prefix, double space, all-caps)
// — all three must resolve to the same seeded 'yellow onion' key.
const BOM_PAYLOAD = [
  { recipe_id: 'r1', ingredient: 'avocado', qty: 2, unit: 'ea' },                   // match → 0.75
  { recipe_id: 'r1', ingredient: 'tomato', qty: 0.5, unit: 'lb' },                  // match → 0.91
  { recipe_id: 'r1', ingredient: '[JIT] Yellow Onion', qty: 1, unit: 'lb' },        // match after strip → 0.82
  { recipe_id: 'r2', ingredient: 'Yellow  Onion', qty: 1, unit: 'lb' },             // match after collapse → 0.82
  { recipe_id: 'r2', ingredient: 'YELLOW ONION', qty: 1, unit: 'lb' },              // match after lowercase → 0.82
  { recipe_id: 'r2', ingredient: 'ribeye steak', qty: 0.75, unit: 'lb' },           // match → 0.88, loss 0.25
  { recipe_id: 'r3', ingredient: 'asafoetida', qty: 0.01, unit: 'lb' },             // miss → NULL
  { recipe_id: 'r3', ingredient: 'fenugreek', qty: 0.01, unit: 'lb' },              // miss → NULL
  { recipe_id: 'r3', ingredient: 'galangal', qty: 0.02, unit: 'lb' },               // miss → NULL
  { recipe_id: 'r3', ingredient: 'sumac', qty: 0.01, unit: 'lb' },                  // miss → NULL
];

const VENDOR_PAYLOAD = [
  { ingredient: 'Avocado', vendor: 'sysco', pack_size: 48, pack_unit: 'ct', pack_price: 45.00, unit_price: 0.94 },
  { ingredient: 'Ribeye Steak', vendor: 'sysco', pack_size: 10, pack_unit: 'lb', pack_price: 150.00, unit_price: 15.00 },
  { ingredient: 'Asafoetida', vendor: 'penzeys', pack_size: 1, pack_unit: 'lb', pack_price: 25.00, unit_price: 25.00 },
];

function buildDb() {
  const db = new Database(':memory:');
  initSchema(db);

  const ins = db.prepare(
    'INSERT INTO ingredient_yields (ingredient_key, yield_pct, loss_factor, source) VALUES (?, ?, ?, ?)',
  );
  for (const row of YIELD_SEED) {
    ins.run(normalizeIngredientKey(row.raw), row.yield_pct, row.loss_factor, row.source);
  }

  return db;
}

describe('ingestCosting — yield wiring (T2c)', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;
  /** @type {ReturnType<typeof ingestCosting>} */
  let summary;

  before(() => {
    db = buildDb();
    summary = ingestCosting(
      db,
      { bom_lines: BOM_PAYLOAD, vendor_prices: VENDOR_PAYLOAD },
      LOC,
    );
  });

  after(() => {
    db?.close();
  });

  it('inserts all 10 BOM rows (no silent drops)', () => {
    const { c } = /** @type {{c:number}} */ (
      db.prepare('SELECT COUNT(*) AS c FROM bom_lines').get()
    );
    assert.strictEqual(c, 10);
  });

  it('yield_pct populated on exactly the 6 seeded-match rows', () => {
    const { c } = /** @type {{c:number}} */ (
      db.prepare('SELECT COUNT(*) AS c FROM bom_lines WHERE yield_pct IS NOT NULL').get()
    );
    // 6 BOM ingredients match seed: avocado, tomato, 3× yellow onion variants, ribeye.
    assert.strictEqual(c, 6, 'expected exactly 6 rows with yield_pct');
  });

  it('coverage ratio ≥ 50%', () => {
    const { pct } = /** @type {{pct:number}} */ (
      db
        .prepare(
          `SELECT 100.0 * COUNT(*) FILTER (WHERE yield_pct IS NOT NULL) / COUNT(*) AS pct FROM bom_lines`,
        )
        .get()
    );
    assert.ok(pct >= 50.0, `coverage ${pct} should be ≥ 50%`);
    // The summary returned by ingestCosting must agree with the DB query.
    assert.strictEqual(Math.round(summary.bom_coverage_pct * 100) / 100, Math.round(pct * 100) / 100);
  });

  it('loss_factor roundtrips exactly for ribeye (no drift/rounding)', () => {
    const row = /** @type {{loss_factor:number|null}} */ (
      db
        .prepare('SELECT loss_factor FROM bom_lines WHERE ingredient LIKE ? LIMIT 1')
        .get('%ribeye%')
    );
    assert.strictEqual(row.loss_factor, 0.25);
  });

  it('yield_pct roundtrips exactly for ribeye', () => {
    const row = /** @type {{yield_pct:number|null}} */ (
      db
        .prepare('SELECT yield_pct FROM bom_lines WHERE ingredient LIKE ? LIMIT 1')
        .get('%ribeye%')
    );
    assert.strictEqual(row.yield_pct, 0.88);
  });

  it('NULL is preserved as SQL NULL (not string "null") on miss', () => {
    const row = /** @type {{yield_pct:number|null, loss_factor:number|null}} */ (
      db
        .prepare('SELECT yield_pct, loss_factor FROM bom_lines WHERE ingredient = ?')
        .get('asafoetida')
    );
    assert.strictEqual(row.yield_pct, null);
    assert.strictEqual(row.loss_factor, null);
    // Double-check the type: SQLite stores NULL when bound with JS null.
    // A stringified "null" would fail a strict-null check and would return a string here.
    assert.notStrictEqual(row.yield_pct, 'null');
  });

  it('bom_lines.loss_factor is NULL for matches without a seeded loss_factor (avocado)', () => {
    const row = /** @type {{yield_pct:number|null, loss_factor:number|null}} */ (
      db
        .prepare('SELECT yield_pct, loss_factor FROM bom_lines WHERE ingredient = ?')
        .get('avocado')
    );
    assert.strictEqual(row.yield_pct, 0.75);
    assert.strictEqual(row.loss_factor, null);
  });

  it('vendor_prices.yield_pct populated on matches, NULL on misses', () => {
    const rows = /** @type {Array<{ingredient:string, yield_pct:number|null}>} */ (
      db
        .prepare('SELECT ingredient, yield_pct FROM vendor_prices ORDER BY ingredient')
        .all()
    );
    const byName = Object.fromEntries(rows.map((r) => [r.ingredient.toLowerCase(), r.yield_pct]));
    assert.strictEqual(byName['avocado'], 0.75);
    assert.strictEqual(byName['ribeye steak'], 0.88);
    assert.strictEqual(byName['asafoetida'], null);
  });

  it('vendor_prices schema has no loss_factor column (bom_lines-only per T1)', () => {
    const cols = /** @type {Array<{name:string}>} */ (
      db.prepare('PRAGMA table_info(vendor_prices)').all()
    ).map((c) => c.name);
    assert.ok(!cols.includes('loss_factor'), 'vendor_prices must NOT have loss_factor');
    assert.ok(cols.includes('yield_pct'), 'vendor_prices must have yield_pct');
  });
});

describe('ingestCosting — byte-exact normalization at ingest time', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;

  before(() => {
    db = buildDb();
    ingestCosting(
      db,
      { bom_lines: BOM_PAYLOAD, vendor_prices: VENDOR_PAYLOAD },
      LOC,
    );
  });

  after(() => {
    db?.close();
  });

  // The seeded key is 'yellow onion' (from normalizing 'Yellow Onion').
  // All three BOM rows must look up to the same yield (0.82) or the ingest
  // is using a non-shared normalizer. This is the drift-catch test.

  it('[JIT] Yellow Onion strips bracket prefix and resolves to yellow onion yield', () => {
    const row = /** @type {{yield_pct:number|null}} */ (
      db
        .prepare('SELECT yield_pct FROM bom_lines WHERE ingredient = ?')
        .get('[JIT] Yellow Onion')
    );
    assert.strictEqual(row.yield_pct, 0.82);
  });

  it('Yellow  Onion (double space) collapses and resolves to yellow onion yield', () => {
    const row = /** @type {{yield_pct:number|null}} */ (
      db
        .prepare('SELECT yield_pct FROM bom_lines WHERE ingredient = ?')
        .get('Yellow  Onion')
    );
    assert.strictEqual(row.yield_pct, 0.82);
  });

  it('YELLOW ONION (all caps) lowercases and resolves to yellow onion yield', () => {
    const row = /** @type {{yield_pct:number|null}} */ (
      db
        .prepare('SELECT yield_pct FROM bom_lines WHERE ingredient = ?')
        .get('YELLOW ONION')
    );
    assert.strictEqual(row.yield_pct, 0.82);
  });

  it('all three normalization variants produce the same key', () => {
    assert.strictEqual(normalizeIngredientKey('[JIT] Yellow Onion'), 'yellow onion');
    assert.strictEqual(normalizeIngredientKey('Yellow  Onion'), 'yellow onion');
    assert.strictEqual(normalizeIngredientKey('YELLOW ONION'), 'yellow onion');
  });
});

describe('ingestCosting — non-yield behavior preserved', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;

  before(() => {
    db = buildDb();
  });

  after(() => {
    db?.close();
  });

  it('returns a summary with the expected shape and counts', () => {
    const s = ingestCosting(
      db,
      { bom_lines: BOM_PAYLOAD, vendor_prices: VENDOR_PAYLOAD },
      LOC,
    );
    assert.strictEqual(s.bom_lines, 10);
    assert.strictEqual(s.vendor_prices, 3);
    assert.strictEqual(s.bom_lines_with_yield, 6);
    assert.ok(s.bom_coverage_pct >= 50);
    assert.ok(s.bom_coverage_pct <= 100);
  });

  it('re-running ingest is idempotent (DELETE+INSERT sweep on same location)', () => {
    const s2 = ingestCosting(
      db,
      { bom_lines: BOM_PAYLOAD, vendor_prices: VENDOR_PAYLOAD },
      LOC,
    );
    const { c } = /** @type {{c:number}} */ (
      db.prepare('SELECT COUNT(*) AS c FROM bom_lines').get()
    );
    assert.strictEqual(c, 10, 'second ingest must leave 10 rows, not 20');
    assert.strictEqual(s2.bom_lines, 10);
  });

  it('runs the sub-recipe rollup as part of the post-pass', () => {
    // The existing fixture has no sub-recipes — assert the rollup ran (it's a
    // no-op on this dataset) without exploding, and that the new counters
    // appear on the summary.
    const summary = ingestCosting(
      db,
      { bom_lines: BOM_PAYLOAD, vendor_prices: VENDOR_PAYLOAD },
      LOC,
    );
    assert.ok('subrecipe_rollup_updated' in summary, 'summary.subrecipe_rollup_updated missing');
    assert.ok('subrecipe_rollup_cycles' in summary, 'summary.subrecipe_rollup_cycles missing');
    assert.ok('subrecipe_rollup_unconverted' in summary, 'summary.subrecipe_rollup_unconverted missing');
    assert.ok('subrecipe_flags_set' in summary, 'summary.subrecipe_flags_set missing');
    assert.equal(summary.subrecipe_rollup_cycles, 0);
  });
});
