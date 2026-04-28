#!/usr/bin/env node
// scripts/toast-weekly-pull.mjs
//
// Pull the last 7 days of sales (orders) and labor (timeEntries) from
// the Toast API and dump the raw paginated responses to JSON under
// data/toast-api/snapshots/<YYYY-MM-DD>/{orders,time_entries}.jsonl
//
// This is the "raw fetch" half of weekly automation — it does NOT touch
// the SQLite DB. Aggregation into the existing toast_sales_* tables is
// a separate follow-up commit once the team has eyeballed the JSON
// shape against real production data.
//
// Idempotent: re-running the same week just overwrites the snapshot
// directory atomically (write to .tmp/, rename on success).
//
// CLI:
//   node scripts/toast-weekly-pull.mjs                  # last 7 days
//   node scripts/toast-weekly-pull.mjs --days 14        # custom window
//   node scripts/toast-weekly-pull.mjs --start 2026-04-15 --end 2026-04-22
//   node scripts/toast-weekly-pull.mjs --dry-run        # auth + window only
//
// Requires .env.local with:
//   TOAST_API_HOST           ws-api.toasttab.com (production)
//                            ws-api.eng.toasttab.com (sandbox)
//   TOAST_CLIENT_ID          from Toast integrations team (or self-serve)
//   TOAST_CLIENT_SECRET      ditto — keep secret
//   TOAST_RESTAURANT_GUID    from Toast Web (Restaurants → Restaurant info)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAccessToken } from './toast_api/auth.mjs';
import { paginatedFetch, toIsoZ, utcMidnightDaysAgo } from './toast_api/client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'data', 'toast-api', 'snapshots');

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { days: 7, start: null, end: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--start') out.start = argv[++i];
    else if (a === '--end') out.end = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/toast-weekly-pull.mjs [--days N | --start YYYY-MM-DD --end YYYY-MM-DD] [--dry-run]'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function resolveWindow({ days, start, end }) {
  if (start && end) {
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      throw new Error('--start and --end must be YYYY-MM-DD');
    }
    if (e <= s) throw new Error('--end must be after --start');
    return { start: s, end: e };
  }
  if (start || end) {
    throw new Error('--start and --end must be provided together');
  }
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    throw new Error('--days must be an integer between 1 and 90');
  }
  // End = today's UTC midnight (exclusive). Start = N days before.
  const now = new Date();
  const e = utcMidnightDaysAgo(now, 0);
  const s = utcMidnightDaysAgo(now, days);
  return { start: s, end: e };
}

// ── Fetch loops ──────────────────────────────────────────────────────

async function dumpEndpoint({ label, pathPrefix, query, outFile }) {
  // Stream pages straight to a JSONL file so we never hold the full
  // response in RAM. One JSON object per line; a multi-day pull of a
  // busy restaurant can be 50k+ orders, easily a few hundred MB.
  const fh = fs.openSync(outFile, 'w');
  let pageCount = 0;
  let itemCount = 0;
  try {
    for await (const { page, items } of paginatedFetch(pathPrefix, { query })) {
      for (const item of items) {
        fs.writeSync(fh, JSON.stringify(item) + '\n');
      }
      pageCount = page;
      itemCount += items.length;
      process.stderr.write(
        `  ${label}: page ${page} → ${items.length} items (running total ${itemCount})\n`
      );
    }
  } finally {
    fs.closeSync(fh);
  }
  return { pageCount, itemCount };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const window = resolveWindow(args);

  const startIso = toIsoZ(window.start);
  const endIso = toIsoZ(window.end);
  const labelDate = window.end.toISOString().slice(0, 10);

  console.log(`Toast weekly pull`);
  console.log(`  window: ${startIso} → ${endIso}`);
  console.log(`  output: data/toast-api/snapshots/${labelDate}/`);

  // Auth probe (also warms the token cache for the fetch loops below).
  const tok = await getAccessToken();
  const ttl = tok.expiresAt - Math.floor(Date.now() / 1000);
  console.log(`  token: cached, ${ttl}s until expiry`);

  if (args.dryRun) {
    console.log('  --dry-run: skipping fetches');
    return;
  }

  // Stage all writes inside <snapshot>.tmp/, then rename so a failed run
  // doesn't leave a half-populated snapshot directory.
  const finalDir = path.join(SNAPSHOTS_DIR, labelDate);
  const tmpDir = `${finalDir}.tmp`;
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // ── Sales: /orders/v2/ordersBulk ───────────────────────────────────
  // Returns one record per Toast order (with check / payment children).
  // `startDate` and `endDate` are inclusive on `paidBusinessDate`.
  const ordersStats = await dumpEndpoint({
    label: 'orders',
    pathPrefix: '/orders/v2/ordersBulk',
    query: { startDate: startIso, endDate: endIso },
    outFile: path.join(tmpDir, 'orders.jsonl'),
  });

  // ── Labor: /labor/v1/timeEntries ───────────────────────────────────
  // Returns one record per clock-in/out punch in the window.
  const timeStats = await dumpEndpoint({
    label: 'time_entries',
    pathPrefix: '/labor/v1/timeEntries',
    query: { startDate: startIso, endDate: endIso },
    outFile: path.join(tmpDir, 'time_entries.jsonl'),
  });

  // Manifest for downstream ingest. Keeps the window + counts + sha
  // attestation co-located with the raw JSONL.
  const manifest = {
    generated_at: new Date().toISOString(),
    window: { start: startIso, end: endIso },
    pulls: {
      orders: { ...ordersStats, file: 'orders.jsonl' },
      time_entries: { ...timeStats, file: 'time_entries.jsonl' },
    },
  };
  fs.writeFileSync(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // Atomic rename of the staged dir.
  if (fs.existsSync(finalDir)) {
    fs.rmSync(finalDir, { recursive: true, force: true });
  }
  fs.renameSync(tmpDir, finalDir);

  console.log(
    `  done → ${finalDir} (orders: ${ordersStats.itemCount}, time_entries: ${timeStats.itemCount})`
  );
}

main().catch((err) => {
  // The error message may include a short response excerpt; we never
  // surface the client secret because auth.mjs masks it before throwing.
  console.error(`✗ Toast weekly pull failed: ${err?.message ?? err}`);
  process.exit(1);
});
