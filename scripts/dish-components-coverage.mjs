#!/usr/bin/env node
// scripts/dish-components-coverage.mjs
//
// Read-only CLI: surface dishes that appear in sales_lines but lack a
// dish_components row, sorted by aggregate quantity_sold DESC. The
// kitchen team works the list top-down so the highest-velocity gaps
// are filled first, driving the unresolved-dish count toward zero.
//
// Pretty table is always printed; --csv-out additionally writes a
// fill-me CSV that round-trips through scripts/import-dish-components.mjs
// once the operator fills in component_type / qty_per_serving / unit.
//
// Usage:
//   node --experimental-strip-types scripts/dish-components-coverage.mjs [flags]
//
//   --location=<id>     Default 'default'.
//   --top=<n>           Limit output rows (default 50). Aggregate totals
//                       still cover the full gap.
//   --csv-out=<path>    Write a fill-me CSV ready for re-import. Header
//                       columns match scripts/import-dish-components.mjs
//                       REQUIRED_COLUMNS exactly.
//   -h, --help          Show this help.

import fs from 'node:fs';
import path from 'node:path';

// Header columns — MUST match REQUIRED_COLUMNS in
// scripts/import-dish-components.mjs so the round-trip works.
export const COVERAGE_CSV_HEADER = [
  'dish_name',
  'component_type',
  'recipe_slug',
  'vendor_ingredient',
  'qty_per_serving',
  'unit',
  'notes',
];

// ── Pure-SQL gap query ──────────────────────────────────────────────
// One LEFT JOIN against dish_components, NULL on the right side =
// gap. Match on LOWER(TRIM(...)) because operator-entered dish names
// have casing/whitespace drift versus the Toast import casing.
const GAP_SQL = `
  SELECT
    sl.item_name AS dish_name,
    SUM(sl.quantity_sold) AS qty_sold,
    SUM(sl.net_sales) AS net_sales,
    COUNT(DISTINCT sl.period_label) AS periods
  FROM sales_lines sl
  LEFT JOIN dish_components dc
    ON dc.location_id = sl.location_id
   AND LOWER(TRIM(dc.dish_name)) = LOWER(TRIM(sl.item_name))
  WHERE sl.location_id = ?
    AND sl.item_name IS NOT NULL
    AND TRIM(sl.item_name) != ''
    AND dc.id IS NULL
  GROUP BY LOWER(TRIM(sl.item_name)), sl.item_name
  ORDER BY qty_sold DESC, sl.item_name ASC
`;

// Total qty across every sales row in the location (denominator for
// gap_pct). Same trim/exclusion rules as the gap query so the ratio
// is internally consistent.
const TOTAL_SQL = `
  SELECT
    COALESCE(SUM(quantity_sold), 0) AS total_qty
  FROM sales_lines
  WHERE location_id = ?
    AND item_name IS NOT NULL
    AND TRIM(item_name) != ''
`;

/**
 * Build the dish-components coverage gap report.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ location?: string, top?: number }} [opts]
 * @returns {{
 *   rows: Array<{ rank: number, dish_name: string, qty_sold: number,
 *                 net_sales: number, periods: number }>,
 *   total_dishes_in_gap: number,
 *   total_gap_qty: number,
 *   total_qty: number,
 *   gap_pct: number,
 * }}
 */
export function buildCoverageReport(db, opts = {}) {
  const location = opts.location ?? 'default';
  const top =
    opts.top != null && Number.isFinite(opts.top) && opts.top > 0
      ? Math.floor(opts.top)
      : null;

  const rawRows = db.prepare(GAP_SQL).all(location);
  // Aggregate totals always reflect the FULL gap, not the top-N slice.
  const total_dishes_in_gap = rawRows.length;
  const total_gap_qty = rawRows.reduce(
    (acc, r) => acc + (Number(r.qty_sold) || 0),
    0,
  );
  const { total_qty: totalQtyRaw } = db.prepare(TOTAL_SQL).get(location);
  const total_qty = Number(totalQtyRaw) || 0;
  const gap_pct =
    total_qty > 0
      ? Math.round((total_gap_qty / total_qty) * 1000) / 10
      : 0;

  const sliced = top != null ? rawRows.slice(0, top) : rawRows;
  const rows = sliced.map((r, i) => ({
    rank: i + 1,
    dish_name: String(r.dish_name),
    qty_sold: Number(r.qty_sold) || 0,
    net_sales: Number(r.net_sales) || 0,
    periods: Number(r.periods) || 0,
  }));

  return {
    rows,
    total_dishes_in_gap,
    total_gap_qty,
    total_qty,
    gap_pct,
  };
}

// ── CSV writer ──────────────────────────────────────────────────────
// RFC-4180-compatible: quote any field with comma, quote, CR, or LF;
// double embedded quotes. UTF-8 + LF (NOT CRLF).
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Write a fill-me CSV — one row per gap dish, only dish_name pre-filled.
 * The header matches scripts/import-dish-components.mjs REQUIRED_COLUMNS
 * so the operator can round-trip the file through the importer once
 * they've filled in component_type / qty_per_serving / unit.
 *
 * @param {Array<{ dish_name: string }>} rows
 * @param {string} outPath
 */
