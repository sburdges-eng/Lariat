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

describe('T6 — pack_size_changes schema', () => {
  it('initSchema creates pack_size_changes with the expected columns', () => {
    const info = /** @type {{name: string, type: string, notnull: number, dflt_value: unknown}[]} */ (
      db.prepare('PRAGMA table_info(pack_size_changes)').all()
    );
    const byName = new Map(info.map((c) => [c.name, c]));
    for (const name of [
      'id', 'vendor', 'sku', 'prev_pack', 'new_pack',
      'prev_price', 'new_price', 'detected_at', 'acknowledged',
    ]) {
      assert.ok(byName.has(name), `pack_size_changes.${name} missing`);
    }
    assert.strictEqual(byName.get('vendor').notnull, 1, 'vendor must be NOT NULL');
    assert.strictEqual(byName.get('sku').notnull, 1, 'sku must be NOT NULL');
    assert.strictEqual(byName.get('prev_pack').type.toUpperCase(), 'TEXT');
    assert.strictEqual(byName.get('new_pack').type.toUpperCase(), 'TEXT');
    assert.strictEqual(byName.get('prev_price').type.toUpperCase(), 'REAL');
    assert.strictEqual(byName.get('new_price').type.toUpperCase(), 'REAL');
    // id is the PRIMARY KEY AUTOINCREMENT column.
    assert.strictEqual(byName.get('id').pk, 1, 'id must be the primary key');
  });

  it('acknowledged defaults to 0', () => {
    const r = db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, prev_price, new_price)
       VALUES ('sysco', 'T6-TEST', '6x#10', '4x#10', 42.0, 36.0)`,
    ).run();
    const row = /** @type {{acknowledged: number, detected_at: string}} */ (
      db.prepare('SELECT acknowledged, detected_at FROM pack_size_changes WHERE id = ?').get(r.lastInsertRowid)
    );
    assert.strictEqual(row.acknowledged, 0);
    assert.ok(typeof row.detected_at === 'string' && row.detected_at.length > 0,
      'detected_at default must populate on insert');
  });

  it('rejects inserts missing vendor or sku', () => {
    assert.throws(() =>
      db.prepare(
        `INSERT INTO pack_size_changes (sku, prev_pack, new_pack) VALUES (?, ?, ?)`,
      ).run('S', 'p', 'n'),
      /NOT NULL/i,
    );
    assert.throws(() =>
      db.prepare(
        `INSERT INTO pack_size_changes (vendor, prev_pack, new_pack) VALUES (?, ?, ?)`,
      ).run('V', 'p', 'n'),
      /NOT NULL/i,
    );
  });
});

describe('T6 — vendor_prices.map_status migration', () => {
  it('pre-T6 vendor_prices without map_status gets the column ALTERed in', () => {
    const legacy = new Database(':memory:');
    try {
      // Simulate a post-T5a, pre-T6 DB: vendor_prices has yield_pct +
      // catch-weight columns but no map_status yet.
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
          reconciled_unit_price REAL
        );
        INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price)
        VALUES ('Legacy', 'sysco', 'LEGACY-1', 6, '#10', 42.0);
      `);

      const pre = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(vendor_prices)').all()
      ).map((c) => c.name);
      assert.ok(!pre.includes('map_status'), 'pre-migration fixture must not have map_status');

      initSchema(legacy);

      const post = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(vendor_prices)').all()
      ).map((c) => c.name);
      assert.ok(post.includes('map_status'), 'migration did not add vendor_prices.map_status');

      // Legacy row must survive, with NULL in the freshly added column.
      const row = /** @type {{ingredient: string, map_status: string | null}} */ (
        legacy.prepare(`SELECT ingredient, map_status FROM vendor_prices WHERE sku = 'LEGACY-1'`).get()
      );
      assert.strictEqual(row.ingredient, 'Legacy');
      assert.strictEqual(row.map_status, null);
    } finally {
      legacy.close();
    }
  });

  it('map_status is TEXT and nullable', () => {
    const info = /** @type {{name: string, type: string, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(vendor_prices)').all()
    );
    const ms = info.find((c) => c.name === 'map_status');
    assert.ok(ms, 'vendor_prices.map_status missing');
    assert.strictEqual(ms.type.toUpperCase(), 'TEXT');
    assert.strictEqual(ms.notnull, 0, 'vendor_prices.map_status must be nullable');
  });
});

describe('T7 — ingredient_masters schema', () => {
  it('exists in sqlite_master with master_id PRIMARY KEY', () => {
    const row = /** @type {{sql: string} | undefined} */ (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ingredient_masters'`).get()
    );
    assert.ok(row, 'ingredient_masters table not found');
    assert.ok(/PRIMARY KEY/i.test(row.sql),
      `expected PRIMARY KEY in CREATE TABLE ingredient_masters: ${row.sql}`);
    assert.ok(/canonical_name[\s\S]*NOT NULL/i.test(row.sql),
      `expected canonical_name NOT NULL: ${row.sql}`);
  });

  it('has required columns with correct nullability', () => {
    const info = /** @type {{name: string, pk: number, notnull: number, type: string}[]} */ (
      db.prepare('PRAGMA table_info(ingredient_masters)').all()
    );
    const byName = new Map(info.map((c) => [c.name, c]));
    for (const name of ['master_id', 'canonical_name', 'category',
                        'preferred_vendor', 'last_reviewed']) {
      assert.ok(byName.has(name), `ingredient_masters.${name} missing`);
    }
    assert.strictEqual(byName.get('master_id').pk, 1, 'master_id must be PK');
    assert.strictEqual(byName.get('canonical_name').notnull, 1,
      'canonical_name must be NOT NULL');
    assert.strictEqual(byName.get('category').notnull, 0, 'category must be nullable');
    assert.strictEqual(byName.get('preferred_vendor').notnull, 0,
      'preferred_vendor must be nullable');
    assert.strictEqual(byName.get('last_reviewed').notnull, 0,
      'last_reviewed must be nullable');
  });

  it('rejects duplicate master_id via PRIMARY KEY', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('t7_dup', 'Test Dup')`,
    ).run();
    assert.throws(
      () => db.prepare(
        `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('t7_dup', 'Test Dup 2')`,
      ).run(),
      /UNIQUE|PRIMARY/i,
    );
  });

  it('rejects inserts missing canonical_name', () => {
    assert.throws(
      () => db.prepare(
        `INSERT INTO ingredient_masters (master_id) VALUES ('t7_noname')`,
      ).run(),
      /NOT NULL/i,
    );
  });
});

describe('T7 — vendor_prices.master_id migration', () => {
  it('pre-T7 vendor_prices without master_id gets the column ALTERed in', () => {
    const legacy = new Database(':memory:');
    try {
      // Post-T6, pre-T7 shape: vendor_prices has yield_pct + catch-weight +
      // map_status, but no master_id.
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
        INSERT INTO vendor_prices (ingredient, vendor, sku, pack_price)
        VALUES ('Legacy VP', 'sysco', 'LEGACY-1', 10.0);
      `);
      const pre = legacy.prepare('PRAGMA table_info(vendor_prices)').all()
        .map((c) => c.name);
      assert.ok(!pre.includes('master_id'),
        'pre-migration fixture must not have master_id');

      initSchema(legacy);

      const post = legacy.prepare('PRAGMA table_info(vendor_prices)').all()
        .map((c) => c.name);
      assert.ok(post.includes('master_id'),
        'migration did not add vendor_prices.master_id');

      const row = /** @type {{ingredient: string, master_id: string | null}} */ (
        legacy.prepare(`SELECT ingredient, master_id FROM vendor_prices WHERE sku='LEGACY-1'`).get()
      );
      assert.strictEqual(row.ingredient, 'Legacy VP');
      assert.strictEqual(row.master_id, null,
        'ALTER ADD COLUMN must land NULL on pre-existing rows');
    } finally {
      legacy.close();
    }
  });

  it('master_id is TEXT and nullable', () => {
    const info = /** @type {{name: string, type: string, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(vendor_prices)').all()
    );
    const ms = info.find((c) => c.name === 'master_id');
    assert.ok(ms, 'vendor_prices.master_id missing');
    assert.strictEqual(ms.type.toUpperCase(), 'TEXT');
    assert.strictEqual(ms.notnull, 0, 'vendor_prices.master_id must be nullable');
  });
});

describe('T7 — bom_lines.master_id migration', () => {
  it('pre-T7 bom_lines without master_id gets the column ALTERed in', () => {
    const legacy = new Database(':memory:');
    try {
      // Post-T1, pre-T7 shape: bom_lines already has yield_pct + loss_factor.
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
          imported_at TEXT DEFAULT (datetime('now')),
          yield_pct REAL,
          loss_factor REAL
        );
        INSERT INTO bom_lines (recipe_id, ingredient, qty, unit)
        VALUES ('r1', 'Legacy BOM', 1.0, 'lb');
      `);
      const pre = legacy.prepare('PRAGMA table_info(bom_lines)').all()
        .map((c) => c.name);
      assert.ok(!pre.includes('master_id'),
        'pre-migration fixture must not have master_id');

      initSchema(legacy);

      const post = legacy.prepare('PRAGMA table_info(bom_lines)').all()
        .map((c) => c.name);
      assert.ok(post.includes('master_id'),
        'migration did not add bom_lines.master_id');

      const row = /** @type {{ingredient: string, master_id: string | null}} */ (
        legacy.prepare(`SELECT ingredient, master_id FROM bom_lines WHERE recipe_id='r1'`).get()
      );
      assert.strictEqual(row.ingredient, 'Legacy BOM');
      assert.strictEqual(row.master_id, null);
    } finally {
      legacy.close();
    }
  });

  it('master_id is TEXT and nullable', () => {
    const info = /** @type {{name: string, type: string, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(bom_lines)').all()
    );
    const ms = info.find((c) => c.name === 'master_id');
    assert.ok(ms, 'bom_lines.master_id missing');
    assert.strictEqual(ms.type.toUpperCase(), 'TEXT');
    assert.strictEqual(ms.notnull, 0, 'bom_lines.master_id must be nullable');
  });
});

describe('T7 — master_id indexes exist', () => {
  it('idx_vp_master on vendor_prices(master_id)', () => {
    const rows = /** @type {{name: string}[]} */ (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all()
    );
    const names = rows.map((r) => r.name);
    assert.ok(names.includes('idx_vp_master'),
      `idx_vp_master missing from ${JSON.stringify(names)}`);
  });

  it('idx_bom_master on bom_lines(master_id)', () => {
    const rows = /** @type {{name: string}[]} */ (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all()
    );
    const names = rows.map((r) => r.name);
    assert.ok(names.includes('idx_bom_master'),
      `idx_bom_master missing from ${JSON.stringify(names)}`);
  });
});

