#!/usr/bin/env node
// scripts/ingest-analytics.mjs
//
// Reads the Toast/analytics workbooks via Python (ingest_analytics.py)
// then rewrites sales_lines + spend_monthly for the active location and
// triggers the sales-driven depletion sweep so inventory_updates picks
// up the new sales rows automatically.
//
// CLI flags:
//   --skip-depletion   Bypass the post-ingest depletion sweep (legacy
//                      behavior — write only sales_lines / spend_monthly).
//   --force-empty      Allow the DELETE-then-INSERT refresh to proceed
//                      even when the parser returned zero rows. Without
//                      this, an empty parser result is treated as a
//                      "wrong workbook" signal and the script exits
//                      non-zero rather than wiping good data. Only set
//                      when you genuinely want to clear sales_lines /
//                      spend_monthly (e.g. starting fresh).
//
// Note: applyDepletionsForPeriod is idempotent — already-applied
// (location, period) tuples are skipped — so the default sweep is safe
// to run on every analytics ingest.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(__dirname, 'ingest_analytics.py');

const DEFAULT_UNIFIED = path.join(ROOT, 'XL', 'Lariat_Unified_Workbook.xlsx');
const DEFAULT_ANALYTICS = path.join(ROOT, 'XL', 'Lariat_Analytics_Workbook.xlsx');

function parseArgs(argv) {
  const args = { skipDepletion: false, forceEmpty: false };
  for (const a of argv.slice(2)) {
    if (a === '--skip-depletion') args.skipDepletion = true;
    else if (a === '--force-empty') args.forceEmpty = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`ingest-analytics — Toast/analytics workbook → SQLite

Usage:
  node scripts/ingest-analytics.mjs [flags]

Flags:
  --skip-depletion   Skip the post-ingest sales-driven depletion sweep.
  --force-empty      Allow the refresh to proceed even when the parser
                     returned zero rows (default: refuse, to prevent
                     wrong-workbook accidents wiping good data).
  -h, --help         Show this help.
`);
}

/**
 * Pure write of parsed analytics data into the live DB tables. Each
 * table is refreshed (DELETE+INSERT inside one transaction) only when
 * the parser supplied at least one row OR the operator passed
 * forceEmpty=true. This guards against the failure mode where pointing
 * LARIAT_UNIFIED at a stripped working-copy workbook (no Toast sheet)
 * silently truncates sales_lines.
 *
 * Returns counts: { sales_written, spend_written, sales_skipped_empty,
 * spend_skipped_empty }. Tests drive this directly with synthetic
 * data objects so they don't need the Python parser.
 */
export function applyAnalyticsData(db, data, { location_id, period, forceEmpty = false } = {}) {
  const sales = Array.isArray(data?.sales_lines) ? data.sales_lines : [];
  const spend = Array.isArray(data?.spend_monthly) ? data.spend_monthly : [];

  let salesWritten = 0;
  let spendWritten = 0;
  let salesSkippedEmpty = false;
  let spendSkippedEmpty = false;

  db.transaction(() => {
    if (sales.length > 0 || forceEmpty) {
      db.prepare('DELETE FROM sales_lines WHERE location_id = ?').run(location_id);
      const ins = db.prepare(`
        INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
        VALUES (?,?,?,?,?,?)
      `);
      for (const r of sales) {
        ins.run(period, r.item_name, r.quantity_sold ?? null, r.net_sales ?? null, 'toast_import', location_id);
        salesWritten++;
      }
    } else {
      salesSkippedEmpty = true;
    }

    if (spend.length > 0 || forceEmpty) {
      db.prepare('DELETE FROM spend_monthly WHERE location_id = ?').run(location_id);
      const isp = db.prepare(`
        INSERT INTO spend_monthly (month, shamrock_total_spend, source, location_id)
        VALUES (?,?,?,?)
      `);
      for (const r of spend) {
        isp.run(r.month, r.shamrock_total_spend ?? null, r.source || 'analytics', location_id);
        spendWritten++;
      }
    } else {
      spendSkippedEmpty = true;
    }
  })();

  return {
    sales_written: salesWritten,
    spend_written: spendWritten,
    sales_skipped_empty: salesSkippedEmpty,
    spend_skipped_empty: spendSkippedEmpty,
  };
}

/**
 * Walk every distinct period_label in sales_lines for the location and
 * call applyDepletionsForPeriod. Idempotent: already-applied periods are
 * a no-op. Each period gets its own internal transaction (handled by
 * applyDepletionsForPeriod itself — we deliberately do NOT widen the
 * sales_lines write transaction to wrap depletion).
 *
 * shift_date is computed once at the top so every inventory_updates row
 * written by this sweep carries the same stamp (per the depletion spec,
 * this is "when we recorded the calculated consumption," not the sales
 * period date).
 *
 * Exported so the integration test can drive depletion directly without
 * spawning the Python ingest step. Async because lib/salesDepletion.ts
 * is a TypeScript module — under Node 25 strip-types we load it via
 * dynamic import.
 */
