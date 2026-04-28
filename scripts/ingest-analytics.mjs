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
  const args = { skipDepletion: false };
  for (const a of argv.slice(2)) {
    if (a === '--skip-depletion') args.skipDepletion = true;
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
  -h, --help         Show this help.
`);
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

  // getDb() handles schema init internally and respects setDbPathForTest.
  const { getDb } = await import('../lib/db.ts');
  const db = getDb();

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
    `✓ Analytics ingest: ${data.sales_lines?.length || 0} item sales rows (${data.toast_sheet || 'n/a'}), ${data.spend_monthly?.length || 0} monthly spend rows → SQLite (${LOC})`,
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
