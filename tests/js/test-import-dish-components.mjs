// Tests for scripts/import-dish-components.mjs + lib/dishComponentsRepo.ts.
//
// Mirrors the setup used in test-dish-cost-bridge.mjs: register the TS
// resolver, swap getDb() to a fresh temp SQLite file, exercise the shared
// repo directly plus the CLI via a child process.
//
// Covers:
//   - validateDishComponentRow rules (happy + invalid shapes)
//   - upsertDishComponent: insert, update, skipped (identical)
//   - CLI: valid insert and update path
//   - CLI: invalid row (both recipe_slug + vendor_ingredient set) errors out
//   - CLI: --dry-run writes nothing
//   - CLI: round-trip (export → import → export) is stable

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('./resolver.mjs', import.meta.url));

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const IMPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'import-dish-components.mjs');
const EXPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'export-dish-components.mjs');

// The importer/exporter use getDb() which resolves to `cwd()/data/lariat.db`.
// We point the child process at a test-owned cwd where data/lariat.db is the
// test database. The parent uses setDbPathForTest on the same path so both
// sides talk to identical bytes on disk.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-dc-csv-'));
const CHILD_CWD = path.join(TMP_DIR, 'cwd');
fs.mkdirSync(path.join(CHILD_CWD, 'data'), { recursive: true });
const TMP_DB = path.join(CHILD_CWD, 'data', 'lariat.db');
const CSV_DIR = path.join(TMP_DIR, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

const dbMod = await import('../../lib/db.ts');
const repo = await import('../../lib/dishComponentsRepo.ts');
const bridge = await import('../../lib/dishCostBridge.ts');

dbMod.setDbPathForTest(TMP_DB);
dbMod.getDb(); // materialize schema + migrations on disk

// We keep the parent's connection closed while children run so there is
// no cross-process WAL visibility ambiguity: each inspection opens a
// fresh connection, and each child opens its own fresh connection too.
function openFresh() {
  dbMod.setDbPathForTest(null); // close cached handle
  dbMod.setDbPathForTest(TMP_DB);
  return dbMod.getDb();
}

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const db = openFresh();
  db.exec(`DELETE FROM dish_components;`);
  // Force WAL checkpoint + close so the child process sees the truncated
  // state on fresh open. (better-sqlite3 does an implicit checkpoint on
  // close in WAL mode.)
  dbMod.setDbPathForTest(null);
});

function writeCsv(name, text) {
  const p = path.join(CSV_DIR, name);
  fs.writeFileSync(p, text);
  return p;
}

function runImporter(csvPath, extraArgs = []) {
  return spawnSync('node', [IMPORT_SCRIPT, csvPath, ...extraArgs], {
    cwd: CHILD_CWD,
    encoding: 'utf8',
  });
}

function runExporter(extraArgs = []) {
  return spawnSync('node', [EXPORT_SCRIPT, ...extraArgs], {
    cwd: CHILD_CWD,
    encoding: 'utf8',
  });
}

// Helper: re-open parent for inline inspection after a child wrote.
function rows(filter) {
  const db = openFresh();
  const out = repo.listDishComponents(db, filter);
  dbMod.setDbPathForTest(null);
  return out;
}

// Helper for direct repo tests: open a fresh handle, run, close.
function withDb(fn) {
  const db = openFresh();
  try {
    return fn(db);
  } finally {
    dbMod.setDbPathForTest(null);
  }
}

// ── Validator tests ────────────────────────────────────────────────

describe('validateDishComponentRow', () => {
  it('accepts a valid recipe row', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'The Rope Burger',
      component_type: 'recipe',
      recipe_slug: 'bacon_jam',
      vendor_ingredient: null,
      qty_per_serving: 0.5,
      unit: 'cup',
      notes: null,
    });
    assert.equal(v.ok, true);
  });

  it('accepts a valid vendor_item row', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'The Rope Burger',
      component_type: 'vendor_item',
      recipe_slug: null,
      vendor_ingredient: 'Brioche Bun',
      qty_per_serving: 1,
      unit: 'each',
      notes: null,
    });
    assert.equal(v.ok, true);
  });

  it('rejects both recipe_slug and vendor_ingredient set', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'X',
      component_type: 'recipe',
      recipe_slug: 'bacon_jam',
      vendor_ingredient: 'Brioche Bun',
      qty_per_serving: 1,
      unit: 'each',
      notes: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('vendor_ingredient must be empty')));
  });

  it('rejects zero / negative qty_per_serving', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'X',
      component_type: 'recipe',
      recipe_slug: 's',
      vendor_ingredient: null,
      qty_per_serving: 0,
      unit: 'cup',
      notes: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('qty_per_serving')));
  });

  it('rejects unknown unit', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'X',
      component_type: 'recipe',
      recipe_slug: 's',
      vendor_ingredient: null,
      qty_per_serving: 1,
      unit: 'squiggle',
      notes: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('not a known unit')));
  });

  it('accepts count unit (each)', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'X',
      component_type: 'vendor_item',
      recipe_slug: null,
      vendor_ingredient: 'Bun',
      qty_per_serving: 1,
      unit: 'each',
      notes: null,
    });
    assert.equal(v.ok, true);
  });

  it('rejects bad component_type', () => {
    const v = repo.validateDishComponentRow({
      dish_name: 'X',
      component_type: 'badtype',
      recipe_slug: 's',
      vendor_ingredient: null,
      qty_per_serving: 1,
      unit: 'cup',
      notes: null,
    });
    assert.equal(v.ok, false);
  });
});

// ── Repo tests ─────────────────────────────────────────────────────

