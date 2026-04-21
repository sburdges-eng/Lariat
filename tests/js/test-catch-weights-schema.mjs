#!/usr/bin/env node
// T5a schema acceptance — vendor_catch_weights table + vendor_prices columns.
// Run: node --experimental-strip-types --test tests/js/test-catch-weights-schema.mjs
//
// Verifies:
//   - initSchema creates vendor_catch_weights with the expected columns + PK.
//   - migrateLegacyColumns adds actual_received_lb + reconciled_unit_price
//     to a pre-T5a vendor_prices table without dropping existing rows.
//   - assertCriticalSchemas catches drift on vendor_catch_weights when a
//     legacy partial-deploy table shadows the current schema.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';

describe('T5a — vendor_catch_weights schema', () => {
  it('initSchema creates the table with expected columns and PK(vendor, sku)', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const cols = db
      .prepare('PRAGMA table_info(vendor_catch_weights)')
      .all();
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of ['vendor', 'sku', 'catalog_wt_lb', 'tare_lb', 'source', 'updated_at']) {
      assert.ok(byName.has(name), `missing column ${name}`);
    }
    assert.equal(byName.get('vendor').notnull, 1);
    assert.equal(byName.get('sku').notnull, 1);
    assert.equal(byName.get('catalog_wt_lb').notnull, 1);
    assert.equal(byName.get('tare_lb').notnull, 0);
    assert.equal(byName.get('vendor').pk, 1);
    assert.equal(byName.get('sku').pk, 2);
    db.close();
  });

  it('NOT NULL catalog_wt_lb rejects NULL insert', () => {
    const db = new Database(':memory:');
    initSchema(db);
    assert.throws(() => {
      db.prepare(
        'INSERT INTO vendor_catch_weights (vendor, sku, catalog_wt_lb) VALUES (?, ?, ?)',
      ).run('sysco', '12345', null);
    });
    db.close();
  });
});

describe('T5a — vendor_prices migration adds reconciliation columns', () => {
  it('legacy vendor_prices without actual_received_lb/reconciled_unit_price gets columns ALTERed in', () => {
    const db = new Database(':memory:');
    // Simulate a pre-T5a DB: vendor_prices exists but lacks the new columns.
    db.exec(`
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
        yield_pct REAL
      );
      INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price)
      VALUES ('Legacy Row', 'sysco', '12345', 10, 'lb', 150.0);
    `);
    initSchema(db);
    const cols = (
      db.prepare('PRAGMA table_info(vendor_prices)').all()
    ).map((c) => c.name);
    assert.ok(cols.includes('actual_received_lb'), 'migration did not add actual_received_lb');
    assert.ok(cols.includes('reconciled_unit_price'), 'migration did not add reconciled_unit_price');
    const legacy = db
      .prepare(`SELECT ingredient, actual_received_lb, reconciled_unit_price FROM vendor_prices WHERE sku = '12345'`)
      .get();
    assert.equal(legacy.ingredient, 'Legacy Row');
    assert.equal(legacy.actual_received_lb, null);
    assert.equal(legacy.reconciled_unit_price, null);
    db.close();
  });

  it('can write + read actual_received_lb and reconciled_unit_price', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, actual_received_lb, reconciled_unit_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Ribeye', 'sysco', '9999', 1, 'case', 150.0, 10.4, 14.42);
    const r = db
      .prepare(`SELECT actual_received_lb, reconciled_unit_price FROM vendor_prices WHERE sku = '9999'`)
      .get();
    assert.equal(r.actual_received_lb, 10.4);
    assert.equal(r.reconciled_unit_price, 14.42);
    db.close();
  });
});

describe('T5a — assertCriticalSchemas catches drift on vendor_catch_weights', () => {
  it('throws when a legacy vendor_catch_weights is missing required columns', () => {
    const db = new Database(':memory:');
    // Simulate a broken partial-deploy: table exists, missing catalog_wt_lb.
    db.exec(`
      CREATE TABLE vendor_catch_weights (
        vendor TEXT NOT NULL,
        sku TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (vendor, sku)
      );
    `);
    assert.throws(
      () => initSchema(db),
      (err) =>
        err instanceof Error &&
        /schema drift on 'vendor_catch_weights'/.test(err.message) &&
        /catalog_wt_lb/.test(err.message),
    );
    db.close();
  });
});
