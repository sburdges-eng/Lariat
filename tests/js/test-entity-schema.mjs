#!/usr/bin/env node
// Tests for the canonical entity layer (Phase 1).
// Run: node --experimental-strip-types --test tests/js/test-entity-schema.mjs
//
// Exercises:
//   - All entity tables exist with correct columns + types
//   - external_ids enforces UNIQUE(source_system, external_id, location_id, entity_type)
//   - external_ids.entity_type CHECK rejects unknown types
//   - entities_purchase_orders FK to entities_vendors enforces (foreign_keys=ON)
//   - initSchema is idempotent (second invocation is a no-op)

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getDb, setDbPathForTest, initSchema } from '../../lib/db.ts';

setDbPathForTest(':memory:');
const db = getDb();

after(() => setDbPathForTest(null));

const columnsOf = (table) =>
  /** @type {{name: string, type: string, notnull: number}[]} */ (
    db.prepare(`PRAGMA table_info(${table})`).all()
  );

const tableExists = (table) =>
  Boolean(
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table),
  );

describe('entity tables — existence', () => {
  for (const t of [
    'entities_employees',
    'entities_vendors',
    'entities_menu_items',
    'entities_recipes',
    'entities_ingredients',
    'entities_purchase_orders',
    'external_ids',
  ]) {
    it(`${t} exists`, () => {
      assert.ok(tableExists(t), `${t} missing`);
    });
  }
});

describe('entities_employees — shape', () => {
  it('has expected columns', () => {
    const names = columnsOf('entities_employees').map((c) => c.name);
    for (const c of [
      'uuid', 'display_name', 'primary_email', 'primary_phone',
      'active', 'created_at', 'updated_at',
    ]) {
      assert.ok(names.includes(c), `entities_employees.${c} missing`);
    }
  });

  it('uuid is the PK and TEXT-typed', () => {
    const cols = columnsOf('entities_employees');
    const uuidCol = cols.find((c) => c.name === 'uuid');
    assert.ok(uuidCol);
    assert.strictEqual(uuidCol.type.toUpperCase(), 'TEXT');
    // PRAGMA exposes pk via index in `pk` column; refetch with that column.
    const pk = db
      .prepare(`PRAGMA table_info(entities_employees)`)
      .all()
      .find((c) => c.name === 'uuid');
    assert.strictEqual(pk.pk, 1);
  });
});

describe('entities_recipes — slug uniqueness per location', () => {
  it('UNIQUE(slug, location_id) is enforced', () => {
    db.prepare(
      `INSERT INTO entities_recipes (uuid, slug, display_name, location_id)
       VALUES ('u1', 'house_ranch', 'House Ranch', 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO entities_recipes (uuid, slug, display_name, location_id)
       VALUES ('u2', 'house_ranch', 'House Ranch B', 'site_b')`,
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO entities_recipes (uuid, slug, display_name, location_id)
           VALUES ('u3', 'house_ranch', 'duplicate', 'default')`,
        ).run(),
      /UNIQUE/,
    );
    db.prepare(`DELETE FROM entities_recipes WHERE uuid IN ('u1','u2')`).run();
  });
});

describe('entities_ingredients — global ingredient_key uniqueness', () => {
  it('UNIQUE(ingredient_key) is enforced across locations', () => {
    db.prepare(
      `INSERT INTO entities_ingredients (uuid, display_name, ingredient_key)
       VALUES ('i1', 'Tomato', 'tomato')`,
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO entities_ingredients (uuid, display_name, ingredient_key)
           VALUES ('i2', 'Tomato', 'tomato')`,
        ).run(),
      /UNIQUE/,
    );
    db.prepare(`DELETE FROM entities_ingredients WHERE uuid='i1'`).run();
  });
});

describe('external_ids — uniqueness + check constraints', () => {
  it('rejects an unknown entity_type', () => {
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO external_ids
             (entity_type, entity_uuid, source_system, external_id)
           VALUES ('teleporter', 'whatever', 'toast', 'guid-x')`,
        ).run(),
      /CHECK/,
    );
  });

  it('UNIQUE(source_system, external_id, location_id, entity_type) is enforced', () => {
    db.prepare(
      `INSERT INTO external_ids
         (entity_type, entity_uuid, source_system, external_id, location_id)
       VALUES ('menu_item', 'u-baja', 'toast', 'guid-baja', 'default')`,
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO external_ids
             (entity_type, entity_uuid, source_system, external_id, location_id)
           VALUES ('menu_item', 'u-other', 'toast', 'guid-baja', 'default')`,
        ).run(),
      /UNIQUE/,
    );
    // But same external_id at a different location is allowed.
    db.prepare(
      `INSERT INTO external_ids
         (entity_type, entity_uuid, source_system, external_id, location_id)
       VALUES ('menu_item', 'u-other', 'toast', 'guid-baja', 'site_b')`,
    ).run();
    db.prepare(
      `DELETE FROM external_ids WHERE external_id='guid-baja'`,
    ).run();
  });
});

describe('entities_purchase_orders — FK to vendors', () => {
  it('rejects an INSERT with an unknown vendor_uuid (foreign_keys=ON)', () => {
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO entities_purchase_orders (uuid, vendor_uuid, status)
           VALUES ('po-1', 'nonexistent-vendor', 'open')`,
        ).run(),
      /FOREIGN KEY/,
    );
  });

  it('accepts an INSERT once the vendor exists', () => {
    db.prepare(
      `INSERT INTO entities_vendors (uuid, display_name)
       VALUES ('v-shamrock', 'Shamrock Foods')`,
    ).run();
    db.prepare(
      `INSERT INTO entities_purchase_orders (uuid, vendor_uuid, status)
       VALUES ('po-2', 'v-shamrock', 'open')`,
    ).run();
    const row = db
      .prepare(`SELECT vendor_uuid FROM entities_purchase_orders WHERE uuid='po-2'`)
      .get();
    assert.strictEqual(row.vendor_uuid, 'v-shamrock');
    db.prepare(`DELETE FROM entities_purchase_orders WHERE uuid='po-2'`).run();
    db.prepare(`DELETE FROM entities_vendors WHERE uuid='v-shamrock'`).run();
  });
});

describe('initSchema — idempotency', () => {
  it('second invocation is a no-op (no errors, no schema change)', () => {
    const before = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all();
    initSchema(db);
    const after = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all();
    assert.deepStrictEqual(after, before);
  });
});
