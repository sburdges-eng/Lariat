#!/usr/bin/env node
// Integration test for scripts/backfill/* — populates a fixture DB with
// realistic source-system rows, runs the backfill modules, and asserts:
//   - dry-run reports correct counts without writing
//   - apply mode creates the right entity rows + external_ids
//   - re-running --apply is idempotent (no duplicates)
//
// Run: node --experimental-strip-types --test tests/js/test-backfill-entities.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { backfillEmployees } = await import('../../scripts/backfill/employees.mjs');
const { backfillVendors } = await import('../../scripts/backfill/vendors.mjs');
const { backfillMenuItems } = await import('../../scripts/backfill/menu_items.mjs');
const { backfillRecipes } = await import('../../scripts/backfill/recipes.mjs');
const { backfillIngredients } = await import('../../scripts/backfill/ingredients.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

// Some source tables (toast_menu_items, toast_labor_by_job, shamrock_invoices,
// sysco_invoices) are created by Python ingest scripts at runtime, NOT by
// initSchema(). The backfill modules rely on tableExists() to no-op when a
// source is absent, but to test the affirmative paths we have to seed them
// here. DDL kept minimal — only the columns the backfill reads.
function ensureExtraSourceTables(db) {
  // Toast tables are always present for these tests since the menu_items
  // and labor backfills exercise them. Invoice tables are created on
  // demand per test (see ensureInvoiceTables / dropInvoiceTables) because
  // their mere presence triggers the hardcoded shamrock+sysco vendor path.
  db.exec(`
    CREATE TABLE IF NOT EXISTS toast_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT, guid TEXT, name TEXT, base_price REAL,
      archived INTEGER DEFAULT 0, modifier INTEGER DEFAULT 0,
      location_id TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS toast_labor_by_job (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chosen_name TEXT, first_name TEXT, last_name TEXT, job_title TEXT,
      total_hours REAL, location_id TEXT DEFAULT 'default'
    );
  `);
}

function ensureInvoiceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shamrock_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT, item TEXT
    );
    CREATE TABLE IF NOT EXISTS sysco_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT, item TEXT
    );
  `);
}

function dropInvoiceTables(db) {
  db.exec(`
    DROP TABLE IF EXISTS shamrock_invoices;
    DROP TABLE IF EXISTS sysco_invoices;
  `);
}

function clearAll(db) {
  db.exec(`
    DELETE FROM external_ids;
    DELETE FROM entities_purchase_orders;
    DELETE FROM entities_employees;
    DELETE FROM entities_vendors;
    DELETE FROM entities_menu_items;
    DELETE FROM entities_recipes;
    DELETE FROM entities_ingredients;
    DELETE FROM line_check_entries;
    DELETE FROM staff_certifications;
    DELETE FROM shift_pic;
    DELETE FROM bom_lines;
    DELETE FROM vendor_prices;
    DELETE FROM ingredient_masters;
    DELETE FROM toast_menu_items;
    DELETE FROM toast_labor_by_job;
  `);
  dropInvoiceTables(db);
}

before(() => {
  ensureExtraSourceTables(db);
});

beforeEach(() => {
  clearAll(db);
});

// ── employees ────────────────────────────────────────────────────────

describe('backfillEmployees', () => {
  it('picks up distinct cook_ids across multiple manual tables', () => {
    db.prepare(
      `INSERT INTO line_check_entries (shift_date, station_id, item, status, cook_id, location_id)
       VALUES ('2026-04-01','grill','sanitizer','pass','sarah_j','default')`,
    ).run();
    db.prepare(
      `INSERT INTO staff_certifications
         (location_id, cook_id, cert_type, cert_label, issued_on, expires_on)
       VALUES ('default','marco_l','cfpm','ServSafe','2025-01-01','2030-01-01')`,
    ).run();
    // duplicate cook_id across two tables → still one entity.
    db.prepare(
      `INSERT INTO line_check_entries (shift_date, station_id, item, status, cook_id, location_id)
       VALUES ('2026-04-02','grill','probe','pass','sarah_j','default')`,
    ).run();

    const t = backfillEmployees(db, { apply: true });
    assert.strictEqual(t.created, 2);
    assert.strictEqual(t.reused, 0);
    assert.strictEqual(t.errors, 0);

    const rows = db.prepare(`SELECT display_name FROM entities_employees ORDER BY display_name`).all();
    assert.deepStrictEqual(rows.map((r) => r.display_name), ['marco_l', 'sarah_j']);
  });

  it('picks up distinct toast labor names', () => {
    db.prepare(
      `INSERT INTO toast_labor_by_job (chosen_name, first_name, last_name, job_title)
       VALUES ('Sarah J.', 'Sarah', 'Johnson', 'Line Cook')`,
    ).run();
    db.prepare(
      `INSERT INTO toast_labor_by_job (chosen_name, first_name, last_name, job_title)
       VALUES (NULL, 'Marco', 'Lopez', 'Dishwasher')`,
    ).run();
    const t = backfillEmployees(db, { apply: true });
    assert.strictEqual(t.created, 2);
    const rows = db.prepare(
      `SELECT external_id FROM external_ids WHERE entity_type='employee' AND source_system='toast' ORDER BY external_id`,
    ).all();
    assert.deepStrictEqual(
      rows.map((r) => r.external_id),
      ['chosen:sarah j.', 'name:marco|lopez|dishwasher'],
    );
  });

  it('dry-run reports counts without writing', () => {
    db.prepare(
      `INSERT INTO line_check_entries (shift_date, station_id, item, status, cook_id, location_id)
       VALUES ('2026-04-01','grill','x','pass','x_id','default')`,
    ).run();
    const t = backfillEmployees(db, { apply: false });
    assert.strictEqual(t.created, 1);
    const empCount = db.prepare(`SELECT COUNT(*) as c FROM entities_employees`).get().c;
    assert.strictEqual(empCount, 0);
  });

  it('--apply twice is idempotent', () => {
    db.prepare(
      `INSERT INTO shift_pic
         (shift_date, location_id, shift_slot, cook_id, started_at)
       VALUES ('2026-04-01','default','open','dup','2026-04-01T10:00:00Z')`,
    ).run();
    backfillEmployees(db, { apply: true });
    const t = backfillEmployees(db, { apply: true });
    assert.strictEqual(t.created, 0);
    assert.strictEqual(t.reused, 1);
    const empCount = db.prepare(`SELECT COUNT(*) as c FROM entities_employees`).get().c;
    assert.strictEqual(empCount, 1);
  });
});

// ── vendors ──────────────────────────────────────────────────────────

describe('backfillVendors', () => {
  it('dedupes vendor names with different casing/punct', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor) VALUES ('roma tomato', 'Shamrock')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor) VALUES ('avocado', 'SHAMROCK')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor) VALUES ('tortilla', 'Shamrock Foods, Inc.')`,
    ).run();
    const t = backfillVendors(db, { apply: true });
    // 'shamrock' and 'shamrock_foods_inc' normalize differently — that's
    // intentional: a punctuation-aware normalizer would collapse them but
    // also risk collapsing genuinely different vendors. Phase 2 keeps it
    // strict.
    assert.strictEqual(t.created, 2);
    const names = db
      .prepare(`SELECT external_id FROM external_ids WHERE entity_type='vendor' ORDER BY external_id`)
      .all()
      .map((r) => r.external_id);
    assert.deepStrictEqual(names, ['shamrock', 'shamrock_foods_inc']);
  });

  it('tags Shamrock/Sysco rows with their dedicated source_system', () => {
    db.prepare(`INSERT INTO bom_lines (recipe_id, ingredient, vendor) VALUES ('r1','x','Shamrock Foods')`).run();
    db.prepare(`INSERT INTO bom_lines (recipe_id, ingredient, vendor) VALUES ('r2','x','Sysco Corp')`).run();
    db.prepare(`INSERT INTO bom_lines (recipe_id, ingredient, vendor) VALUES ('r3','x','Local Farm')`).run();
    backfillVendors(db, { apply: true });
    const rows = db
      .prepare(
        `SELECT source_system, external_id FROM external_ids WHERE entity_type='vendor' ORDER BY external_id`,
      )
      .all();
    const bySource = Object.fromEntries(rows.map((r) => [r.external_id, r.source_system]));
    assert.strictEqual(bySource['shamrock_foods'], 'shamrock');
    assert.strictEqual(bySource['sysco_corp'], 'sysco');
    assert.strictEqual(bySource['local_farm'], 'manual');
  });

  it('hardcodes shamrock + sysco when invoice tables exist', () => {
    // No bom_lines / vendor_prices rows → vendors backfill should still
    // create 'shamrock' and 'sysco' since those tables are present.
    ensureInvoiceTables(db);
    const t = backfillVendors(db, { apply: true });
    assert.strictEqual(t.created, 2);
    const names = db
      .prepare(`SELECT external_id FROM external_ids WHERE entity_type='vendor' ORDER BY external_id`)
      .all()
      .map((r) => r.external_id);
    assert.deepStrictEqual(names, ['shamrock', 'sysco']);
  });
});