describe('upsertDishComponent', () => {
  it('inserts a new recipe row', () => {
    withDb((db) => {
      const res = repo.upsertDishComponent(db, {
        location_id: 'default',
        dish_name: 'rope burger',
        component_type: 'recipe',
        recipe_slug: 'bacon_jam',
        vendor_ingredient: null,
        qty_per_serving: 0.5,
        unit: 'cup',
        notes: null,
      });
      assert.equal(res.outcome, 'inserted');
      assert.equal(res.row.recipe_slug, 'bacon_jam');
    });
  });

  it('updates when qty changes', () => {
    withDb((db) => {
      repo.upsertDishComponent(db, {
        location_id: 'default',
        dish_name: 'rope burger',
        component_type: 'recipe',
        recipe_slug: 'bacon_jam',
        vendor_ingredient: null,
        qty_per_serving: 0.5,
        unit: 'cup',
        notes: null,
      });
      const res = repo.upsertDishComponent(db, {
        location_id: 'default',
        dish_name: 'rope burger',
        component_type: 'recipe',
        recipe_slug: 'bacon_jam',
        vendor_ingredient: null,
        qty_per_serving: 0.75,
        unit: 'cup',
        notes: null,
      });
      assert.equal(res.outcome, 'updated');
      assert.equal(Number(res.row.qty_per_serving), 0.75);
    });
  });

  it('returns skipped when row is byte-identical', () => {
    withDb((db) => {
      repo.upsertDishComponent(db, {
        location_id: 'default',
        dish_name: 'rope burger',
        component_type: 'vendor_item',
        recipe_slug: null,
        vendor_ingredient: 'Brioche Bun',
        qty_per_serving: 1,
        unit: 'each',
        notes: null,
      });
      const res = repo.upsertDishComponent(db, {
        location_id: 'default',
        dish_name: 'rope burger',
        component_type: 'vendor_item',
        recipe_slug: null,
        vendor_ingredient: 'Brioche Bun',
        qty_per_serving: 1,
        unit: 'each',
        notes: null,
      });
      assert.equal(res.outcome, 'skipped');
    });
  });
});

describe('listDishComponents', () => {
  it('returns rows ordered for stable export', () => {
    withDb((db) => {
      repo.upsertDishComponent(db, {
        location_id: 'default', dish_name: 'b_dish',
        component_type: 'recipe', recipe_slug: 'a_sauce', vendor_ingredient: null,
        qty_per_serving: 1, unit: 'oz', notes: null,
      });
      repo.upsertDishComponent(db, {
        location_id: 'default', dish_name: 'a_dish',
        component_type: 'recipe', recipe_slug: 'b_sauce', vendor_ingredient: null,
        qty_per_serving: 1, unit: 'oz', notes: null,
      });
      const out = repo.listDishComponents(db, { location_id: 'default' });
      assert.equal(out.length, 2);
      assert.equal(out[0].dish_name, 'a_dish');
      assert.equal(out[1].dish_name, 'b_dish');
    });
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

describe('CLI: import-dish-components.mjs', () => {
  it('imports a valid CSV (1 recipe + 1 vendor_item)', () => {
    const csv = writeCsv(
      'valid.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'The Rope Burger,recipe,bacon_jam,,0.5,cup,jam on top',
        'The Rope Burger,vendor_item,,Brioche Bun,1,each,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inserted: 2, updated: 0, skipped: 0[^,]*, errored: 0/);

    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 2);
    assert.equal(out[0].dish_name, bridge.normalizeDishName('The Rope Burger'));
  });

  it('updates on second import with changed qty', () => {
    const csv1 = writeCsv(
      'v1.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'Burger,recipe,bacon_jam,,0.5,cup,',
      ].join('\n') + '\n',
    );
    const csv2 = writeCsv(
      'v2.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'Burger,recipe,bacon_jam,,0.75,cup,',
      ].join('\n') + '\n',
    );
    const r1 = runImporter(csv1);
    assert.equal(r1.status, 0, r1.stderr);
    const r = runImporter(csv2);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inserted: 0, updated: 1, skipped: 0/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(Number(out[0].qty_per_serving), 0.75);
  });

  it('rejects a row with both recipe_slug AND vendor_ingredient set', () => {
    const csv = writeCsv(
      'invalid.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'Burger,recipe,bacon_jam,Brioche Bun,1,each,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /vendor_ingredient must be empty/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 0, 'invalid import must not write any rows');
  });

  it('--dry-run writes nothing and exits 0', () => {
    const csv = writeCsv(
      'dryrun.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'Burger,recipe,bacon_jam,,0.5,cup,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 0);
  });

  it('round-trip: export → import → export is stable', () => {
    // Seed two rows, one with embedded commas to exercise CSV quoting.
    const csv = writeCsv(
      'seed.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'The Rope Burger,recipe,bacon_jam,,0.5,cup,note one',
        'The Rope Burger,vendor_item,,"Fancy, Bun",1,each,"has, comma"',
      ].join('\n') + '\n',
    );
    const r1 = runImporter(csv);
    assert.equal(r1.status, 0, r1.stderr);

    const e1 = runExporter();
    assert.equal(e1.status, 0, e1.stderr);

    const roundtripCsv = writeCsv('roundtrip.csv', e1.stdout);
    const r2 = runImporter(roundtripCsv);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /inserted: 0, updated: 0, skipped: 2/);

    const e2 = runExporter();
    assert.equal(e2.status, 0, e2.stderr);
    assert.equal(e2.stdout, e1.stdout, 'export must be stable across round-trip');
  });

  it('honors --location-id so rows land on the right location', () => {
    const csv = writeCsv(
      'locscoped.csv',
      [
        'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
        'Burger,recipe,bacon_jam,,0.5,cup,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv, ['--location-id', 'loc42']);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'loc42' });
    assert.equal(out.length, 1);
    assert.equal(out[0].location_id, 'loc42');
  });
});
