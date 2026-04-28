#!/usr/bin/env node
// Tests for lib/entities.ts — resolveOrCreate* + lookupEntityUuid.
// Run: node --experimental-strip-types --test tests/js/test-entity-resolver.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports to match the compute-engine test pattern — required so
// strip-types resolves transitive ./uuid imports inside lib/entities.ts.
const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const {
  resolveOrCreateEmployee,
  resolveOrCreateVendor,
  resolveOrCreateMenuItem,
  resolveOrCreateRecipe,
  resolveOrCreateIngredient,
  lookupEntityUuid,
  listExternalIdsForEntity,
} = await import('../../lib/entities.ts');
const { isUuidV7 } = await import('../../lib/uuid.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  // Wipe entity tables between tests so cases stay independent. external_ids
  // first so FK enforcement (foreign_keys=ON) doesn't bite.
  db.exec(`
    DELETE FROM external_ids;
    DELETE FROM entities_purchase_orders;
    DELETE FROM entities_employees;
    DELETE FROM entities_vendors;
    DELETE FROM entities_menu_items;
    DELETE FROM entities_recipes;
    DELETE FROM entities_ingredients;
  `);
});

describe('resolveOrCreateEmployee', () => {
  it('creates a new employee + registry row on first call', () => {
    const r = resolveOrCreateEmployee(db, {
      source_system: '7shifts',
      external_id: 'user_4729',
      display_name: 'Sarah Johnson',
      primary_email: 'sarah@lariat.test',
    });
    assert.strictEqual(r.created, true);
    assert.ok(isUuidV7(r.uuid), `expected v7 uuid, got ${r.uuid}`);

    const empCount = db.prepare(`SELECT COUNT(*) as c FROM entities_employees`).get().c;
    const xidCount = db.prepare(`SELECT COUNT(*) as c FROM external_ids`).get().c;
    assert.strictEqual(empCount, 1);
    assert.strictEqual(xidCount, 1);
  });

  it('returns the existing UUID on repeat call (idempotent)', () => {
    const a = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_4729', display_name: 'Sarah Johnson',
    });
    const b = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_4729', display_name: 'Sarah Johnson',
    });
    assert.strictEqual(b.uuid, a.uuid);
    assert.strictEqual(b.created, false);
    const empCount = db.prepare(`SELECT COUNT(*) as c FROM entities_employees`).get().c;
    assert.strictEqual(empCount, 1);
  });

  it('updates last_seen_at on repeat call but keeps first_seen_at', async () => {
    const a = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_4729', display_name: 'Sarah',
    });
    const before = db
      .prepare(`SELECT first_seen_at, last_seen_at FROM external_ids WHERE entity_uuid=?`)
      .get(a.uuid);
    // Sleep a tick so datetime() ticks at least 1s. Use SQL to advance the
    // baseline rather than waiting in real time.
    db.prepare(
      `UPDATE external_ids SET last_seen_at = datetime('now','-1 day') WHERE entity_uuid=?`,
    ).run(a.uuid);
    resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_4729', display_name: 'Sarah',
    });
    const after = db
      .prepare(`SELECT first_seen_at, last_seen_at FROM external_ids WHERE entity_uuid=?`)
      .get(a.uuid);
    assert.strictEqual(after.first_seen_at, before.first_seen_at);
    assert.notStrictEqual(after.last_seen_at, '');
    assert.ok(
      after.last_seen_at > before.last_seen_at ||
        // datetime('now') resolution is per-second; if the test ran inside
        // the same second after the -1d backstop it still strictly increases
        after.last_seen_at !== before.last_seen_at,
    );
  });

  it('creates two distinct employees for two different external_ids', () => {
    const a = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_1', display_name: 'A',
    });
    const b = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_2', display_name: 'B',
    });
    assert.notStrictEqual(a.uuid, b.uuid);
  });

  it('creates two distinct employees for the same external_id at two locations', () => {
    const a = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_1', display_name: 'A', location_id: 'site_a',
    });
    const b = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'user_1', display_name: 'A', location_id: 'site_b',
    });
    assert.notStrictEqual(a.uuid, b.uuid);
  });
});

