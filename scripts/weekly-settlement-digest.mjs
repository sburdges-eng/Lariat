#!/usr/bin/env node
// scripts/weekly-settlement-digest.mjs
//
// Renders a "weekly settlement digest" — one HTML document with one
// section per show that played in the named week. The operator opens
// the file in a browser and uses Save-as-PDF for distribution. Same
// local-first stance as the on-demand /settlement/pdf route: no
// headless-browser dep, no PDF library.
//
// Default week: the Mon→Sun window that ended before today. Override
// with --week-of=YYYY-MM-DD (any date inside the target week).
//
// Usage:
//   node --experimental-strip-types scripts/weekly-settlement-digest.mjs
//   node --experimental-strip-types scripts/weekly-settlement-digest.mjs --week-of=2026-05-04
//   node --experimental-strip-types scripts/weekly-settlement-digest.mjs --location=lariat-south
//   node --experimental-strip-types scripts/weekly-settlement-digest.mjs --out=$TMPDIR/digest.html
//
// Cron-friendly: exits 0 on success (even when 0 shows in the week —
// it still writes an empty-state digest so the operator sees the
// "no shows this week" confirmation). Non-zero on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    location: 'default',
    weekOf: null,
    out: null,
    help: false,
  };
  for (const a of argv) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--location=')) args.location = a.slice(11);
    else if (a.startsWith('--week-of=')) args.weekOf = a.slice(10);
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

const HELP = `weekly-settlement-digest — render past-week settlements to one HTML doc.

  --location=<id>          Default 'default'.
  --week-of=YYYY-MM-DD     Any date inside the target Mon→Sun week.
                           Default: the week that ended before today.
  --out=<path>             Output path. Default:
                           data/exports/YYYY-Www_settlement.html
  -h, --help               Show this help.
`;

// Returns { start, end, label } for the Mon→Sun week containing `anchor`.
// `anchor` is a Date object. start/end are ISO date strings (YYYY-MM-DD),
// label is "YYYY-Www" using ISO 8601 week numbering.
export function weekRange(anchor) {
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  // ISO weeks start on Monday. d.getUTCDay() returns 0 (Sun) .. 6 (Sat).
  // Convert to Mon=0..Sun=6.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  const monday = new Date(d);
  const sunday = new Date(d);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  // ISO week number: Thursday of this week → year + week.
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
    label: `${year}-W${String(week).padStart(2, '0')}`,
  };
}

function defaultAnchor() {
  // The Mon→Sun week that ended BEFORE today. Subtract 7 days so the
  // current week (in progress) doesn't dominate.
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 7);
  return now;
}

async function defaultOutPath(label) {
  // Lazy import keeps lib/dataDir.ts (a .ts module) off the script's
  // synchronous top-level import path. Node strips types for these
  // dynamic imports via --experimental-strip-types when the script
  // runs.
  const { resolveDataDir } = await import('../lib/dataDir.ts');
  return path.join(resolveDataDir(), 'exports', `${label}_settlement.html`);
}

export async function runDigest(args, deps) {
  const { getDb, getSettlement, renderDigestHtml } = deps;

  const anchor = args.weekOf ? new Date(`${args.weekOf}T00:00:00Z`) : defaultAnchor();
  if (Number.isNaN(anchor.getTime())) {
    throw new Error(`bad --week-of date: ${args.weekOf}`);
  }
  const range = weekRange(anchor);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM shows
       WHERE location_id = ?
         AND show_date BETWEEN ? AND ?
       ORDER BY show_date ASC, id ASC`,
    )
    .all(args.location, range.start, range.end);

  const summaries = rows.map((r) => getSettlement(r.id, args.location));
  const html = renderDigestHtml(summaries, {
    weekOf: range.label,
    locationId: args.location,
    // Cron-produced files shouldn't pop a print dialog on open — only
    // the operator's interactive download (the on-demand /pdf route) does.
    noAutoPrint: true,
  });

  const outPath = args.out || (await defaultOutPath(range.label));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return { outPath, range, count: summaries.length };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    console.error(HELP);
    process.exit(64);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { getDb } = await import('../lib/db.ts');
  const { getSettlement } = await import('../lib/settlementRepo.ts');
  const { renderDigestHtml } = await import('../lib/settlementPrint.ts');

  const { outPath, range, count } = await runDigest(args, {
    getDb,
    getSettlement,
    renderDigestHtml,
  });

  console.log(
    `weekly-settlement-digest: ${range.label} (${range.start}..${range.end}) — ${count} show(s) → ${outPath}`,
  );
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('weekly-settlement-digest failed:', err);
    process.exit(1);
  });
}
