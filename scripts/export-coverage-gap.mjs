#!/usr/bin/env node
// Gap-aware exporter: emit a CSV of rows that still need filling in, one per
// (dish, declared-component) pair. Output is importable by
// scripts/import-dish-components.mjs once the operator fills in
// qty_per_serving and (if missing) unit.
//
// Difference from scripts/export-dish-components.mjs: that one dumps rows
// already present in dish_components (round-trip check). This one dumps
// rows that SHOULD exist but don't yet — ordered by per-dish revenue so
// BOH staff fill the biggest-money dishes first.
//
// Usage:
//   node scripts/export-coverage-gap.mjs \
//     [--location-id <id>] [--out <path>] \
//     [--include-unlinked] [--min-revenue <n>]
//
// Default output path: os.tmpdir()/dish-components-gap.csv
// Summary goes to stderr so stdout stays pristine for shell pipelines.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { buildCoverageGapRows } = await import('../lib/dishCoverageReport.ts');

const { values } = parseArgs({
  options: {
    'location-id': { type: 'string' },
    out: { type: 'string' },
    'include-unlinked': { type: 'boolean', default: false },
    'min-revenue': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    'Usage: node scripts/export-coverage-gap.mjs ' +
      '[--location-id <id>] [--out <path>] ' +
      '[--include-unlinked] [--min-revenue <n>]\n' +
      '\nDefault --out is the system temp directory.\n' +
      'Output columns match scripts/import-dish-components.mjs so the file ' +
      'round-trips through that importer once qty/unit are filled in.\n',
  );
  process.exit(0);
}

const locationId = values['location-id'] || 'default';
const outPath = values.out || path.join(os.tmpdir(), 'dish-components-gap.csv');
const includeUnlinked = Boolean(values['include-unlinked']);
const minRevenue = values['min-revenue'] != null ? Number(values['min-revenue']) : 0;
if (!Number.isFinite(minRevenue) || minRevenue < 0) {
  process.stderr.write(
    `export-coverage-gap: --min-revenue must be a non-negative number, got "${values['min-revenue']}"\n`,
  );
  process.exit(1);
}

const rows = buildCoverageGapRows({
  locationId,
  includeUnlinked,
  minRevenue,
});

// Quote a CSV field per RFC-4180. Mirror scripts/export-dish-components.mjs
// exactly so the two exporters produce format-compatible CSVs.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const HEADER = [
  'dish_name',
  'component_type',
  'recipe_slug',
  'vendor_ingredient',
  'qty_per_serving',
  'unit',
  'notes',
];

const lines = [HEADER.join(',')];
for (const r of rows) {
  lines.push(
    [
      csvField(r.dish_name),
      csvField(r.component_type),
      csvField(r.recipe_slug),
      csvField(r.vendor_ingredient),
      csvField(r.qty_per_serving),
      csvField(r.unit),
      csvField(r.notes),
    ].join(','),
  );
}
const csv = lines.join('\n') + '\n';

// Make sure parent directory exists; a custom --out might not.
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, csv, 'utf8');

// ── Summary on stderr ────────────────────────────────────────────
const distinctDishes = new Set(rows.map((r) => r.dish_name));
const topDishes = [];
{
  const byDish = new Map();
  for (const r of rows) {
    if (!byDish.has(r.dish_name)) {
      byDish.set(r.dish_name, r.revenue);
    }
  }
  const ordered = [...byDish.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, rev] of ordered.slice(0, 5)) {
    topDishes.push(`${name} ($${rev.toFixed(0)})`);
  }
}

process.stderr.write(
  `export-coverage-gap: ${rows.length} rows ` +
    `(${distinctDishes.size} dish${distinctDishes.size === 1 ? '' : 'es'}` +
    `, includeUnlinked=${includeUnlinked}` +
    `, minRevenue=${minRevenue}` +
    `) → ${outPath}\n`,
);
if (topDishes.length) {
  process.stderr.write(
    `  top ${topDishes.length} by revenue: ${topDishes.join(', ')}\n`,
  );
}

process.exit(0);
