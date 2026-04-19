#!/usr/bin/env node
// Export today's line check data + signoffs + 86s + inventory updates
// from SQLite to a real .xlsx workbook in exports/.
// Run: npm run export [YYYY-MM-DD]

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'data', 'lariat.db');
const OUT = path.join(ROOT, 'exports');

if (!fs.existsSync(DB)) {
  console.error('No database yet — run the app first.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const db = new Database(DB, { readonly: true });

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const loc = process.env.LARIAT_EXPORT_LOCATION || process.env.LARIAT_LOCATION || 'default';

const checks = db.prepare(`
  SELECT shift_date, station_id, item, status, par, have, need, note, cook_id, created_at, location_id
  FROM line_check_entries WHERE shift_date = ? AND location_id = ? ORDER BY station_id, item, id
`).all(date, loc);

const signoffs = db.prepare(`
  SELECT shift_date, station_id, cook_id, signoff_type, created_at, location_id
  FROM station_signoffs WHERE shift_date = ? AND location_id = ? ORDER BY station_id, id
`).all(date, loc);

const eightySix = db.prepare(`
  SELECT shift_date, station_id, item, kind, reason, quantity, cook_id, created_at, resolved_at, resolved_by, location_id
  FROM eighty_six WHERE shift_date = ? AND location_id = ? ORDER BY id
`).all(date, loc);

const inventory = db.prepare(`
  SELECT shift_date, station_id, item, delta, direction, note, cook_id, created_at, location_id
  FROM inventory_updates WHERE shift_date = ? AND location_id = ? ORDER BY id
`).all(date, loc);

// Always also write CSV fallbacks (cheap, useful for grep/csvkit)
function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v);
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
fs.writeFileSync(path.join(OUT, `line_checks_${date}.csv`), csv(checks));
fs.writeFileSync(path.join(OUT, `signoffs_${date}.csv`), csv(signoffs));
fs.writeFileSync(path.join(OUT, `eighty_six_${date}.csv`), csv(eightySix));
fs.writeFileSync(path.join(OUT, `inventory_${date}.csv`), csv(inventory));

const xlsxOut = path.join(OUT, `lariat_${date}.xlsx`);
const payload = {
  out: xlsxOut,
  date,
  sheets: {
    'Line Checks': checks,
    'Sign-offs': signoffs,
    '86 Board': eightySix,
    'Inventory': inventory,
  },
};

const py = `
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

data = json.loads(sys.stdin.read())
wb = Workbook()
wb.remove(wb.active)

HEAD_FILL = PatternFill('solid', fgColor='1f2937')
HEAD_FONT = Font(bold=True, color='FFFFFF', size=11)
PASS_FILL = PatternFill('solid', fgColor='dcfce7')
FAIL_FILL = PatternFill('solid', fgColor='fee2e2')

for name, rows in data['sheets'].items():
    ws = wb.create_sheet(title=name[:31])
    if not rows:
        ws.cell(row=1, column=1, value=f'(no {name.lower()} for {data["date"]})')
        continue
    cols = list(rows[0].keys())
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=1, column=i, value=c)
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(horizontal='left')
    for r, row in enumerate(rows, 2):
        for i, c in enumerate(cols, 1):
            v = row.get(c)
            cell = ws.cell(row=r, column=i, value=v if v is not None else '')
            if c == 'status':
                if v == 'pass': cell.fill = PASS_FILL
                elif v == 'fail': cell.fill = FAIL_FILL
    # autosize-ish
    for i, c in enumerate(cols, 1):
        max_len = max([len(str(c))] + [len(str((row.get(c) or ''))) for row in rows])
        ws.column_dimensions[get_column_letter(i)].width = min(max(12, max_len + 2), 48)
    ws.freeze_panes = 'A2'

wb.save(data['out'])
print('OK')
`;

const py3 = process.env.PYTHON || 'python3';
const res = spawnSync(py3, ['-c', py], { input: JSON.stringify(payload), encoding: 'utf-8' });
if (res.status !== 0) {
  console.error('xlsx export failed (CSVs still written):');
  console.error(res.stderr || res.stdout);
  console.log(`✓ CSV-only export: ${checks.length} checks, ${signoffs.length} signoffs, ${eightySix.length} 86s, ${inventory.length} inv updates → ${OUT}`);
  process.exit(0);
}

console.log(`✓ Exported ${date}: ${checks.length} checks · ${signoffs.length} signoffs · ${eightySix.length} 86s · ${inventory.length} inv`);
console.log(`  → ${xlsxOut}`);
