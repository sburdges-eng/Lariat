#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(__dirname, 'ingest_analytics.py');

const DEFAULT_UNIFIED = path.join(ROOT, 'XL', 'Lariat_Unified_Workbook.xlsx');
const DEFAULT_ANALYTICS = path.join(ROOT, 'XL', 'Lariat_Analytics_Workbook.xlsx');

const UNIFIED = process.env.LARIAT_UNIFIED || DEFAULT_UNIFIED;
const ANALYTICS = process.env.LARIAT_ANALYTICS || DEFAULT_ANALYTICS;

if (!fs.existsSync(UNIFIED)) {
  console.error('✗ Unified workbook not found:', UNIFIED);
  process.exit(1);
}

const env = {
  ...process.env,
  LARIAT_UNIFIED: UNIFIED,
  LARIAT_ANALYTICS: fs.existsSync(ANALYTICS) ? ANALYTICS : '',
};

let data;
try {
  data = JSON.parse(execSync(`python3 ${JSON.stringify(PY)}`, { maxBuffer: 50 * 1024 * 1024, env }));
} catch (e) {
  console.error('✗ ingest_analytics.py failed:', e.stderr?.toString() || e.message);
  process.exit(1);
}

const LOC = 'default';
const period = data.toast_sheet || 'toast_item_sales';

const db = new Database(DB_FILE);
initSchema(db);

db.transaction(() => {
  db.prepare('DELETE FROM sales_lines WHERE location_id = ?').run(LOC);
  db.prepare('DELETE FROM spend_monthly WHERE location_id = ?').run(LOC);

  const ins = db.prepare(`
    INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
    VALUES (?,?,?,?,?,?)
  `);
  for (const r of data.sales_lines || []) {
    ins.run(period, r.item_name, r.quantity_sold ?? null, r.net_sales ?? null, 'toast_import', LOC);
  }

  const isp = db.prepare(`
    INSERT INTO spend_monthly (month, shamrock_total_spend, source, location_id)
    VALUES (?,?,?,?)
  `);
  for (const r of data.spend_monthly || []) {
    isp.run(r.month, r.shamrock_total_spend ?? null, r.source || 'analytics', LOC);
  }
})();

console.log(
  `✓ Analytics ingest: ${data.sales_lines?.length || 0} item sales rows (${data.toast_sheet || 'n/a'}), ${data.spend_monthly?.length || 0} monthly spend rows → SQLite (${LOC})`
);
