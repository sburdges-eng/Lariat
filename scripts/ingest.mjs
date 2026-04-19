#!/usr/bin/env node
// Re-ingest the source-of-truth Excel workbook into JSON cache.
// Defaults: XL/Lariat_Unified_Workbook.xlsx and optional XL/Lariat Recipe Book.pdf
// Override: LARIAT_SOURCE, LARIAT_PDF
//
// Run: npm run ingest

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const STATIONS_SEED = path.join(ROOT, 'scripts', 'stations-seed.json');
const PY = path.join(__dirname, 'ingest_unified.py');

const DEFAULT_XLSX = path.join(ROOT, 'XL', 'Lariat_Unified_Workbook.xlsx');
const DEFAULT_PDF = path.join(ROOT, 'XL', 'Lariat Recipe Book.pdf');

const SOURCE = process.env.LARIAT_SOURCE || DEFAULT_XLSX;
const PDF_SOURCE = process.env.LARIAT_PDF || DEFAULT_PDF;

if (!fs.existsSync(SOURCE)) {
  console.error(`✗ Source workbook not found at:\n  ${SOURCE}\n`);
  console.error(`Set LARIAT_SOURCE env var to override (default is ${DEFAULT_XLSX}).`);
  process.exit(1);
}

if (!fs.existsSync(PY)) {
  console.error('✗ Missing scripts/ingest_unified.py');
  process.exit(1);
}

console.log('▶ Reading', SOURCE);
if (!fs.existsSync(PDF_SOURCE)) {
  console.log('  (PDF not found at', PDF_SOURCE, '— PDF recipes skipped; set LARIAT_PDF or add file)');
}

const env = {
  ...process.env,
  LARIAT_SOURCE: SOURCE,
  LARIAT_PDF: fs.existsSync(PDF_SOURCE) ? PDF_SOURCE : '',
};

// Prefer .venv/bin/python3 (has pdfplumber + openpyxl) over system python3
const VENV_PY = path.join(ROOT, '.venv', 'bin', 'python3');
const PYTHON = fs.existsSync(VENV_PY) ? VENV_PY : 'python3';

let output;
try {
  output = execSync(`${JSON.stringify(PYTHON)} ${JSON.stringify(PY)}`, {
    maxBuffer: 50 * 1024 * 1024,
    env,
  });
} catch (e) {
  console.error('✗ Python ingest failed. Make sure python3 + openpyxl are installed:');
  console.error('  python3 -m pip install --user openpyxl');
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}

const data = JSON.parse(output.toString());
fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(path.join(CACHE, 'line_checks.json'), JSON.stringify(data.line_checks, null, 2));
fs.writeFileSync(path.join(CACHE, 'setups.json'), JSON.stringify(data.setups, null, 2));
fs.writeFileSync(path.join(CACHE, 'recipes.json'), JSON.stringify(data.recipes, null, 2));

if (data.staff && data.staff.length) {
  fs.writeFileSync(path.join(CACHE, 'staff.json'), JSON.stringify(data.staff, null, 2));
  console.log('✓ Wrote staff.json (' + data.staff.length + ' from Labor - By Employee)');
} else if (fs.existsSync(path.join(CACHE, 'staff.json'))) {
  console.log('⚠ No staff rows parsed — keeping existing staff.json');
} else {
  console.log('⚠ No staff.json — add Labor - By Employee sheet or create data/cache/staff.json');
}

if (!fs.existsSync(STATIONS_SEED)) {
  console.error('✗ Missing', STATIONS_SEED);
  process.exit(1);
}
fs.copyFileSync(STATIONS_SEED, path.join(CACHE, 'stations.json'));
console.log('✓ Wrote stations.json (from scripts/stations-seed.json)');

console.log('✓ Wrote line_checks.json (' + Object.keys(data.line_checks).length + ' keys)');
console.log('✓ Wrote setups.json (' + Object.keys(data.setups).length + ' station groups)');
console.log('✓ Wrote recipes.json (' + data.recipes.length + ' recipes; +' + (data._pdf_added || 0) + ' from PDF)');
console.log('\nDone. Restart `npm run dev` if it\'s already running.');
