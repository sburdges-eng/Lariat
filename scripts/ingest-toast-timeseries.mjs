#!/usr/bin/env node
// scripts/ingest-toast-timeseries.mjs
// Ingest Toast POS timeseries CSVs into SQLite.
// Uses three-table single transaction (all-or-nothing). If single-txn
// complexity were ever a burden, split to per-table as ingest-analytics.mjs
// does — the spec permits either approach.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { parseToastDateCsv, parseToastDayCsv, parseToastTimeCsv } from './lib/toast_csv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ───────────────────────────────────────────────────────

const USAGE = 'Usage: node scripts/ingest-toast-timeseries.mjs [--dir PATH] [--location ID] [--strict]';

let dir = path.join(ROOT, 'data/originals/Toast');
let locationId = 'default';
let strict = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--strict') { strict = true; continue; }
  const eq = a.indexOf('=');
  const flag = eq === -1 ? a : a.slice(0, eq);
  const val  = eq === -1 ? args[++i] : a.slice(eq + 1);
  if (flag === '--dir')      { dir = path.resolve(ROOT, val); continue; }
  if (flag === '--location') { locationId = val; continue; }
  console.error(`Unknown flag: ${a}\n${USAGE}`);
  process.exit(1);
}

// ── File discovery (newest mtime wins per category) ────────────────

function newestMatch(dir, prefix) {
  const entries = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
    .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => (b.mtime - a.mtime) || b.f.localeCompare(a.f));
  return entries.length ? { full: path.join(dir, entries[0].f), base: entries[0].f } : null;
}

const categories = [
  { name: 'daily',      prefix: 'sales-by-date-', parse: parseToastDateCsv,  table: 'toast_sales_daily' },
  { name: 'day-of-week',prefix: 'sales-by-day-',  parse: parseToastDayCsv,   table: 'toast_sales_dow'   },
  { name: 'hour-of-day',prefix: 'sales-by-time-', parse: parseToastTimeCsv,  table: 'toast_sales_hour'  },
];

const resolved = [];
for (const cat of categories) {
  const match = newestMatch(dir, cat.prefix);
  if (!match) {
    console.error(`✗ No ${cat.name} CSV found in ${dir} (expected prefix "${cat.prefix}")`);
    process.exit(1);
  }
  console.log(`Using ${match.base}`);
  resolved.push({ ...cat, file: match.full });
}

// ── Parse all three files upfront ─────────────────────────────────

const parsed = [];
let anyRejects = false;

for (const { name, file, parse, table } of resolved) {
  const text = fs.readFileSync(file, 'utf8');
  let result;
  try {
    result = parse(text);
  } catch (e) {
    console.error(`✗ Parser error in ${path.basename(file)}: ${e.message}`);
    process.exit(1);
  }
  if (result.rejects.length > 0) {
    anyRejects = true;
    const sample = result.rejects.slice(0, 2).map(r => `"${r.raw_line.trim().slice(0, 60)}" (${r.reason})`).join(', ');
    const extra = result.rejects.length > 2 ? ` (+${result.rejects.length - 2} more)` : '';
    console.warn(`  ⚠ ${result.rejects.length} reject(s) in ${path.basename(file)}: ${sample}${extra}`);
  }
  parsed.push({ name, file, table, rows: result.rows, rejects: result.rejects });
}

if (anyRejects && strict) {
  console.error('✗ Exiting due to rejects (--strict mode).');
  process.exit(1);
}

// ── DB insert helpers ──────────────────────────────────────────────

const INS = {
  toast_sales_daily: (db) => db.prepare(`
    INSERT INTO toast_sales_daily (shift_date, net_sales, orders, guests, comparison_group, date_range, source, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  toast_sales_dow: (db) => db.prepare(`
    INSERT INTO toast_sales_dow (day_of_week, net_sales, orders, guests, comparison_group, date_range, source, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  toast_sales_hour: (db) => db.prepare(`
    INSERT INTO toast_sales_hour (hour_24, label, net_sales, orders, guests, comparison_group, date_range, source, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
};

function rowToArgs(table, r, loc) {
  if (table === 'toast_sales_daily')
    return [r.shift_date, r.net_sales, r.orders, r.guests, r.comparison_group, r.date_range, 'toast_csv', loc];
  if (table === 'toast_sales_dow')
    return [r.day_of_week, r.net_sales, r.orders, r.guests, r.comparison_group, r.date_range, 'toast_csv', loc];
  // toast_sales_hour
  return [r.hour_24, r.label, r.net_sales, r.orders, r.guests, r.comparison_group, r.date_range, 'toast_csv', loc];
}

// ── Write (single transaction) ─────────────────────────────────────

const db = new Database(DB_FILE);
initSchema(db);

db.transaction(() => {
  for (const { table, rows } of parsed) {
    db.prepare(`DELETE FROM ${table} WHERE location_id = ?`).run(locationId);
    const ins = INS[table](db);
    for (const r of rows) ins.run(...rowToArgs(table, r, locationId));
  }
})();

// ── Summary ────────────────────────────────────────────────────────

const [daily, dow, hour] = parsed;
const rejectParts = parsed
  .filter(p => p.rejects.length > 0)
  .map(p => `  ⚠ ${p.rejects.length} rejects in ${path.basename(p.file)}`);

console.log(
  `✓ Toast timeseries: ${daily.rows.length} daily / ${dow.rows.length} dow / ${hour.rows.length} hour rows` +
  ` → SQLite (location=${locationId}) from ${path.relative(ROOT, dir) || dir}`
);
if (rejectParts.length) console.log(rejectParts.join('\n'));