export async function runDepletionSweep(db, { location_id, skipDepletion }) {
  if (skipDepletion) {
    console.log('  depletion: skipped (--skip-depletion)');
    return { skipped: true, periods: 0, writes: 0, unresolved: 0, skippedAlready: 0 };
  }

  const periods = db
    .prepare(
      `SELECT DISTINCT period_label FROM sales_lines
        WHERE location_id = ?
          AND period_label IS NOT NULL AND TRIM(period_label) != ''
        ORDER BY period_label`,
    )
    .all(location_id)
    .map((r) => r.period_label);

  if (periods.length === 0) {
    console.log('  depletion: no periods in sales_lines, nothing to do');
    return { skipped: false, periods: 0, writes: 0, unresolved: 0, skippedAlready: 0 };
  }

  const shiftDate = new Date().toISOString().slice(0, 10);
  const { applyDepletionsForPeriod } = await import('../lib/salesDepletion.ts');

  let totalSales = 0;
  let totalWrites = 0;
  let totalUnresolved = 0;
  let skippedAlready = 0;

  for (const period of periods) {
    const r = applyDepletionsForPeriod(db, {
      location_id,
      period_label: period,
      shift_date: shiftDate,
      apply: true,
    });
    const tag = r.applied
      ? `run=${r.run_id}`
      : r.skip_reason === 'already_applied'
        ? `skip already-applied (run=${r.run_id})`
        : `skip ${r.skip_reason ?? 'unknown'}`;
    console.log(
      `  period=${period}  sales=${r.sales_rows_processed}  ` +
        `writes=${r.depletions_written}  unresolved=${r.unresolved_count}  [${tag}]`,
    );
    totalSales += r.sales_rows_processed;
    totalWrites += r.depletions_written;
    totalUnresolved += r.unresolved_count;
    if (!r.applied && r.skip_reason === 'already_applied') skippedAlready++;
  }

  console.log(
    `  depletion TOTAL  periods=${periods.length}  sales=${totalSales}  ` +
      `writes=${totalWrites}  unresolved=${totalUnresolved}  ` +
      `already-applied=${skippedAlready}`,
  );

  return {
    skipped: false,
    periods: periods.length,
    writes: totalWrites,
    unresolved: totalUnresolved,
    skippedAlready,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

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

  // Empty-parser guard: if the Python parser found NO Toast sheet at all
  // (data.toast_sheet === null), the workbook is almost certainly the
  // wrong file (e.g. a stripped working copy without sales data). Refuse
  // to truncate live tables unless --force-empty was passed.
  const sheetFound = data.toast_sheet != null;
  const salesEmpty = !Array.isArray(data.sales_lines) || data.sales_lines.length === 0;
  if (!sheetFound && salesEmpty && !args.forceEmpty) {
    console.error(`✗ ingest_analytics.py found no "Toast - Item Sales*" sheet in the workbook.`);
    console.error(`  workbook: ${UNIFIED}`);
    console.error(`  refusing to truncate sales_lines without a fresh dataset.`);
    console.error(`  if intentional (starting fresh), pass --force-empty.`);
    process.exit(1);
  }

  // getDb() handles schema init internally and respects setDbPathForTest.
  const { getDb } = await import('../lib/db.ts');
  const db = getDb();

  const writeStats = applyAnalyticsData(db, data, {
    location_id: LOC,
    period,
    forceEmpty: args.forceEmpty,
  });

  const salesNote = writeStats.sales_skipped_empty
    ? ' (sales_lines: NOT touched — parser returned 0 rows; pass --force-empty to wipe)'
    : '';
  const spendNote = writeStats.spend_skipped_empty
    ? ' (spend_monthly: NOT touched — parser returned 0 rows; pass --force-empty to wipe)'
    : '';
  console.log(
    `✓ Analytics ingest: ${writeStats.sales_written} item sales rows (${data.toast_sheet || 'n/a'}), ` +
      `${writeStats.spend_written} monthly spend rows → SQLite (${LOC})${salesNote}${spendNote}`,
  );

  // Depletion sweep runs AFTER the sales_lines transaction commits.
  // applyDepletionsForPeriod opens its own transaction per period —
  // do NOT widen the block above to include depletion writes.
  await runDepletionSweep(db, { location_id: LOC, skipDepletion: args.skipDepletion });
}

// Only run main() when invoked as a CLI, not when imported by tests.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
