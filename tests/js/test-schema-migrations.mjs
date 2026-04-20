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
import Database from 'better-sqlite3';

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

  it('rejects invalid source values via CHECK constraint', () => {
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES (?, ?, ?)')
          .run('x', 1.0, 'NOT_A_VALID_SOURCE'),
      /CHECK/i,
    );
  });

  it('accepts source=seed and source=null', () => {
    // source='seed' already exercised by 'accepts a well-formed row' above
    // via olive_oil; repeat with a distinct key to isolate this assertion.
    db.prepare(
      'INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES (?, ?, ?)',
    ).run('water_seed', 1.0, 'seed');
    const rowSeed = /** @type {{source: string | null}} */ (
      db.prepare('SELECT source FROM ingredient_densities WHERE ingredient_key = ?').get('water_seed')
    );
    assert.strictEqual(rowSeed.source, 'seed');

    db.prepare(
      'INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES (?, ?, ?)',
    ).run('water_null', 1.0, null);
    const rowNull = /** @type {{source: string | null}} */ (
      db.prepare('SELECT source FROM ingredient_densities WHERE ingredient_key = ?').get('water_null')
    );
    assert.strictEqual(rowNull.source, null);
  });
});

describe('ingredient_yields table — T2a', () => {
  it('exists in sqlite_master with PRIMARY KEY', () => {
    const row = /** @type {{sql: string} | undefined} */ (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ingredient_yields'`).get()
    );
    assert.ok(row, 'ingredient_yields table not found');
    assert.ok(
      /PRIMARY KEY/i.test(row.sql),
      `expected PRIMARY KEY in CREATE TABLE ingredient_yields: ${row.sql}`,
    );
    // yield_pct must be NOT NULL; loss_factor is nullable.
    assert.ok(
      /yield_pct[\s\S]*NOT NULL/i.test(row.sql),
      `expected yield_pct NOT NULL in CREATE TABLE: ${row.sql}`,
    );
    // source must be NOT NULL per spec.
    assert.ok(
      /source[\s\S]*NOT NULL/i.test(row.sql),
      `expected source NOT NULL in CREATE TABLE: ${row.sql}`,
    );
  });

  it('ingredient_key is the primary key', () => {
    const info = /** @type {{name: string, pk: number, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(ingredient_yields)').all()
    );
    const key = info.find((c) => c.name === 'ingredient_key');
    assert.ok(key, 'ingredient_key column missing');
    assert.strictEqual(key.pk, 1, 'ingredient_key must be the primary key');
  });

  it('yield_pct is REAL NOT NULL; loss_factor REAL nullable; source NOT NULL; notes nullable', () => {
    const info = /** @type {{name: string, notnull: number, type: string}[]} */ (
      db.prepare('PRAGMA table_info(ingredient_yields)').all()
    );
    const yp = info.find((c) => c.name === 'yield_pct');
    const lf = info.find((c) => c.name === 'loss_factor');
    const src = info.find((c) => c.name === 'source');
    const notes = info.find((c) => c.name === 'notes');
    assert.ok(yp, 'yield_pct column missing');
    assert.ok(lf, 'loss_factor column missing');
    assert.ok(src, 'source column missing');
    assert.ok(notes, 'notes column missing');
    assert.strictEqual(yp.type.toUpperCase(), 'REAL');
    assert.strictEqual(yp.notnull, 1, 'yield_pct must be NOT NULL');
    assert.strictEqual(lf.type.toUpperCase(), 'REAL');
    assert.strictEqual(lf.notnull, 0, 'loss_factor must be nullable');
    assert.strictEqual(src.type.toUpperCase(), 'TEXT');
    assert.strictEqual(src.notnull, 1, 'source must be NOT NULL');
    assert.strictEqual(notes.notnull, 0, 'notes must be nullable');
  });

  it('rejects inserts missing yield_pct', () => {
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO ingredient_yields (ingredient_key, source) VALUES (?, ?)')
          .run('no_yield', 'seed'),
      /NOT NULL/i,
    );
  });

  it('rejects inserts missing source', () => {
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO ingredient_yields (ingredient_key, yield_pct) VALUES (?, ?)')
          .run('no_source', 0.85),
      /NOT NULL/i,
    );
  });

  it('accepts a well-formed row and round-trips loss_factor=null', () => {
    db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, loss_factor, source, notes) VALUES (?, ?, ?, ?, ?)',
    ).run('yellow onion', 0.85, null, 'book_of_yields', 'peeled and trimmed');
    const row = /** @type {{ingredient_key: string, yield_pct: number, loss_factor: number | null, source: string, notes: string | null}} */ (
      db
        .prepare(
          'SELECT ingredient_key, yield_pct, loss_factor, source, notes FROM ingredient_yields WHERE ingredient_key = ?',
        )
        .get('yellow onion')
    );
    assert.strictEqual(row.ingredient_key, 'yellow onion');
    assert.strictEqual(row.yield_pct, 0.85);
    assert.strictEqual(row.loss_factor, null);
    assert.strictEqual(row.source, 'book_of_yields');
    assert.strictEqual(row.notes, 'peeled and trimmed');
  });

  it('accepts a well-formed row with loss_factor set', () => {
    db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, loss_factor, source) VALUES (?, ?, ?, ?)',
    ).run('ground beef 80 20', 1.0, 0.25, 'lariat_measured');
    const row = /** @type {{yield_pct: number, loss_factor: number}} */ (
      db
        .prepare('SELECT yield_pct, loss_factor FROM ingredient_yields WHERE ingredient_key = ?')
        .get('ground beef 80 20')
    );
    assert.strictEqual(row.yield_pct, 1.0);
    assert.strictEqual(row.loss_factor, 0.25);
  });

  it('PRIMARY KEY blocks duplicate ingredient_key inserts', () => {
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, ?)')
          .run('yellow onion', 0.90, 'lariat_measured'),
      /UNIQUE/i,
    );
  });

  it('rejects invalid source values via CHECK constraint', () => {
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, ?)')
          .run('bad_src', 0.5, 'notarealsource'),
      /CHECK/i,
    );
  });

  it('accepts all three legal source values', () => {
    // 'book_of_yields' already covered above by 'yellow onion'; re-exercise
    // with a distinct key to make this assertion self-contained.
    db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, ?)',
    ).run('onion_boy', 0.85, 'book_of_yields');
    db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, ?)',
    ).run('onion_measured', 0.88, 'lariat_measured');
    db.prepare(
      'INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, ?)',
    ).run('onion_seed', 0.80, 'seed');
    const sources = /** @type {{ingredient_key: string, source: string}[]} */ (
      db
        .prepare(
          `SELECT ingredient_key, source FROM ingredient_yields
           WHERE ingredient_key IN ('onion_boy', 'onion_measured', 'onion_seed')
           ORDER BY ingredient_key`,
        )
        .all()
    );
    assert.deepStrictEqual(
      sources.map((r) => [r.ingredient_key, r.source]),
      [
        ['onion_boy', 'book_of_yields'],
        ['onion_measured', 'lariat_measured'],
        ['onion_seed', 'seed'],
      ],
    );
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

  it('ingredient_yields survives re-init with rows intact', () => {
    initSchema(db);
    const row = /** @type {{yield_pct: number, source: string} | undefined} */ (
      db
        .prepare('SELECT yield_pct, source FROM ingredient_yields WHERE ingredient_key = ?')
        .get('yellow onion')
    );
    assert.ok(row, 'seeded yield row disappeared after re-init');
    assert.strictEqual(row.yield_pct, 0.85);
    assert.strictEqual(row.source, 'book_of_yields');
  });
});

