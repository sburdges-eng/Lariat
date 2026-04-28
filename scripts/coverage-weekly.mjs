#!/usr/bin/env node
// scripts/coverage-weekly.mjs
//
// Weekly wrapper around scripts/dish-components-coverage.mjs. Designed to
// be invoked by launchd (see scripts/coverage_weekly/*.plist.template).
//
// On each run we:
//   1. Ensure data/coverage-reports/ exists.
//   2. Build the coverage report via lib functions (no subprocess).
//   3. Write a dated CSV: data/coverage-reports/dish-components-gap-YYYY-MM-DD.csv
//   4. Write a dated summary text file with the pretty table + top-5 list.
//   5. Refresh data/coverage-reports/latest.txt as a copy of the new summary
//      so an operator can `cat` the latest without scrolling for a date.
//
// Output goes to stdout AND the dated summary file. launchd captures the
// stdout into the per-run .log file declared in the plist, so a failed
// week is greppable in the launchd log even if the summary file write
// itself failed.
//
// Idempotency: re-running on the same day OVERWRITES the dated files
// for that date. Different dates accumulate, so the directory is the
// audit trail (one report per Monday).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(REPO_ROOT, 'data', 'coverage-reports');

function todayLocalIso() {
  // Local-time date so the report is keyed by the Monday it ran (not by
  // UTC, which would split a Monday-morning launchd fire across two
  // dates depending on timezone).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Build a short top-N summary from a coverage-report rows array.
 * Pure: same input → same output. Exported for tests.
 */
export function topNSummary(rows, n = 5) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '  (no gap dishes — every dish in sales_lines has a dish_components row)\n';
  }
  const top = rows.slice(0, n);
  const lines = ['', `  top ${top.length} gap dishes by quantity_sold:`, ''];
  const rankWidth = String(top.length).length;
  const qtyWidth = Math.max(
    8,
    ...top.map((r) => String(Math.round(r.qty_sold)).length),
  );
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const rank = String(i + 1).padStart(rankWidth);
    const qty = String(Math.round(r.qty_sold)).padStart(qtyWidth);
    lines.push(`    ${rank}.  ${qty}  ${r.dish_name}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Compose the full summary text written to the dated .txt file. Pure.
 */
export function buildSummaryText({ asOf, location, report, csvPath }) {
  const lines = [];
  lines.push(`dish-components coverage — ${asOf}`);
  lines.push(`  location: ${location}`);
  lines.push('');
  lines.push(
    `  ${report.total_dishes_in_gap} dishes missing dish_components, ` +
      `accounting for ${report.gap_pct}% of recent sales velocity ` +
      `(${Math.round(report.total_gap_qty)}/${Math.round(report.total_qty)} units sold).`,
  );
  lines.push('');
  lines.push(`  CSV: ${csvPath}`);
  lines.push(topNSummary(report.rows, 5));
  return lines.join('\n');
}

async function main() {
  const asOf = todayLocalIso();
  const location = 'default';

  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const csvPath = path.join(REPORT_DIR, `dish-components-gap-${asOf}.csv`);
  const summaryPath = path.join(REPORT_DIR, `coverage-${asOf}.txt`);
  const latestPath = path.join(REPORT_DIR, 'latest.txt');

  // Late dynamic import so a flag-only invocation (or a load failure
  // caused by a missing DB) doesn't pay schema-init cost up front.
  const { getDb } = await import('../lib/db.ts');
  const { buildCoverageReport, writeCoverageCsv } = await import(
    './dish-components-coverage.mjs'
  );

  const db = getDb();
  const report = buildCoverageReport(db, { location, top: 25 });
  writeCoverageCsv(report.rows, csvPath);

  const summary = buildSummaryText({ asOf, location, report, csvPath });
  fs.writeFileSync(summaryPath, summary, 'utf8');
  fs.writeFileSync(latestPath, summary, 'utf8');

  // launchd captures stdout — print the same summary so the run log is
  // self-contained.
  process.stdout.write(summary);
}

main().catch((err) => {
  // Print to stderr so launchd's StandardErrorPath captures it. Don't
  // throw — the plist's KeepAlive=false means a non-zero exit just
  // means "this run failed"; next Monday will retry.
  console.error('coverage-weekly failed:', err.stack || err.message);
  process.exit(1);
});
