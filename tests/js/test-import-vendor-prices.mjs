// Tests for scripts/import-vendor-prices.mjs + lib/vendorPricesRepo.ts.
//
// Mirrors the setup used in test-dish-cost-bridge.mjs and the Option 1
// dish_components importer: register the TS resolver, swap getDb() to a
// fresh temp SQLite file, exercise the shared repo directly plus the CLI
// via a child process.
//
// Covers:
//   - validateVendorPriceRow rules (happy + invalid shapes)
//   - upsertVendorPrice: insert, update, skipped (identical)
//   - CLI: valid insert and update path
//   - CLI: derived unit_price from pack_price / pack_size
//   - CLI: invalid row (missing unit_price and not derivable) errors out
//   - CLI: --dry-run writes nothing
//   - CLI: --location-id routes rows to the right location
//
// Round-trip through a future exporter is explicitly NOT tested — the
// Option 2 scope doesn't ship one, and inventing a throwaway exporter
// here would couple to an un-merged contract.

import { describe, it, after, beforeEach } from 'node:test';
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
const IMPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'import-vendor-prices.mjs');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-vp-csv-'));
const CHILD_CWD = path.join(TMP_DIR, 'cwd');
fs.mkdirSync(path.join(CHILD_CWD, 'data'), { recursive: true });
const TMP_DB = path.join(CHILD_CWD, 'data', 'lariat.db');
const CSV_DIR = path.join(TMP_DIR, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

const dbMod = await import('../../lib/db.ts');
const repo = await import('../../lib/vendorPricesRepo.ts');

dbMod.setDbPathForTest(TMP_DB);
dbMod.getDb(); // materialize schema on disk

function openFresh() {
  dbMod.setDbPathForTest(null);
  dbMod.setDbPathForTest(TMP_DB);
  return dbMod.getDb();
}

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const db = openFresh();
  db.exec(`DELETE FROM vendor_prices;`);
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

function rows(filter) {
  const db = openFresh();
  const out = repo.listVendorPrices(db, filter);
  dbMod.setDbPathForTest(null);
  return out;
}

function withDb(fn) {
  const db = openFresh();
  try {
    return fn(db);
  } finally {
    dbMod.setDbPathForTest(null);
  }
}

// ── Validator tests ────────────────────────────────────────────────

describe('validateVendorPriceRow', () => {
  it('accepts a valid bottle row', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: "Southern Glazer's",
      sku: 'SGWS-COORS-12',
      ingredient: 'Coors Btl 12oz',
      pack_size: 12,
      pack_unit: 'bottle',
      pack_price: 18.0,
      unit_price: 1.5,
      category: null,
    });
    assert.equal(v.ok, true);
  });

  it('accepts an ml-based liquor row', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: 'Breakthru',
      sku: 'BB-LUNAZUL-750',
      ingredient: 'Tequila Lunazul 750ml',
      pack_size: 750,
      pack_unit: 'ml',
      pack_price: 18.0,
      unit_price: 0.024,
      category: null,
    });
    assert.equal(v.ok, true);
  });

  it('rejects a zero pack_price', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: 'V',
      sku: 'S',
      ingredient: 'X',
      pack_size: 1,
      pack_unit: 'bottle',
      pack_price: 0,
      unit_price: 1,
      category: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('pack_price')));
  });

  it('rejects a missing vendor', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: '',
      sku: '',
      ingredient: 'X',
      pack_size: 1,
      pack_unit: 'bottle',
      pack_price: 1,
      unit_price: 1,
      category: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('vendor')));
  });

  it('rejects an unknown pack_unit', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: 'V',
      sku: 'S',
      ingredient: 'X',
      pack_size: 1,
      pack_unit: 'squiggle',
      pack_price: 1,
      unit_price: 1,
      category: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('not a known unit')));
  });

  it('rejects a negative pack_size', () => {
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: 'V',
      sku: 'S',
      ingredient: 'X',
      pack_size: -1,
      pack_unit: 'bottle',
      pack_price: 1,
      unit_price: 1,
      category: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('pack_size')));
  });

  it('rejects a missing unit_price (importer derivation is CLI-side)', () => {
    // The repo-level validator demands unit_price. The CLI layer derives
    // it from pack_price/pack_size before calling here.
    const v = repo.validateVendorPriceRow({
      location_id: 'default',
      vendor: 'V',
      sku: 'S',
      ingredient: 'X',
      pack_size: 12,
      pack_unit: 'bottle',
      pack_price: 18,
      unit_price: null,
      category: null,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('unit_price')));
  });
});

// ── Repo tests ─────────────────────────────────────────────────────