describe('legacy schema migration — pre-T1 bom_lines', () => {
  it('migrates legacy bom_lines table preserving rows', () => {
    // Build an isolated DB that mimics the production pre-T1 state: bom_lines
    // exists with the old column set (no yield_pct, no loss_factor) and has a
    // row in it. We bypass getDb()/setDbPathForTest so this test doesn't share
    // state with the fresh-DB suites above.
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`
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
          imported_at TEXT DEFAULT (datetime('now'))
        );
      `);

      legacy.prepare(
        `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit)
         VALUES (?, ?, ?, ?)`,
      ).run('r1', 'diced onion', 1.0, 'lb');

      // Sanity check: pre-migration, yield_pct does not exist yet.
      const preCols = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(bom_lines)').all()
      ).map((c) => c.name);
      assert.ok(!preCols.includes('yield_pct'), 'legacy fixture should not have yield_pct');
      assert.ok(!preCols.includes('loss_factor'), 'legacy fixture should not have loss_factor');

      // Run the production migration path against the hand-crafted DB.
      initSchema(legacy);

      // Row must still be present.
      const count = /** @type {{c: number}} */ (
        legacy.prepare(`SELECT COUNT(*) AS c FROM bom_lines`).get()
      ).c;
      assert.strictEqual(count, 1, 'existing row was lost during migration');

      const ingredient = /** @type {{ingredient: string} | undefined} */ (
        legacy.prepare(`SELECT ingredient FROM bom_lines WHERE recipe_id = ?`).get('r1')
      );
      assert.ok(ingredient, 'seeded row disappeared after migration');
      assert.strictEqual(ingredient.ingredient, 'diced onion');

      // New columns must exist post-migration.
      const postCols = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(bom_lines)').all()
      ).map((c) => c.name);
      assert.ok(postCols.includes('yield_pct'), 'yield_pct not added by migration');
      assert.ok(postCols.includes('loss_factor'), 'loss_factor not added by migration');

      // Pre-existing row must have NULL in both new columns (ALTER ADD COLUMN
      // with no default on REAL yields NULL for prior rows).
      const yl = /** @type {{yield_pct: number | null, loss_factor: number | null}} */ (
        legacy.prepare(
          `SELECT yield_pct, loss_factor FROM bom_lines WHERE recipe_id = ?`,
        ).get('r1')
      );
      assert.strictEqual(yl.yield_pct, null, 'yield_pct should be NULL for pre-migration row');
      assert.strictEqual(yl.loss_factor, null, 'loss_factor should be NULL for pre-migration row');
    } finally {
      legacy.close();
    }
  });

  it('raises on malformed ingredient_yields table from a partial deploy', () => {
    // Simulate a legacy DB where a previous incomplete deploy left an
    // ingredient_yields table with a wrong column set. CREATE TABLE IF NOT
    // EXISTS would silently skip it; assertCriticalSchemas must throw.
    const drifted = new Database(':memory:');
    try {
      drifted.exec(`
        CREATE TABLE ingredient_yields (
          ingredient_key TEXT PRIMARY KEY,
          pct REAL
        );
      `);
      assert.throws(
        () => initSchema(drifted),
        /schema drift on 'ingredient_yields'.*missing columns/,
      );
    } finally {
      drifted.close();
    }
  });
});
