#!/usr/bin/env node
// Phase 1 Component 2 (GH #267) — manual daily Toast CSV ingest.
//
// Spec: docs/superpowers/specs/2026-04-11-food-cost-prep-forecasting-design.md
//       §"Component 2 — Manual daily Toast CSV ingest".
//
// Reads Toast "Sales Summary by Item" CSVs from XL/toast_daily/<YYYY-MM-DD>.csv
// and writes per-item DAY-level rows into sales_lines (service_period='day',
// service_date=<date>, source='toast_daily_csv'). Idempotent per (date, source):
// re-ingesting a date replaces that day's rows rather than duplicating.
//
// Pure-Node (no pandas/Python dependency). Run:
//   npm run ingest:toast-daily
//   LARIAT_TOAST_DAILY_DIR=./XL/toast_daily npm run ingest:toast-daily

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';

const DAILY_SOURCE = 'toast_daily_csv';

// Logical field → accepted header names (case-insensitive, trimmed).
const HEADER_ALIASES = {
  item_name: ['item', 'item name', 'menu item', 'name'],
  quantity_sold: ['qty sold', 'quantity', 'units', 'qty'],
  net_sales: ['net sales', 'net', 'revenue', 'net $'],
};

/** Parse one CSV line into trimmed fields, honoring double-quoted commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Coerce a CSV cell to a finite number; blanks / non-numeric / "$1,200" → 0. */
function toNumber(value) {
  if (value == null) return 0;
  const n = parseFloat(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract `YYYY-MM-DD` from a filename. Returns null when absent or not a real
 * calendar date (e.g. 2026-13-40).
 */
export function dateFromFilename(name) {
  const m = path.basename(String(name)).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCMonth() + 1 !== Number(mo) ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/**
 * Parse a Toast daily CSV string into `{ rows, detectedHeaders, missingFields }`.
 * Lenient header matching; rows with a blank item name are dropped. `rows` is
 * empty and `missingFields` populated when required columns are absent (item
 * name, plus at least one of quantity/net).
 */
export function parseToastDailyCsv(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    return { rows: [], detectedHeaders: [], missingFields: ['item name', 'quantity', 'net sales'] };
  }

  const headers = splitCsvLine(lines[0]);
  const lower = headers.map((h) => h.toLowerCase());
  const indexOf = (aliases) => {
    for (const a of aliases) {
      const i = lower.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };
  const idx = {
    item_name: indexOf(HEADER_ALIASES.item_name),
    quantity_sold: indexOf(HEADER_ALIASES.quantity_sold),
    net_sales: indexOf(HEADER_ALIASES.net_sales),
  };

  const missingFields = [];
  if (idx.item_name === -1) missingFields.push('item name');
  if (idx.quantity_sold === -1 && idx.net_sales === -1) missingFields.push('quantity / net sales');
  if (missingFields.length > 0) {
    return { rows: [], detectedHeaders: headers, missingFields };
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const item = (cells[idx.item_name] || '').trim();
    if (!item) continue;
    rows.push({
      item_name: item,
      quantity_sold: idx.quantity_sold === -1 ? 0 : toNumber(cells[idx.quantity_sold]),
      net_sales: idx.net_sales === -1 ? 0 : toNumber(cells[idx.net_sales]),
    });
  }
  return { rows, detectedHeaders: headers, missingFields: [] };
}

/**
 * Idempotently write a day's parsed rows into sales_lines. Deletes existing
 * (location, service_period='day', service_date, source) rows first, then
 * inserts, all in one transaction. Returns `{ date, inserted, uniqueItems }`.
 */
export function ingestToastDaily(db, { date, rows, source = DAILY_SOURCE, locationId = 'default' }) {
  const del = db.prepare(
    `DELETE FROM sales_lines
       WHERE location_id = ? AND service_period = 'day' AND service_date = ? AND source = ?`,
  );
  const ins = db.prepare(
    `INSERT INTO sales_lines
       (period_label, item_name, quantity_sold, net_sales, source, location_id, service_date, service_period)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'day')`,
  );
  const periodLabel = `Toast daily ${date}`;
  const run = db.transaction((batch) => {
    del.run(locationId, date, source);
    let inserted = 0;
    for (const r of batch) {
      ins.run(periodLabel, r.item_name, r.quantity_sold, r.net_sales, source, locationId, date);
      inserted++;
    }
    return inserted;
  });
  const inserted = run(rows);
  const uniqueItems = new Set(rows.map((r) => r.item_name)).size;
  return { date, inserted, uniqueItems };
}

/**
 * Walk a directory of `<YYYY-MM-DD>.csv` files and ingest each. Skips files
 * with unparseable names or missing required columns (logging a warning).
 * Returns `{ files, ingested, totalRows, perFile }`.
 */
export function ingestToastDailyDir(db, dir, { source = DAILY_SOURCE, locationId = 'default', log = console } = {}) {
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort();
  const perFile = [];
  let totalRows = 0;
  let ingested = 0;
  for (const file of entries) {
    const date = dateFromFilename(file);
    if (!date) {
      log.warn?.(`skip ${file}: filename is not <YYYY-MM-DD>.csv`);
      continue;
    }
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const { rows, detectedHeaders, missingFields } = parseToastDailyCsv(text);
    if (missingFields.length > 0) {
      log.warn?.(`skip ${file}: missing ${missingFields.join(', ')} (headers: ${detectedHeaders.join(', ')})`);
      continue;
    }
    const res = ingestToastDaily(db, { date, rows, source, locationId });
    perFile.push(res);
    totalRows += res.inserted;
    ingested++;
    log.log?.(`Ingested ${res.inserted} rows from ${date}, ${res.uniqueItems} unique items`);
  }
  return { files: entries.length, ingested, totalRows, perFile };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = process.env.LARIAT_TOAST_DAILY_DIR
    ? path.resolve(process.env.LARIAT_TOAST_DAILY_DIR)
    : path.join(repoRoot, 'XL', 'toast_daily');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created ${dir}\nDrop Toast "Sales Summary by Item" CSVs here named <YYYY-MM-DD>.csv, then re-run.`);
    return;
  }

  const db = new Database(DB_FILE);
  try {
    initSchema(db);
    const summary = ingestToastDailyDir(db, dir);
    console.log(
      `Done: ${summary.ingested}/${summary.files} files, ${summary.totalRows} day-level rows into sales_lines.`,
    );
  } finally {
    db.close();
  }
}

// CLI guard — only run main() when invoked directly (pathToFileURL handles
// symlinks / spaces / percent-encoding). Importing for tests is side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