describe('upsertVendorPrice', () => {
  it('inserts a new row', () => {
    withDb((db) => {
      const res = repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: "Southern Glazer's",
        sku: 'SGWS-COORS-12',
        ingredient: 'Coors Btl 12oz',
        pack_size: 12,
        pack_unit: 'bottle',
        pack_price: 18.0,
        unit_price: 1.5,
        category: null,
      });
      assert.equal(res.outcome, 'inserted');
      assert.equal(res.row.ingredient, 'Coors Btl 12oz');
      assert.equal(res.row.vendor, "Southern Glazer's");
      assert.equal(Number(res.row.unit_price), 1.5);
    });
  });

  it('updates when unit_price changes on same natural key', () => {
    withDb((db) => {
      repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: "Southern Glazer's",
        sku: 'SGWS-COORS-12',
        ingredient: 'Coors Btl 12oz',
        pack_size: 12,
        pack_unit: 'bottle',
        pack_price: 18.0,
        unit_price: 1.5,
        category: null,
      });
      const res = repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: "Southern Glazer's",
        sku: 'SGWS-COORS-12',
        ingredient: 'Coors Btl 12oz',
        pack_size: 12,
        pack_unit: 'bottle',
        pack_price: 18.95,
        unit_price: 1.58,
        category: null,
      });
      assert.equal(res.outcome, 'updated');
      assert.equal(Number(res.row.unit_price), 1.58);
    });
  });

  it('returns skipped when the row is byte-identical', () => {
    withDb((db) => {
      const shared = {
        location_id: 'default',
        vendor: 'V',
        sku: 'S1',
        ingredient: 'Ing',
        pack_size: 1,
        pack_unit: 'bottle',
        pack_price: 1,
        unit_price: 1,
        category: null,
      };
      repo.upsertVendorPrice(db, shared);
      const res = repo.upsertVendorPrice(db, shared);
      assert.equal(res.outcome, 'skipped');
    });
  });

  it('treats NULL and "" sku as the same natural-key slot', () => {
    withDb((db) => {
      // Insert with '' sku (common for draft beer: no SKU).
      repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: 'V',
        sku: '',
        ingredient: 'Draft Beer',
        pack_size: 1,
        pack_unit: 'bottle',
        pack_price: 1,
        unit_price: 1,
        category: null,
      });
      // Second call with NULL sku must update the same row, not create a twin.
      const res = repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: 'V',
        sku: null,
        ingredient: 'Draft Beer',
        pack_size: 1,
        pack_unit: 'bottle',
        pack_price: 1.10,
        unit_price: 1.10,
        category: null,
      });
      assert.equal(res.outcome, 'updated');
      const all = repo.listVendorPrices(db, { location_id: 'default' });
      assert.equal(all.length, 1, 'NULL vs "" sku must not create a twin');
    });
  });

  it('isolates rows by location_id', () => {
    withDb((db) => {
      repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: 'V', sku: 'S', ingredient: 'X',
        pack_size: 1, pack_unit: 'bottle', pack_price: 1, unit_price: 1,
        category: null,
      });
      const res = repo.upsertVendorPrice(db, {
        location_id: 'loc42',
        vendor: 'V', sku: 'S', ingredient: 'X',
        pack_size: 1, pack_unit: 'bottle', pack_price: 1, unit_price: 1,
        category: null,
      });
      // Same key at a DIFFERENT location is a fresh insert.
      assert.equal(res.outcome, 'inserted');
    });
  });
});

describe('listVendorPrices', () => {
  it('returns rows ordered for stable output', () => {
    withDb((db) => {
      repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: 'B', sku: 'S', ingredient: 'A',
        pack_size: 1, pack_unit: 'bottle', pack_price: 1, unit_price: 1,
        category: null,
      });
      repo.upsertVendorPrice(db, {
        location_id: 'default',
        vendor: 'A', sku: 'S', ingredient: 'B',
        pack_size: 1, pack_unit: 'bottle', pack_price: 1, unit_price: 1,
        category: null,
      });
      const out = repo.listVendorPrices(db, { location_id: 'default' });
      assert.equal(out.length, 2);
      assert.equal(out[0].vendor, 'A');
      assert.equal(out[1].vendor, 'B');
    });
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

describe('CLI: import-vendor-prices.mjs', () => {
  it('imports a valid CSV (2 rows)', () => {
    const csv = writeCsv(
      'valid.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        "Southern Glazer's,SGWS-COORS-12,Coors Btl 12oz,12,bottle,18.00,1.50,,",
        'Breakthru,BB-LUNAZUL-750,Tequila Lunazul 750ml,750,ml,18.00,0.024,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inserted: 2, updated: 0, skipped: 0[^,]*, errored: 0/);

    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 2);
  });

  it('updates on second import with a changed price', () => {
    const csv1 = writeCsv(
      'v1.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Ing,1,bottle,1.00,1.00,,',
      ].join('\n') + '\n',
    );
    const csv2 = writeCsv(
      'v2.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Ing,1,bottle,1.25,1.25,,',
      ].join('\n') + '\n',
    );
    const r1 = runImporter(csv1);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runImporter(csv2);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /inserted: 0, updated: 1, skipped: 0/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(Number(out[0].unit_price), 1.25);
  });

  it('derives unit_price from pack_price / pack_size when blank', () => {
    // Case of 12 bottles @ $18.00 → derived unit_price = 1.50.
    const csv = writeCsv(
      'derived.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Case Beer,12,bottle,18.00,,,derived',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(Number(out[0].unit_price), 1.5);
  });

  it('rejects a row with no unit_price and no derivable pack_size', () => {
    const csv = writeCsv(
      'bad.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Ing,,bottle,18.00,,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /unit_price/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 0, 'invalid import must not write any rows');
  });

  it('--dry-run writes nothing and exits 0', () => {
    const csv = writeCsv(
      'dryrun.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Ing,1,bottle,1.00,1.00,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 0);
  });

  it('honors --location-id so rows land on the right location', () => {
    const csv = writeCsv(
      'locscoped.csv',
      [
        'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes',
        'V,S,Ing,1,bottle,1.00,1.00,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv, ['--location-id', 'loc42']);
    assert.equal(r.status, 0, r.stderr);
    const a = rows({ location_id: 'default' });
    const b = rows({ location_id: 'loc42' });
    assert.equal(a.length, 0);
    assert.equal(b.length, 1);
    assert.equal(b[0].location_id, 'loc42');
  });

  it('rejects a CSV that is missing a required column', () => {
    const csv = writeCsv(
      'missingcol.csv',
      [
        'vendor,ingredient_name,pack_size,pack_unit,pack_price,unit_price,notes',
        'V,Ing,1,bottle,1,1,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing required column/);
  });

  it('reports 0 errors and exits 0 on an empty-body CSV (header only)', () => {
    const csv = writeCsv(
      'headeronly.csv',
      'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inserted: 0, updated: 0/);
  });
});