describe('receiving master contract schema', () => {
  it('receiving_log carries the match contract columns', () => {
    const info = /** @type {{name: string, type: string, notnull: number, dflt_value: unknown}[]} */ (
      db.prepare('PRAGMA table_info(receiving_log)').all()
    );
    const byName = new Map(info.map((c) => [c.name, c]));
    for (const name of ['vendor_sku', 'master_id', 'match_status', 'match_reason']) {
      assert.ok(byName.has(name), `receiving_log.${name} missing`);
      assert.strictEqual(byName.get(name).type.toUpperCase(), 'TEXT');
      assert.strictEqual(byName.get(name).notnull, 0, `receiving_log.${name} must be nullable`);
    }
  });

  it('inventory_updates carries source receiving and master columns', () => {
    const info = /** @type {{name: string, type: string, notnull: number}[]} */ (
      db.prepare('PRAGMA table_info(inventory_updates)').all()
    );
    const byName = new Map(info.map((c) => [c.name, c]));
    assert.ok(byName.has('master_id'), 'inventory_updates.master_id missing');
    assert.strictEqual(byName.get('master_id').type.toUpperCase(), 'TEXT');
    assert.strictEqual(byName.get('master_id').notnull, 0);
    assert.ok(byName.has('receiving_log_id'), 'inventory_updates.receiving_log_id missing');
    assert.strictEqual(byName.get('receiving_log_id').type.toUpperCase(), 'INTEGER');
    assert.strictEqual(byName.get('receiving_log_id').notnull, 0);
  });

  it('pre-contract receiving_log migrates without losing rows', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`
        CREATE TABLE receiving_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_date TEXT NOT NULL,
          location_id TEXT DEFAULT 'default',
          vendor TEXT NOT NULL,
          invoice_ref TEXT,
          category TEXT NOT NULL,
          item TEXT,
          reading_f REAL,
          required_max_f REAL,
          package_ok INTEGER,
          expiration_date TEXT,
          received_qty REAL,
          received_unit TEXT,
          status TEXT NOT NULL
            CHECK(status IN ('accepted','rejected','accepted_with_note')),
          rejection_reason TEXT,
          shellstock_tag_ref TEXT,
          cook_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO receiving_log (
          shift_date, vendor, category, item, received_qty, received_unit, status
        ) VALUES (
          '2026-05-26', 'Legacy Vendor', 'refrigerated', 'Legacy Item', 1.0, 'case', 'accepted'
        );
      `);

      initSchema(legacy);

      const cols = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(receiving_log)').all()
      ).map((c) => c.name);
      for (const name of ['vendor_sku', 'master_id', 'match_status', 'match_reason']) {
        assert.ok(cols.includes(name), `migration did not add receiving_log.${name}`);
      }
      const row = /** @type {{vendor: string, vendor_sku: string | null, master_id: string | null, match_status: string | null, match_reason: string | null}} */ (
        legacy.prepare('SELECT vendor, vendor_sku, master_id, match_status, match_reason FROM receiving_log').get()
      );
      assert.strictEqual(row.vendor, 'Legacy Vendor');
      assert.strictEqual(row.vendor_sku, null);
      assert.strictEqual(row.master_id, null);
      assert.strictEqual(row.match_status, 'not_attempted');
      assert.strictEqual(row.match_reason, null);
    } finally {
      legacy.close();
    }
  });

  it('pre-contract inventory_updates migrates without losing rows', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`
        CREATE TABLE inventory_updates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_date TEXT NOT NULL,
          station_id TEXT,
          item TEXT NOT NULL,
          delta TEXT,
          direction TEXT,
          note TEXT,
          cook_id TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          location_id TEXT DEFAULT 'default'
        );
        INSERT INTO inventory_updates (shift_date, item, delta, direction)
        VALUES ('2026-05-26', 'Legacy Item', '1 case', 'in');
      `);

      initSchema(legacy);

      const cols = /** @type {{name: string}[]} */ (
        legacy.prepare('PRAGMA table_info(inventory_updates)').all()
      ).map((c) => c.name);
      assert.ok(cols.includes('master_id'), 'migration did not add inventory_updates.master_id');
      assert.ok(cols.includes('receiving_log_id'), 'migration did not add inventory_updates.receiving_log_id');
      const row = /** @type {{item: string, master_id: string | null, receiving_log_id: number | null}} */ (
        legacy.prepare('SELECT item, master_id, receiving_log_id FROM inventory_updates').get()
      );
      assert.strictEqual(row.item, 'Legacy Item');
      assert.strictEqual(row.master_id, null);
      assert.strictEqual(row.receiving_log_id, null);
    } finally {
      legacy.close();
    }
  });
});

