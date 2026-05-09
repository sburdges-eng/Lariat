#!/usr/bin/env node
// Bulk CSV importer for vendor_prices — initially for drink SKUs that the
// costing ingest has no source feed for (the 341 existing rows are all
// food-side). Seeding these rows unblocks the dish↔vendor bridge wired in
// PR #25 for the top-revenue drink dishes (Tequila Well, Coors, Vodka
// Breck, etc.).
//
// Usage:
//   node scripts/import-vendor-prices.mjs <path/to.csv> [--location-id <id>] [--dry-run]
//
// CSV columns (header required):
//   vendor, vendor_sku, ingredient_name, pack_size, pack_unit, pack_price,
//   unit_price, imported_at, notes
//
// Optional columns (recognized when present in the header):
//   category — set to `beer`, `wine`, `liquor`, `spirit`, or `cocktail`
//     for beverage SKUs that must survive the costing-ingest DELETE
//     sweep (scripts/ingest-costing.mjs preserves rows whose
//     LOWER(category) is in BEVERAGE_CATEGORIES). Leave blank for
//     non-beverage items. If absent or blank, the row is imported
//     with category=NULL — and if the ingredient name LOOKS like a
//     beverage (matches one of beer/wine/liquor/whiskey/whisky/vodka/
//     gin/rum/tequila/champagne/prosecco/cocktail/spirit), the
//     importer logs a one-line WARNING so the operator can repair the
//     CSV before the next costing ingest wipes the row.
//
// Semantics:
//   - vendor_sku and ingredient_name are renamed from the DB columns
//     (sku, ingredient) purely for human readability in the fill-me
//     templates. The importer maps them back.
//   - unit_price may be left blank in the CSV; the importer derives
//     pack_price / pack_size in that case. If both are blank or
//     pack_size is missing, the row is errored.
//   - imported_at is managed by the DB (datetime('now')); the column
//     exists in the CSV for round-trip readability but is ignored on
//     import.
//   - notes is purely documentation — the vendor_prices table has no
//     notes column, so the value is discarded after logging.
//   - Every row is validated first (validateVendorPriceRow).
//   - --dry-run: print a preview and exit 0. No DB writes.
//   - Otherwise all upserts run inside a single transaction.
//   - Exit 1 on any errored rows (unless --dry-run).
//
// The upsert SQL is shared with any future caller via
// lib/vendorPricesRepo.ts. Do not duplicate.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';

// Same TS-resolve hook as the tests so we can import lib/*.ts modules
// from a plain .mjs script.
register(new URL('../tests/js/resolver.mjs', import.meta.url));

const db = await import('../lib/db.ts');
const { upsertVendorPrice, validateVendorPriceRow } = await import(
  '../lib/vendorPricesRepo.ts'
);

// ── Args ───────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'location-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length === 0) {
  process.stdout.write(
    'Usage: node scripts/import-vendor-prices.mjs <path/to.csv> ' +
      '[--location-id <id>] [--dry-run]\n',
  );
  process.exit(values.help ? 0 : 1);
}

const csvPath = path.resolve(positionals[0]);
if (!fs.existsSync(csvPath)) {
  process.stderr.write(`import-vendor-prices: file not found: ${csvPath}\n`);
  process.exit(1);
}

const locationId = values['location-id'] || 'default';
const dryRun = Boolean(values['dry-run']);

// ── RFC-4180-ish CSV parser (matches import-dish-components.mjs) ──
// Supports:
//   - double-quoted fields with embedded commas and escaped "" quotes
//   - LF and CRLF line endings
//   - BOM at file start
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') {
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const REQUIRED_COLUMNS = [
  'vendor',
  'vendor_sku',
  'ingredient_name',
  'pack_size',
  'pack_unit',
  'pack_price',
  'unit_price',
  'imported_at',
  'notes',
];

// Optional columns recognized when present in the CSV header. Absent →
// treated as null for every row. See header docblock for `category`.
// `pick()` already falls back to '' when a column is missing, so optional
// columns require no header-validation gate; this comment documents intent.

