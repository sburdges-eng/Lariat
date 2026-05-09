// Tests for scripts/import-vendor-prices.mjs CSV `category` column +
// null-category beverage warning.
//
// Audit: docs/audit/2026-05-08-codebase-audit.md §4 — beverage rows with
// category=null are wiped by the next `npm run ingest:costing` because the
// DELETE sweep only preserves rows whose LOWER(category) is in
// BEVERAGE_CATEGORIES (['beer','wine','liquor','spirit','cocktail']).
//
// Two coordinated fixes under test:
//   1) The CSV header recognizes an OPTIONAL `category` column. When set to
//      a beverage label (beer/wine/etc.), it is persisted on the row and
//      that row survives the costing-ingest DELETE sweep.
//   2) Pre-INSERT, if a row's category is null AND its ingredient name
//      matches a beverage keyword (beer/wine/liquor/whiskey/whisky/vodka/
//      gin/rum/tequila/champagne/prosecco/cocktail/spirit), a one-line
//      operator-facing warning is logged. The row is still inserted; the
//      warning is informational so the operator can repair the CSV.
//
// Mirrors the setup in test-import-vendor-prices.mjs.

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

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-vp-bev-'));
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

// Header for CSVs that include the new optional `category` column.
const HEADER_WITH_CATEGORY =
  'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes,category';

// Header for the legacy (pre-fix) layout — used to verify backwards-compat.
const HEADER_LEGACY =
  'vendor,vendor_sku,ingredient_name,pack_size,pack_unit,pack_price,unit_price,imported_at,notes';

describe('import-vendor-prices: optional `category` CSV column', () => {
  it('persists category when CSV provides it (beer)', () => {
    const csv = writeCsv(
      'with-cat-beer.csv',
      [
        HEADER_WITH_CATEGORY,
        "Southern Glazer's,SGWS-COORS-12,Coors Btl 12oz,12,bottle,18.00,1.50,,,beer",
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(
      out[0].category,
      'beer',
      'CSV `category=beer` must be persisted as-is so the costing-ingest sweep preserves the row',
    );
  });

  it('persists category when CSV provides it (wine, mixed-case preserved)', () => {
    const csv = writeCsv(
      'with-cat-wine.csv',
      [
        HEADER_WITH_CATEGORY,
        'Breakthru,BB-BORDEAUX,Bordeaux Bottle,750,ml,22.00,0.0293,,,Wine',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    // We don't lowercase — the costing sweep does LOWER() at SQL time.
    assert.equal(out[0].category, 'Wine');
  });

  it('treats blank category cell as null (regression guard)', () => {
    const csv = writeCsv(
      'with-cat-blank.csv',
      [
        HEADER_WITH_CATEGORY,
        'V,S,Foodstuff,1,bottle,1.00,1.00,,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].category, null);
  });

  it('legacy header (no category column) still imports with category=null', () => {
    // Backwards-compat: existing CSVs that pre-date this change must keep
    // working unchanged.
    const csv = writeCsv(
      'legacy-no-cat.csv',
      [
        HEADER_LEGACY,
        "Southern Glazer's,SGWS-COORS-12,Coors Btl 12oz,12,bottle,18.00,1.50,,",
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].category, null);
  });
});

describe('import-vendor-prices: null-category beverage-name warning', () => {
  it('warns when ingredient name matches "wine" but category is null', () => {
    const csv = writeCsv(
      'null-cat-wine.csv',
      [
        HEADER_LEGACY,
        'Breakthru,BB-BORDEAUX,Bordeaux Wine 750ml,750,ml,22.00,0.0293,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    // Warning appears on stderr (operator-facing).
    const combined = r.stderr + r.stdout;
    assert.match(combined, /WARNING/i);
    assert.match(combined, /Bordeaux Wine 750ml/);
    assert.match(combined, /category=null|category=NULL|null-category/i);
    // Row is still imported — warning, not block.
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].category, null);
  });

  it('warns for each beverage keyword (whiskey, vodka, gin, tequila)', () => {
    const csv = writeCsv(
      'null-cat-multi.csv',
      [
        HEADER_LEGACY,
        'V,S1,Jameson Whiskey 750ml,750,ml,30.00,0.04,,',
        'V,S2,Tito Vodka 1L,1000,ml,20.00,0.02,,',
        'V,S3,Hendrick Gin 750ml,750,ml,28.00,0.0373,,',
        'V,S4,Lunazul Tequila 750ml,750,ml,18.00,0.024,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const combined = r.stderr + r.stdout;
    // One warning per row.
    const matches = combined.match(/WARNING/gi) ?? [];
    assert.ok(
      matches.length >= 4,
      `expected at least 4 WARNING lines, got ${matches.length}: ${combined}`,
    );
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 4);
  });

  it('does NOT warn when ingredient name has no beverage keyword', () => {
    const csv = writeCsv(
      'null-cat-food.csv',
      [
        HEADER_LEGACY,
        'V,S,Roma Tomatoes,25,lb,30.00,1.20,,',
        'V,S2,Yellow Onions,50,lb,40.00,0.80,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const combined = r.stderr + r.stdout;
    assert.doesNotMatch(combined, /WARNING/i);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 2);
  });

  it('does NOT warn when category is set even if name looks like a beverage', () => {
    const csv = writeCsv(
      'cat-set-bordeaux.csv',
      [
        HEADER_WITH_CATEGORY,
        // Category is set → row will survive sweep → no warning needed.
        'Breakthru,BB-BORDEAUX,Bordeaux Wine 750ml,750,ml,22.00,0.0293,,,wine',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const combined = r.stderr + r.stdout;
    assert.doesNotMatch(combined, /WARNING/i);
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 1);
    assert.equal(out[0].category, 'wine');
  });

  it('summary surfaces null-category beverage count when warnings fired', () => {
    const csv = writeCsv(
      'null-cat-summary.csv',
      [
        HEADER_LEGACY,
        'V,S1,Bordeaux Wine 750ml,750,ml,22.00,0.0293,,',
        'V,S2,Roma Tomatoes,25,lb,30.00,1.20,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    // Final stdout summary should mention how many null-category beverage
    // rows tripped the heuristic so the operator can scroll back to find
    // them. Format is operator-facing prose; we only assert the count.
    assert.match(
      r.stdout,
      /1 null-category .*beverage/i,
      `expected stdout summary to mention 1 null-category beverage row, got: ${r.stdout}`,
    );
  });

  it('matches keywords case-insensitively', () => {
    const csv = writeCsv(
      'null-cat-case.csv',
      [
        HEADER_LEGACY,
        'V,S,BEER pints,1,bottle,5.00,5.00,,', // upper-case BEER
      ].join('\n') + '\n',
    );
    const r = runImporter(csv);
    assert.equal(r.status, 0, r.stderr);
    const combined = r.stderr + r.stdout;
    assert.match(combined, /WARNING/i);
  });

  it('--dry-run still emits the warning (so operators can preview)', () => {
    const csv = writeCsv(
      'null-cat-dryrun.csv',
      [
        HEADER_LEGACY,
        'V,S,Tequila Lunazul 750ml,750,ml,18.00,0.024,,',
      ].join('\n') + '\n',
    );
    const r = runImporter(csv, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    const combined = r.stderr + r.stdout;
    assert.match(combined, /WARNING/i);
    assert.match(combined, /Tequila Lunazul 750ml/);
    // Dry-run wrote nothing.
    const out = rows({ location_id: 'default' });
    assert.equal(out.length, 0);
  });
});
