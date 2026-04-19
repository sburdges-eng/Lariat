#!/usr/bin/env node
// Tests for lib/db.ts schema migrations — T1 yield/loss/density additions.
// Run: node --test tests/js/test-schema-migrations.mjs
//
// Exercises:
//   - bom_lines gains yield_pct + loss_factor
//   - vendor_prices gains yield_pct
//   - ingredient_densities table exists with the right key shape
//   - initSchema() is idempotent (second invocation on the same DB is a no-op)
//
// All assertions read PRAGMA/sqlite_master directly against an in-memory
// database via setDbPathForTest(':memory:') — no mocks, no file side effects.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getDb, setDbPathForTest, initSchema } from '../../lib/db.ts';

// Shared fresh in-memory DB for the whole suite. Closed in the final `after`.
setDbPathForTest(':memory:');
const db = getDb();

after(() => {
  // Drop the test DB and reset the override so later suites (if any) hit the
  // production path.
  setDbPathForTest(null);
});

const columnsOf = (table) =>
  /** @type {{name: string}[]} */ (db.prepare(`PRAGMA table_info(${table})`).all())
    .map((c) => c.name);

describe('bom_lines schema — T1 additions', () => {
  it('has yield_pct column', () => {
    assert.ok(columnsOf('bom_lines').includes('yield_pct'), 'bom_lines.yield_pct missing');
  });

  it('has loss_factor column', () => {
    assert.ok(columnsOf('bom_lines').includes('loss_factor'), 'bom_lines.loss_factor missing');
  });

  it('yield_pct and loss_factor are REAL and nullable', () => {
    const info = /** @type {{name: string, type: string, notnull: number, dflt_value: unknown}[]} */ (
      db.prepare('PRAGMA table_info(bom_lines)').all()
    );
    const yp = info.find((c) => c.name === 'yield_pct');
    const lf = info.find((c) => c.name === 'loss_factor');
    assert.ok(yp, 'yield_pct row missing from PRAGMA output');
    assert.ok(lf, 'loss_factor row missing from PRAGMA output');
    assert.strictEqual(yp.type.toUpperCase(), 'REAL');
    assert.strictEqual(lf.type.toUpperCase(), 'REAL');
    assert.strictEqual(yp.notnull, 0, 'yield_pct should be nullable');
    assert.strictEqual(lf.notnull, 0, 'loss_factor should be nullable');
  });
});

describe('vendor_prices schema — T1 additions', () => {
  it('has yield_pct column', () => {
    assert.ok(columnsOf('vendor_prices').includes('yield_pct'), 'vendor_prices.yield_pct missing');
  });

  it('yield_pct is REAL and nullable', () => {
    const info = /** @type {{name: string, type: string, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(vendor_prices)').all()
    );
    const yp = info.find((c) => c.name === 'yield_pct');
    assert.ok(yp, 'yield_pct row missing from PRAGMA output');
    assert.strictEqual(yp.type.toUpperCase(), 'REAL');
    assert.strictEqual(yp.notnull, 0, 'vendor_prices.yield_pct should be nullable');
  });
});

describe('ingredient_densities table', () => {
  it('exists in sqlite_master', () => {
    const row = /** @type {{sql: string} | undefined} */ (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ingredient_densities'`).get()
    );
    assert.ok(row, 'ingredient_densities table not found');
    assert.ok(
      /PRIMARY KEY/i.test(row.sql),
      `expected PRIMARY KEY in CREATE TABLE ingredient_densities: ${row.sql}`,
    );
    // g_per_ml must be NOT NULL per spec.
    assert.ok(
      /g_per_ml[\s\S]*NOT NULL/i.test(row.sql),
      `expected g_per_ml NOT NULL in CREATE TABLE: ${row.sql}`,
    );
  });

  it('ingredient_key is the primary key', () => {
    const info = /** @type {{name: string, pk: number, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(ingredient_densities)').all()
    );
    const key = info.find((c) => c.name === 'ingredient_key');
    assert.ok(key, 'ingredient_key column missing');
    assert.strictEqual(key.pk, 1, 'ingredient_key must be the primary key');
  });

  it('g_per_ml is NOT NULL per PRAGMA', () => {
    const info = /** @type {{name: string, notnull: number, type: string}[]} */ (
      db.prepare('PRAGMA table_info(ingredient_densities)').all()
    );
    const col = info.find((c) => c.name === 'g_per_ml');
    assert.ok(col, 'g_per_ml column missing');
    assert.strictEqual(col.notnull, 1, 'g_per_ml must be NOT NULL');
    assert.strictEqual(col.type.toUpperCase(), 'REAL');
  });

  it('rejects inserts missing g_per_ml', () => {
    assert.throws(
      () => db.prepare('INSERT INTO ingredient_densities (ingredient_key) VALUES (?)').run('no_density'),
      /NOT NULL/i,
    );
  });

  it('accepts a well-formed row', () => {
    db.prepare(
      'INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES (?, ?, ?)',
    ).run('olive_oil', 0.915, 'seed');
    const row = /** @type {{ingredient_key: string, g_per_ml: number, source: string | null}} */ (
      db.prepare('SELECT ingredient_key, g_per_ml, source FROM ingredient_densities WHERE ingredient_key = ?')
        .get('olive_oil')
    );
    assert.strictEqual(row.ingredient_key, 'olive_oil');
    assert.strictEqual(row.g_per_ml, 0.915);
    assert.strictEqual(row.source, 'seed');
  });
});

describe('idempotency', () => {
  it('running initSchema again does not error and does not duplicate columns', () => {
    const before = columnsOf('bom_lines');
    assert.doesNotThrow(() => initSchema(db));
    const after = columnsOf('bom_lines');
    assert.deepStrictEqual(after, before, 'bom_lines column list changed on second initSchema');
    // yield_pct / loss_factor still appear exactly once.
    assert.strictEqual(after.filter((c) => c === 'yield_pct').length, 1);
    assert.strictEqual(after.filter((c) => c === 'loss_factor').length, 1);
  });

  it('second initSchema leaves vendor_prices.yield_pct present and unique', () => {
    initSchema(db);
    const cols = columnsOf('vendor_prices');
    assert.strictEqual(cols.filter((c) => c === 'yield_pct').length, 1);
  });

  it('ingredient_densities survives re-init with row intact', () => {
    initSchema(db);
    const row = /** @type {{g_per_ml: number} | undefined} */ (
      db.prepare('SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?').get('olive_oil')
    );
    assert.ok(row, 'seeded row disappeared after re-init');
    assert.strictEqual(row.g_per_ml, 0.915);
  });
});