// ── menu_items ────────────────────────────────────────────────────────

describe('backfillMenuItems', () => {
  it('creates one entity per non-modifier toast_menu_items row', () => {
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, base_price, archived, modifier, location_id)
       VALUES ('guid-baja', 'Baja Taco', 4.50, 0, 0, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, base_price, archived, modifier, location_id)
       VALUES ('guid-pickle', 'Extra Pickles', 0.50, 0, 1, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, base_price, archived, modifier, location_id)
       VALUES ('guid-old', 'Old Burger', 9.00, 1, 0, 'default')`,
    ).run();
    const t = backfillMenuItems(db, { apply: true });
    assert.strictEqual(t.created, 2);
    // Modifier row should be skipped entirely (not even an external_ids entry).
    const xidNames = db
      .prepare(`SELECT external_id FROM external_ids WHERE entity_type='menu_item' ORDER BY external_id`)
      .all()
      .map((r) => r.external_id);
    assert.deepStrictEqual(xidNames, ['guid-baja', 'guid-old']);
    // Archived row should land with active=0.
    const oldRow = db
      .prepare(
        `SELECT em.active FROM entities_menu_items em
           JOIN external_ids x ON x.entity_uuid = em.uuid
          WHERE x.external_id = 'guid-old'`,
      )
      .get();
    assert.strictEqual(oldRow.active, 0);
  });

  it('keeps two locations distinct for the same Toast guid', () => {
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, base_price, archived, modifier, location_id)
       VALUES ('guid-burger', 'Burger', 12, 0, 0, 'lariat-tn')`,
    ).run();
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, base_price, archived, modifier, location_id)
       VALUES ('guid-burger', 'Burger', 13, 0, 0, 'lariat-co')`,
    ).run();
    backfillMenuItems(db, { apply: true });
    const c = db.prepare(`SELECT COUNT(*) as c FROM entities_menu_items`).get().c;
    assert.strictEqual(c, 2);
  });
});

// ── recipes ──────────────────────────────────────────────────────────

describe('backfillRecipes', () => {
  it('falls back to bom_lines.recipe_id when recipes.json is missing entries', () => {
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, location_id)
       VALUES ('orphan_sauce', 'tomato', 1, 'cup', 'default')`,
    ).run();
    const t = backfillRecipes(db, { apply: true });
    assert.ok(t.created >= 1);
    const found = db
      .prepare(`SELECT slug FROM entities_recipes WHERE slug='orphan_sauce'`)
      .get();
    assert.ok(found, 'orphan_sauce recipe must be created from bom_lines');
  });
});