// Heuristic name-match keywords. If a row imports with category=null AND
// its ingredient name matches one of these (case-insensitive substring),
// the importer logs a WARNING because the next costing ingest will WIPE
// the row (only LOWER(category) IN BEVERAGE_CATEGORIES survives the
// DELETE sweep — see scripts/ingest-costing.mjs::BEVERAGE_CATEGORIES).
// This is a heuristic — the operator owns the CSV; we do NOT auto-classify.
const BEVERAGE_KEYWORDS = [
  'beer',
  'wine',
  'liquor',
  'whiskey',
  'whisky',
  'vodka',
  'gin',
  'rum',
  'tequila',
  'champagne',
  'prosecco',
  'cocktail',
  'spirit',
];

function looksLikeBeverage(ingredient) {
  if (!ingredient) return false;
  const lower = String(ingredient).toLowerCase();
  // Word-boundary match so 'gin' doesn't fire on 'ginger' or 'origin'.
  // (Substring match would be too noisy; '\bgin\b' avoids the worst false
  // positives while still catching 'Hendrick Gin 750ml'.)
  for (const kw of BEVERAGE_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(lower)) return true;
  }
  return false;
}

const text = fs.readFileSync(csvPath, 'utf8');
const raw = parseCsv(text);
if (raw.length === 0) {
  process.stderr.write('import-vendor-prices: empty CSV\n');
  process.exit(1);
}

const header = raw[0].map((s) => s.trim());
for (const col of REQUIRED_COLUMNS) {
  if (!header.includes(col)) {
    process.stderr.write(
      `import-vendor-prices: missing required column "${col}". ` +
        `Expected header: ${REQUIRED_COLUMNS.join(',')}\n`,
    );
    process.exit(1);
  }
}
const colIdx = Object.fromEntries(header.map((h, i) => [h, i]));

// ── Stage rows ─────────────────────────────────────────────────────
function pick(fields, name) {
  const idx = colIdx[name];
  if (idx === undefined) return '';
  const v = fields[idx];
  return v === undefined ? '' : v;
}

function clipTrim(s, max) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.slice(0, max);
}

