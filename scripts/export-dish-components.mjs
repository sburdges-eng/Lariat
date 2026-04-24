#!/usr/bin/env node
// Dump dish_components to stdout as CSV with the same shape the
// importer consumes. Round-trips cleanly through the importer.
//
// Usage:
//   node scripts/export-dish-components.mjs [--location-id <id>] > out.csv

import { parseArgs } from 'node:util';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const db = await import('../lib/db.ts');
const { listDishComponents } = await import('../lib/dishComponentsRepo.ts');

const { values } = parseArgs({
  options: {
    'location-id': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    'Usage: node scripts/export-dish-components.mjs [--location-id <id>] > out.csv\n',
  );
  process.exit(0);
}

// Quote a CSV field. RFC-4180: double-quote it if it contains a quote,
// comma, CR, or LF; double any inner quotes.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const sqlite = db.getDb();
const filter = values['location-id'] ? { location_id: values['location-id'] } : undefined;
const rows = listDishComponents(sqlite, filter);

const HEADER = [
  'dish_name',
  'component_type',
  'recipe_slug',
  'vendor_ingredient',
  'qty_per_serving',
  'unit',
  'notes',
];

process.stdout.write(HEADER.join(',') + '\n');
for (const r of rows) {
  const line = [
    csvField(r.dish_name),
    csvField(r.component_type),
    csvField(r.recipe_slug),
    csvField(r.vendor_ingredient),
    csvField(r.qty_per_serving),
    csvField(r.unit),
    csvField(r.notes),
  ].join(',');
  process.stdout.write(line + '\n');
}