export function writeCoverageCsv(rows, outPath) {
  const lines = [COVERAGE_CSV_HEADER.join(',')];
  for (const r of rows) {
    // Six trailing empty cells — only dish_name is pre-populated.
    lines.push(
      [
        csvField(r.dish_name),
        '', // component_type
        '', // recipe_slug
        '', // vendor_ingredient
        '', // qty_per_serving
        '', // unit
        '', // notes
      ].join(','),
    );
  }
  const csv = lines.join('\n') + '\n';
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, csv, 'utf8');
}

// ── Pretty printer ──────────────────────────────────────────────────
// Plain-text table with column widths sized to the data so long dish
// names don't break alignment. Matches the spec's column order:
//   rank, qty_sold, net_sales, periods, dish_name.
function formatTable(report, location) {
  const out = [];
  out.push(`dish-components coverage gap (location=${location})`);
  out.push('');

  if (report.rows.length === 0) {
    out.push('  (no gap — every sales dish has a dish_components row)');
    out.push('');
    out.push(
      `  TOTAL: 0 dishes missing dish_components, accounting for ` +
        `${report.gap_pct.toFixed(1)}% of recent sales velocity.`,
    );
    return out.join('\n') + '\n';
  }

  // Compute column widths from the actual rows — keeps long dish names
  // from breaking alignment without ANSI / locale formatting tricks.
  const headers = {
    rank: 'rank',
    qty: 'qty_sold',
    net: 'net_sales',
    per: 'periods',
    dish: 'dish_name',
  };
  let wRank = headers.rank.length;
  let wQty = headers.qty.length;
  let wNet = headers.net.length;
  let wPer = headers.per.length;
  let wDish = headers.dish.length;
  const cells = report.rows.map((r) => {
    const c = {
      rank: String(r.rank),
      qty: formatQty(r.qty_sold),
      net: r.net_sales.toFixed(2),
      per: String(r.periods),
      dish: r.dish_name,
    };
    if (c.rank.length > wRank) wRank = c.rank.length;
    if (c.qty.length > wQty) wQty = c.qty.length;
    if (c.net.length > wNet) wNet = c.net.length;
    if (c.per.length > wPer) wPer = c.per.length;
    if (c.dish.length > wDish) wDish = c.dish.length;
    return c;
  });

  const head =
    '  ' +
    [
      headers.rank.padStart(wRank),
      headers.qty.padStart(wQty),
      headers.net.padStart(wNet),
      headers.per.padStart(wPer),
      headers.dish.padEnd(wDish),
    ].join('  ');
  const sep =
    '  ' +
    [
      '-'.repeat(wRank),
      '-'.repeat(wQty),
      '-'.repeat(wNet),
      '-'.repeat(wPer),
      '-'.repeat(wDish),
    ].join('  ');
  out.push(head);
  out.push(sep);

  for (const c of cells) {
    out.push(
      '  ' +
        [
          c.rank.padStart(wRank),
          c.qty.padStart(wQty),
          c.net.padStart(wNet),
          c.per.padStart(wPer),
          c.dish.padEnd(wDish),
        ].join('  '),
    );
  }
  out.push('');
  out.push(
    `  TOTAL: ${report.total_dishes_in_gap} ` +
      `dish${report.total_dishes_in_gap === 1 ? '' : 'es'} missing ` +
      `dish_components, accounting for ${report.gap_pct.toFixed(1)}% ` +
      `of recent sales velocity.`,
  );
  return out.join('\n') + '\n';
}

// Show whole numbers as integers, fractional as 2-decimal — keeps the
// column tight when every sale is a whole-unit count.
function formatQty(n) {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

// ── CLI driver ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    location: 'default',
    top: 50,
    csvOut: null,
    help: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--location=')) args.location = a.slice('--location='.length);
    else if (a.startsWith('--top=')) {
      const n = parseInt(a.slice('--top='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`error: --top must be a positive integer, got "${a}"\n`);
        process.exit(2);
      }
      args.top = n;
    } else if (a.startsWith('--csv-out=')) {
      args.csvOut = a.slice('--csv-out='.length);
    } else {
      process.stderr.write(`unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`dish-components-coverage — gap report for sales→depletion

Usage:
  node --experimental-strip-types scripts/dish-components-coverage.mjs [flags]

Flags:
  --location=<id>     Default 'default'.
  --top=<n>           Limit output to top-N rows (default 50). Aggregate
                      totals still reflect the full gap.
  --csv-out=<path>    Write a fill-me CSV ready for the kitchen team to
                      populate and re-import via
                      scripts/import-dish-components.mjs. Only dish_name
                      is pre-populated; other columns are blank.
  -h, --help          Show this help.

Read-only — never mutates the database.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  // Late import so --help works without opening the DB.
  const { getDb } = await import('../lib/db.ts');
  const db = getDb();

  const report = buildCoverageReport(db, {
    location: args.location,
    top: args.top,
  });

  process.stdout.write(formatTable(report, args.location));

  if (args.csvOut) {
    writeCoverageCsv(report.rows, args.csvOut);
    process.stderr.write(
      `dish-components-coverage: wrote ${report.rows.length} ` +
        `row${report.rows.length === 1 ? '' : 's'} → ${args.csvOut}\n`,
    );
  }
}

// Run main() only when invoked as a CLI, not when imported from tests.
// import.meta.url vs argv[1]: matches how Node distinguishes the two.
const isMain = (() => {
  try {
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const here = new URL(import.meta.url).pathname;
    return invoked === here;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