function numOrNull(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Track null-category rows that look like beverages so the final summary
// can surface the count. Warnings themselves are logged inline below.
let nullCategoryBeverageCount = 0;

const staged = []; // { lineNumber, row, errors }
for (let i = 1; i < raw.length; i++) {
  const fields = raw[i];
  // Skip fully-empty lines (e.g. trailing newline → empty row)
  if (fields.length === 0) continue;
  if (fields.length === 1 && fields[0].trim() === '') continue;

  const vendor = pick(fields, 'vendor').trim();
  const sku = clipTrim(pick(fields, 'vendor_sku'), 120);
  const ingredient = pick(fields, 'ingredient_name').trim();
  const packSize = numOrNull(pick(fields, 'pack_size'));
  const packUnit = pick(fields, 'pack_unit').trim();
  const packPrice = numOrNull(pick(fields, 'pack_price'));
  let unitPrice = numOrNull(pick(fields, 'unit_price'));
  // Optional `category` — recognized only when the column is present in
  // the header. clipTrim returns null for absent/blank cells, which is
  // exactly what we want: same default as the legacy behavior.
  const category = clipTrim(pick(fields, 'category'), 64);

  // Derive unit_price from pack_price / pack_size if the CSV left it
  // blank. This is a convenience for humans filling in the template:
  // "I know the case is $18 and there are 12 bottles, you do the math."
  // Refuses to derive if either operand is missing or zero.
  const derivedUnitPrice =
    unitPrice === null &&
    Number.isFinite(packPrice) &&
    packPrice !== null &&
    Number.isFinite(packSize) &&
    packSize !== null &&
    Number(packSize) > 0
      ? Number(packPrice) / Number(packSize)
      : null;
  if (unitPrice === null && derivedUnitPrice !== null) {
    unitPrice = derivedUnitPrice;
  }

  const rawRow = {
    location_id: locationId,
    vendor,
    sku,
    ingredient,
    pack_size: packSize,
    pack_unit: packUnit,
    pack_price: packPrice,
    unit_price: unitPrice,
    category,
  };
  const v = validateVendorPriceRow(rawRow);

  // Operator-facing warning for likely-beverage-but-null-category rows.
  // The next `npm run ingest:costing` will WIPE these rows because the
  // DELETE sweep only preserves LOWER(category) IN BEVERAGE_CATEGORIES.
  // Fired regardless of --dry-run so operators can preview the warning.
  // Validation errors don't suppress the warning — if a row is borderline
  // we still want the operator to see both signals.
  if (category === null && looksLikeBeverage(ingredient)) {
    nullCategoryBeverageCount += 1;
    process.stderr.write(
      `[import-vendor-prices] WARNING: line ${i + 1} "${ingredient}" looks ` +
        `like a beverage but has category=null. The next ` +
        `\`npm run ingest:costing\` will WIPE this row during the ` +
        `vendor_prices DELETE sweep. Set category=beer/wine/liquor/spirit/` +
        `cocktail in the CSV to survive.\n`,
    );
  }

  staged.push({
    lineNumber: i + 1, // 1-indexed, accounting for header
    row: rawRow,
    derivedUnitPrice: derivedUnitPrice !== null && unitPrice === derivedUnitPrice,
    errors: v.ok ? [] : v.errors,
  });
}

const errored = staged.filter((s) => s.errors.length > 0);
const good = staged.filter((s) => s.errors.length === 0);

function formatBeverageWarningSummary(count) {
  if (count <= 0) return '';
  return (
    ` (${count} null-category row${count === 1 ? '' : 's'} look like ` +
    `beverages — see WARNINGs above)`
  );
}

if (dryRun) {
  process.stdout.write(
    `import-vendor-prices: DRY RUN — ${staged.length} rows parsed ` +
      `(${good.length} valid, ${errored.length} errored)` +
      `${formatBeverageWarningSummary(nullCategoryBeverageCount)}\n`,
  );
  if (errored.length) {
    process.stdout.write('\nerrored rows:\n');
    for (const e of errored) {
      process.stdout.write(`  line ${e.lineNumber}: ${e.errors.join('; ')}\n`);
    }
  }
  if (good.length) {
    process.stdout.write('\nwould upsert:\n');
    for (const g of good) {
      const skuShown = g.row.sku ? g.row.sku : '(no sku)';
      const derived = g.derivedUnitPrice ? ' [derived]' : '';
      process.stdout.write(
        `  ${g.row.vendor} | ${skuShown} | ${g.row.ingredient} | ` +
          `${g.row.pack_size ?? '(none)'} ${g.row.pack_unit} @ ${g.row.pack_price} ` +
          `→ unit ${g.row.unit_price}${derived}\n`,
      );
    }
  }
  process.exit(0);
}

// ── Execute ────────────────────────────────────────────────────────
if (errored.length > 0) {
  process.stderr.write(
    `import-vendor-prices: refusing to write — ${errored.length} invalid rows:\n`,
  );
  for (const e of errored) {
    process.stderr.write(`  line ${e.lineNumber}: ${e.errors.join('; ')}\n`);
  }
  process.exit(1);
}

const sqlite = db.getDb();
let inserted = 0;
let updated = 0;
let skipped = 0;

try {
  sqlite.transaction(() => {
    for (const s of good) {
      const result = upsertVendorPrice(sqlite, s.row);
      if (result.outcome === 'inserted') inserted++;
      else if (result.outcome === 'updated') updated++;
      else skipped++;
    }
  })();
} catch (err) {
  process.stderr.write(`import-vendor-prices: transaction failed: ${err.message}\n`);
  process.exit(1);
}

process.stdout.write(
  `import-vendor-prices: inserted: ${inserted}, updated: ${updated}, ` +
    `skipped: ${skipped} (already identical), errored: 0` +
    `${formatBeverageWarningSummary(nullCategoryBeverageCount)}\n`,
);
process.exit(0);
