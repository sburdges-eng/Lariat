#!/usr/bin/env node
// Bulk CSV importer for dish_components.
//
// Usage:
//   node scripts/import-dish-components.mjs <path/to.csv> [--location-id <id>] [--dry-run]
//
// CSV columns (header required):
//   dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit, notes
//
// Semantics:
//   - Every row is validated first (validateDishComponentRow).
//   - --dry-run: print a preview and exit 0. No DB writes.
//   - Otherwise all upserts run inside a single transaction.
//   - Exit 1 on any errored rows (unless --dry-run).
//
// The upsert SQL is NOT duplicated here — it's shared with the POST route
// via lib/dishComponentsRepo.ts.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';

// Same TS-resolve hook as the tests so we can import lib/*.ts modules
// from a plain .mjs script.
register(new URL('../tests/js/resolver.mjs', import.meta.url));

const db = await import('../lib/db.ts');
const { normalizeDishName } = await import('../lib/dishCostBridge.ts');
const { upsertDishComponent, validateDishComponentRow } = await import(
  '../lib/dishComponentsRepo.ts'
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
    'Usage: node scripts/import-dish-components.mjs <path/to.csv> ' +
      '[--location-id <id>] [--dry-run]\n',
  );
  process.exit(values.help ? 0 : 1);
}

const csvPath = path.resolve(positionals[0]);
if (!fs.existsSync(csvPath)) {
  process.stderr.write(`import-dish-components: file not found: ${csvPath}\n`);
  process.exit(1);
}

const locationId = values['location-id'] || 'default';
const dryRun = Boolean(values['dry-run']);

// ── RFC-4180-ish CSV parser (just what this importer needs) ────────
// Supports:
//   - double-quoted fields with embedded commas and escaped "" quotes
//   - LF and CRLF line endings
//   - BOM at file start
// Rejects nothing; trims are NOT applied inside quoted fields.
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
      // normalize CRLF by skipping — the \n that follows closes the row
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
  // trailing field
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const REQUIRED_COLUMNS = [
  'dish_name',
  'component_type',
  'recipe_slug',
  'vendor_ingredient',
  'qty_per_serving',
  'unit',
  'notes',
];

const text = fs.readFileSync(csvPath, 'utf8');
const raw = parseCsv(text);
if (raw.length === 0) {
  process.stderr.write('import-dish-components: empty CSV\n');
  process.exit(1);
}

const header = raw[0].map((s) => s.trim());
for (const col of REQUIRED_COLUMNS) {
  if (!header.includes(col)) {
    process.stderr.write(
      `import-dish-components: missing required column "${col}". ` +
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

const staged = []; // { lineNumber, row, errors }
for (let i = 1; i < raw.length; i++) {
  const fields = raw[i];
  // Skip fully-empty lines (e.g. trailing newline → empty row)
  if (fields.length === 0) continue;
  if (fields.length === 1 && fields[0].trim() === '') continue;

  const rawRow = {
    dish_name: pick(fields, 'dish_name').trim(),
    component_type: pick(fields, 'component_type').trim(),
    recipe_slug: clipTrim(pick(fields, 'recipe_slug'), 80),
    vendor_ingredient: clipTrim(pick(fields, 'vendor_ingredient'), 200),
    qty_per_serving: Number(pick(fields, 'qty_per_serving')),
    unit: clipTrim(pick(fields, 'unit'), 24) || '',
    notes: clipTrim(pick(fields, 'notes'), 500),
  };
  const v = validateDishComponentRow(rawRow);
  staged.push({
    lineNumber: i + 1, // 1-indexed, accounting for header
    row: rawRow,
    errors: v.ok ? [] : v.errors,
  });
}

const errored = staged.filter((s) => s.errors.length > 0);
const good = staged.filter((s) => s.errors.length === 0);

if (dryRun) {
  process.stdout.write(
    `import-dish-components: DRY RUN — ${staged.length} rows parsed ` +
      `(${good.length} valid, ${errored.length} errored)\n`,
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
      const key =
        g.row.component_type === 'recipe'
          ? `recipe_slug=${g.row.recipe_slug}`
          : `vendor_ingredient=${g.row.vendor_ingredient}`;
      process.stdout.write(
        `  ${g.row.dish_name} | ${g.row.component_type} | ${key} | ` +
          `${g.row.qty_per_serving} ${g.row.unit}\n`,
      );
    }
  }
  process.exit(0);
}

// ── Execute ────────────────────────────────────────────────────────
if (errored.length > 0) {
  process.stderr.write(
    `import-dish-components: refusing to write — ${errored.length} invalid rows:\n`,
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
      const dish_name = normalizeDishName(s.row.dish_name);
      if (!dish_name) {
        throw new Error(
          `line ${s.lineNumber}: dish_name "${s.row.dish_name}" normalized to empty`,
        );
      }
      const result = upsertDishComponent(sqlite, {
        location_id: locationId,
        dish_name,
        component_type: s.row.component_type,
        recipe_slug: s.row.component_type === 'recipe' ? s.row.recipe_slug : null,
        vendor_ingredient:
          s.row.component_type === 'vendor_item' ? s.row.vendor_ingredient : null,
        qty_per_serving: s.row.qty_per_serving,
        unit: s.row.unit,
        notes: s.row.notes,
      });
      if (result.outcome === 'inserted') inserted++;
      else if (result.outcome === 'updated') updated++;
      else skipped++;
    }
  })();
} catch (err) {
  process.stderr.write(`import-dish-components: transaction failed: ${err.message}\n`);
  process.exit(1);
}

process.stdout.write(
  `import-dish-components: inserted: ${inserted}, updated: ${updated}, ` +
    `skipped: ${skipped} (already identical), errored: 0\n`,
);
process.exit(0);