// ── ingredients ──────────────────────────────────────────────────────

describe('backfillIngredients', () => {
  it('uses ingredient_masters + dedupes against bom_lines text', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name, category)
       VALUES ('roma_tomato_5lb', 'Roma Tomatoes 5lb', 'produce')`,
    ).run();
    // bom_lines has the same logical ingredient under a noisy name.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, location_id)
       VALUES ('r', 'Roma Tomato', 1, 'lb', 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, location_id)
       VALUES ('r2', 'avocado, hass', 1, 'each', 'default')`,
    ).run();
    const t = backfillIngredients(db, { apply: true });
    // master + 2 bom rows: 'roma_tomato_5lb' (master), 'roma tomato' (bom),
    // 'avocado hass' (bom) → 3 distinct ingredient_keys.
    assert.strictEqual(t.created, 3);
    const keys = db
      .prepare(`SELECT ingredient_key FROM entities_ingredients ORDER BY ingredient_key`)
      .all()
      .map((r) => r.ingredient_key);
    assert.deepStrictEqual(keys, ['avocado hass', 'roma tomato', 'roma_tomato_5lb']);
  });
});

// ── orchestrator-level idempotency ────────────────────────────────────

describe('full orchestrator-style run — idempotency', () => {
  it('running every module twice with --apply does not duplicate rows', () => {
    // Seed one row per source.
    db.prepare(
      `INSERT INTO line_check_entries (shift_date, station_id, item, status, cook_id, location_id)
       VALUES ('2026-04-01','g','x','pass','c1','default')`,
    ).run();
    db.prepare(`INSERT INTO vendor_prices (ingredient, vendor) VALUES ('x', 'AcmeFoods')`).run();
    db.prepare(
      `INSERT INTO toast_menu_items (guid, name, archived, modifier, location_id)
       VALUES ('g1','M',0,0,'default')`,
    ).run();
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, location_id) VALUES ('r','tomato','default')`,
    ).run();
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('mx','MX')`,
    ).run();

    for (const fn of [
      backfillEmployees, backfillVendors, backfillMenuItems,
      backfillRecipes, backfillIngredients,
    ]) {
      fn(db, { apply: true });
    }
    const after1 = db.prepare(`SELECT COUNT(*) as c FROM external_ids`).get().c;

    for (const fn of [
      backfillEmployees, backfillVendors, backfillMenuItems,
      backfillRecipes, backfillIngredients,
    ]) {
      fn(db, { apply: true });
    }
    const after2 = db.prepare(`SELECT COUNT(*) as c FROM external_ids`).get().c;
    assert.strictEqual(after2, after1, 'second pass must not add new external_ids');
  });
});