describe('resolveOrCreateRecipe — slug-collision merging', () => {
  it('a manual slug + a Toast guid for the same dish resolve to ONE UUID', () => {
    // Manual ingest declares the recipe by slug.
    const manual = resolveOrCreateRecipe(db, {
      source_system: 'manual',
      external_id: 'baja_taco',
      slug: 'baja_taco',
      display_name: 'Baja Taco',
    });
    // Toast catalog ingest later associates a guid with the same recipe slug.
    const toast = resolveOrCreateRecipe(db, {
      source_system: 'toast',
      external_id: 'guid-baja-1234',
      slug: 'baja_taco',
      display_name: 'Baja Taco',
    });
    assert.strictEqual(toast.uuid, manual.uuid, 'second source must reuse the slug-matched UUID');
    assert.strictEqual(toast.created, false);
    const recipeRows = db.prepare(`SELECT COUNT(*) as c FROM entities_recipes`).get().c;
    assert.strictEqual(recipeRows, 1);
    const xidRows = db.prepare(`SELECT COUNT(*) as c FROM external_ids WHERE entity_type='recipe'`).get().c;
    assert.strictEqual(xidRows, 2);
  });
});

describe('resolveOrCreateIngredient — ingredient_key collision merging', () => {
  it('Sysco SKU + Shamrock SKU for the same ingredient_key resolve to ONE UUID', () => {
    const sysco = resolveOrCreateIngredient(db, {
      source_system: 'sysco', external_id: 'SYS-12345',
      ingredient_key: 'tomato_roma', display_name: 'Tomato, Roma',
    });
    const shamrock = resolveOrCreateIngredient(db, {
      source_system: 'shamrock', external_id: 'SHM-99',
      ingredient_key: 'tomato_roma', display_name: 'Roma Tomatoes',
    });
    assert.strictEqual(shamrock.uuid, sysco.uuid);
    assert.strictEqual(shamrock.created, false);
    const ings = db.prepare(`SELECT COUNT(*) as c FROM entities_ingredients`).get().c;
    assert.strictEqual(ings, 1);
  });
});

describe('lookupEntityUuid + listExternalIdsForEntity', () => {
  it('looks up by (source, external_id, location, type) without creating', () => {
    const v = resolveOrCreateVendor(db, {
      source_system: 'shamrock', external_id: 'SHAMROCK_FOODS_INC',
      display_name: 'Shamrock Foods',
    });
    const found = lookupEntityUuid(db, 'vendor', 'shamrock', 'SHAMROCK_FOODS_INC');
    assert.strictEqual(found, v.uuid);
    const missing = lookupEntityUuid(db, 'vendor', 'sysco', 'SHAMROCK_FOODS_INC');
    assert.strictEqual(missing, null);
  });

  it('lists all external ids for a given entity uuid', () => {
    const v1 = resolveOrCreateVendor(db, {
      source_system: 'shamrock', external_id: 'sk1', display_name: 'Shamrock',
    });
    // Manually add a manual alias pointing at the same UUID.
    db.prepare(
      `INSERT INTO external_ids
         (entity_type, entity_uuid, source_system, external_id, location_id)
       VALUES ('vendor', ?, 'manual', 'shamrock_alias', 'default')`,
    ).run(v1.uuid);
    const list = listExternalIdsForEntity(db, v1.uuid);
    assert.strictEqual(list.length, 2);
    const sources = list.map((r) => r.source_system).sort();
    assert.deepStrictEqual(sources, ['manual', 'shamrock']);
  });
});

describe('resolveOrCreateMenuItem — Toast per-location semantics', () => {
  it('creates two menu items for the same Toast guid at two locations', () => {
    const a = resolveOrCreateMenuItem(db, {
      source_system: 'toast', external_id: 'guid-burger',
      display_name: 'Burger', location_id: 'lariat-tn',
    });
    const b = resolveOrCreateMenuItem(db, {
      source_system: 'toast', external_id: 'guid-burger',
      display_name: 'Burger', location_id: 'lariat-co',
    });
    assert.notStrictEqual(a.uuid, b.uuid);
    const rows = db.prepare(`SELECT COUNT(*) as c FROM entities_menu_items`).get().c;
    assert.strictEqual(rows, 2);
  });
});

describe('metadata round-trip', () => {
  it('stores and updates metadata_json via resolver', () => {
    const e = resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'u9',
      display_name: 'X', metadata: { department: 'BOH', hire_date: '2025-01-15' },
    });
    let row = db
      .prepare(`SELECT metadata_json FROM external_ids WHERE entity_uuid=?`)
      .get(e.uuid);
    assert.deepStrictEqual(JSON.parse(row.metadata_json), {
      department: 'BOH', hire_date: '2025-01-15',
    });

    resolveOrCreateEmployee(db, {
      source_system: '7shifts', external_id: 'u9',
      display_name: 'X', metadata: { department: 'FOH' },
    });
    row = db
      .prepare(`SELECT metadata_json FROM external_ids WHERE entity_uuid=?`)
      .get(e.uuid);
    assert.deepStrictEqual(JSON.parse(row.metadata_json), { department: 'FOH' });
  });
});
