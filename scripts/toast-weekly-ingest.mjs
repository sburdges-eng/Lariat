#!/usr/bin/env node
// scripts/toast-weekly-ingest.mjs
//
// Watcher / orchestrator for the manual-drop Toast weekly workflow.
//
// Source-of-truth: drop Toast Web exports into
//   data/imports/toast-weekly/
// then invoke this script (manually or via launchd / cron). It scans
// the drop folder, classifies each file via toast_weekly/router.mjs,
// and routes it to the right existing ingest script:
//
//   sales-by-{date,day,time}-*.csv  → scripts/ingest-toast-timeseries.mjs
//                                     (one invocation, --dir = drop folder;
//                                      the existing script picks the newest
//                                      of each prefix)
//   SalesSummary_*.zip              → scripts/ingest_toast_sales_summary.py
//                                     (one invocation per zip, --zip = file)
//   LaborBreakDown_*.zip            → scripts/ingest_toast_labor.py
//                                     (one invocation per zip)
//
// On success, processed files move to
//   data/imports/toast-weekly/_archived/<YYYY-MM-DDTHH-MM-SSZ>/
// alongside a manifest.json that lists what was ingested + the exit
// status of each subprocess.
//
// Idempotency: every existing ingest script is full-refresh per
// (location, period). Re-running with the same files is safe.
//
// On any subprocess failure, the orchestrator exits non-zero and
// LEAVES THE DROP FOLDER UNCHANGED so the next run picks up the same
// files. This avoids partial-archive corruption.
//
// CLI:
//   node scripts/toast-weekly-ingest.mjs                  # default folder
//   node scripts/toast-weekly-ingest.mjs --dir <path>     # alternate drop
//   node scripts/toast-weekly-ingest.mjs --location <id>  # location_id
//   node scripts/toast-weekly-ingest.mjs --dry-run        # plan, don't run

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { group } from './toast_weekly/router.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DROP = path.join(REPO_ROOT, 'data', 'imports', 'toast-weekly');

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dir: DEFAULT_DROP, location: 'default', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--dir') out.dir = path.resolve(REPO_ROOT, argv[++i]);
    else if (a === '--location') out.location = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/toast-weekly-ingest.mjs [--dir <path>] [--location <id>] [--dry-run]'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// ── File discovery ───────────────────────────────────────────────────

function listDropFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

// ── Subprocess runners ──────────────────────────────────────────────

function runStep({ label, cmd, args, cwd = REPO_ROOT }) {
  console.log(`  → ${label}: ${cmd} ${args.join(' ')}`);
  const t0 = Date.now();
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  const elapsed = Date.now() - t0;
  if (res.error) {
    return { ok: false, label, exitCode: null, error: res.error.message, elapsed };
  }
  return {
    ok: res.status === 0,
    label,
    exitCode: res.status,
    elapsed,
  };
}

// ── Archive ──────────────────────────────────────────────────────────

function archiveOnSuccess({ dir, processed, manifest }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(dir, '_archived', stamp);
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const name of processed) {
    fs.renameSync(path.join(dir, name), path.join(archiveDir, name));
  }
  fs.writeFileSync(
    path.join(archiveDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  return archiveDir;
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Toast weekly ingest`);
  console.log(`  drop folder: ${args.dir}`);
  console.log(`  location_id: ${args.location}`);

  if (!fs.existsSync(args.dir)) {
    console.log(`  drop folder does not exist; nothing to ingest. Create it`);
    console.log(`  with: mkdir -p ${path.relative(REPO_ROOT, args.dir)}`);
    return 0;
  }

  const files = listDropFiles(args.dir);
  if (files.length === 0) {
    console.log(`  drop folder is empty; nothing to ingest`);
    return 0;
  }
  console.log(`  found: ${files.length} file(s)`);

  const groups = group(files);
  console.log(`  routing:`);
  console.log(`    timeseries CSVs:    ${groups.timeseries.length}`);
  console.log(`    SalesSummary zips:  ${groups.salesSummaryZips.length}`);
  console.log(`    LaborBreakDown zips:${groups.laborZips.length}`);
  if (groups.unknown.length) {
    console.log(`    unknown (skipped):  ${groups.unknown.length}`);
    for (const u of groups.unknown) console.log(`      ${u}`);
  }

  if (args.dryRun) {
    console.log(`  --dry-run: skipping ingest`);
    return 0;
  }

  const steps = [];
  const processed = [];

  // Timeseries: one invocation, the existing script reads the whole dir
  // and picks the newest of each prefix. We pass the drop folder as
  // --dir so the script doesn't need to know about toast-weekly/.
  if (groups.timeseries.length > 0) {
    const r = runStep({
      label: `timeseries (${groups.timeseries.length} CSV)`,
      cmd: 'node',
      args: [
        '--experimental-strip-types',
        path.join(REPO_ROOT, 'scripts', 'ingest-toast-timeseries.mjs'),
        '--dir',
        args.dir,
        '--location',
        args.location,
      ],
    });
    steps.push(r);
    if (r.ok) processed.push(...groups.timeseries);
  }

  // SalesSummary: one invocation per zip (each zip is its own period).
  for (const zip of groups.salesSummaryZips) {
    const r = runStep({
      label: `sales summary (${zip})`,
      cmd: 'python3',
      args: [
        path.join(REPO_ROOT, 'scripts', 'ingest_toast_sales_summary.py'),
        '--zip',
        path.join(args.dir, zip),
      ],
    });
    steps.push(r);
    if (r.ok) processed.push(zip);
  }

  // LaborBreakDown: ditto.
  for (const zip of groups.laborZips) {
    const r = runStep({
      label: `labor (${zip})`,
      cmd: 'python3',
      args: [
        path.join(REPO_ROOT, 'scripts', 'ingest_toast_labor.py'),
        '--zip',
        path.join(args.dir, zip),
        '--location',
        args.location,
      ],
    });
    steps.push(r);
    if (r.ok) processed.push(zip);
  }

  const allOk = steps.every((s) => s.ok);
  const manifest = {
    started_at: new Date().toISOString(),
    location_id: args.location,
    drop_folder: path.relative(REPO_ROOT, args.dir),
    file_counts: {
      timeseries: groups.timeseries.length,
      sales_summary_zips: groups.salesSummaryZips.length,
      labor_zips: groups.laborZips.length,
      unknown: groups.unknown.length,
    },
    steps,
    processed_files: processed,
    unknown_files: groups.unknown,
    all_ok: allOk,
  };

  if (!allOk) {
    console.error(`\n✗ one or more ingest steps failed; leaving drop folder untouched.`);
    console.error(`  manifest:\n${JSON.stringify(manifest, null, 2)}`);
    process.exitCode = 1;
    return 1;
  }

  // Archive only the files we successfully ingested. Unknown files
  // stay in the drop folder so a human can deal with them.
  if (processed.length > 0) {
    const archiveDir = archiveOnSuccess({
      dir: args.dir,
      processed,
      manifest,
    });
    console.log(`\n✓ ingested ${processed.length} file(s) → archived to ${path.relative(REPO_ROOT, archiveDir)}`);
  } else {
    console.log(`\n  no recognized files; nothing archived`);
  }
  return 0;
}

const code = main();
process.exit(code ?? 0);