describe('T7 — assertCriticalSchemas catches drift on ingredient_masters', () => {
  it('throws when a legacy ingredient_masters is missing required columns', () => {
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

describe('T6 — assertCriticalSchemas catches drift on pack_size_changes', () => {
  it('throws when a legacy pack_size_changes is missing required columns', () => {
    const drifted = new Database(':memory:');
    try {
      // Partial-deploy fixture: only vendor + sku present, everything else
      // missing. CREATE TABLE IF NOT EXISTS would silently skip it.
      drifted.exec(`
        CREATE TABLE pack_size_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendor TEXT NOT NULL,
          sku TEXT NOT NULL
        );
      `);
      assert.throws(
        () => initSchema(drifted),
        (err) =>
          err instanceof Error &&
          /schema drift on 'pack_size_changes'/.test(err.message) &&
          /acknowledged/.test(err.message),
      );
    } finally {
      drifted.close();
    }
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

// ── BEO course schema (T4) ─────────────────────────────────────────

describe('beo_courses table — T4 additions', () => {
  it('exists in sqlite_master', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='beo_courses'`)
      .get();
    assert.ok(row, 'beo_courses table should exist after initSchema');
  });

  it('has all required columns with the right shape', () => {
    const cols = columnsOf('beo_courses');
    for (const required of ['id', 'event_id', 'location_id', 'course_label', 'fire_at', 'notes', 'sort_order', 'created_at', 'updated_at']) {
      assert.ok(cols.includes(required), `beo_courses must have ${required}`);
    }
  });

  it('id is INTEGER PRIMARY KEY AUTOINCREMENT', () => {
    const info = db.prepare(`PRAGMA table_info(beo_courses)`).all();
    const idCol = info.find((c) => c.name === 'id');
    assert.equal(idCol.pk, 1);
    assert.equal(idCol.type.toUpperCase(), 'INTEGER');
  });

  it('fire_at is NOT NULL per PRAGMA', () => {
    const info = db.prepare(`PRAGMA table_info(beo_courses)`).all();
    const fireCol = info.find((c) => c.name === 'fire_at');
    assert.equal(fireCol.notnull, 1);
  });

  it('FOREIGN KEY (event_id) → beo_events ON DELETE CASCADE', () => {
    const fks = db.prepare(`PRAGMA foreign_key_list(beo_courses)`).all();
    const eventFk = fks.find((f) => f.from === 'event_id');
    assert.ok(eventFk, 'event_id FK to beo_events must exist');
    assert.equal(eventFk.table, 'beo_events');
    assert.equal(eventFk.on_delete, 'CASCADE');
  });

  it('rejects an insert missing fire_at', () => {
    db.exec(`INSERT INTO beo_events (title, event_date, location_id) VALUES ('Test Banquet', '2026-05-04', 'default')`);
    const eventId = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
    assert.throws(
      () => db.prepare(`INSERT INTO beo_courses (event_id, course_label) VALUES (?, ?)`).run(eventId, 'Entree'),
      /fire_at|NOT NULL/i,
    );
  });

  it('accepts a well-formed row', () => {
    const evRes = db.prepare(`INSERT INTO beo_events (title, event_date, location_id) VALUES ('Test Banquet', '2026-05-04', 'default')`).run();
    const evId = evRes.lastInsertRowid;
    const res = db
      .prepare(`INSERT INTO beo_courses (event_id, location_id, course_label, fire_at) VALUES (?, ?, ?, ?)`)
      .run(evId, 'default', 'Entree', '2026-05-04T19:30:00.000Z');
    assert.ok(res.lastInsertRowid > 0);
  });
});

describe('beo_line_items.course_id — T4 ALTER', () => {
  it('column was added by migrateLegacyColumns', () => {
    const cols = columnsOf('beo_line_items');
    assert.ok(cols.includes('course_id'), 'beo_line_items.course_id must exist');
  });

  it('is nullable (pre-existing rows have no course)', () => {
    const info = db.prepare(`PRAGMA table_info(beo_line_items)`).all();
    const c = info.find((x) => x.name === 'course_id');
    assert.equal(c.notnull, 0);
  });

  it('FK to beo_courses is ON DELETE SET NULL', () => {
    const fks = db.prepare(`PRAGMA foreign_key_list(beo_line_items)`).all();
    const courseFk = fks.find((f) => f.from === 'course_id');
    assert.ok(courseFk, 'course_id FK should be present');
    assert.equal(courseFk.table, 'beo_courses');
    assert.equal(courseFk.on_delete, 'SET NULL');
  });
});

describe('lari_conversation_turns schema', () => {
  it('exists with canonical columns in order', () => {
    const info = db.prepare('PRAGMA table_info(lari_conversation_turns)').all();
    const names = info.map((c) => c.name);
    assert.deepStrictEqual(names, [
      'schemaVersion',
      'id',
      'location_id',
      'cook_id',
      'conversation_session_id',
      'user_content',
      'assistant_content',
      'manager_tier',
      'created_at',
      'expires_at',
    ]);
  });

  it('requires partition fields, clipped content fields, tier flag, and expiry', () => {
    const info = db.prepare('PRAGMA table_info(lari_conversation_turns)').all();
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));
    assert.equal(byName.schemaVersion.type.toUpperCase(), 'TEXT');
    assert.equal(byName.schemaVersion.notnull, 1);
    assert.equal(byName.location_id.notnull, 1);
    assert.equal(byName.cook_id.notnull, 1);
    assert.equal(byName.conversation_session_id.notnull, 1);
    assert.equal(byName.user_content.notnull, 1);
    assert.equal(byName.assistant_content.notnull, 1);
    assert.equal(byName.manager_tier.notnull, 1);
    assert.equal(byName.expires_at.notnull, 1);
  });

  it('has partition and expiry indexes', () => {
    const indexes = db.prepare("PRAGMA index_list('lari_conversation_turns')").all();
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes('idx_lari_conversation_partition'), 'partition index missing');
    assert.ok(names.includes('idx_lari_conversation_expiry'), 'expiry index missing');
  });
});
