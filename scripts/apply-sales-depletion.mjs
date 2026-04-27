#!/usr/bin/env node
// scripts/apply-sales-depletion.mjs
//
// Phase-3 CLI: walk sales_lines and write inventory_updates rows that
// debit BOM-equivalent ingredients per Toast sale. Default is dry-run;
// pass --apply to commit. Idempotent: a (location, period) that's
// already in sales_depletion_runs is skipped unless --force is given.
//
// Usage:
//   # dry-run a single period
//   node --experimental-strip-types scripts/apply-sales-depletion.mjs \
//        --period="Toast - Item Sales (Mar 2026)"
//
//   # commit it
//   node --experimental-strip-types scripts/apply-sales-depletion.mjs \
//        --period="Toast - Item Sales (Mar 2026)" --apply
//
//   # process every period present in sales_lines (idempotent — already-
//   # applied periods are skipped)
//   node --experimental-strip-types scripts/apply-sales-depletion.mjs --all --apply
//
// Reports:
//   - sales rows processed
//   - depletions written
//   - unresolved dish count + a sample list (these need a dish_components
//     row added before they can deplete)

function parseArgs(argv) {
  const args = {
    period: null,
    location: 'default',
    apply: false,
    all: false,
    force: false,
    shiftDate: null,
    sample: 25,
  };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--all') args.all = true;
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--period=')) args.period = a.slice('--period='.length);
    else if (a.startsWith('--location=')) args.location = a.slice('--location='.length);
    else if (a.startsWith('--shift-date=')) args.shiftDate = a.slice('--shift-date='.length);
    else if (a.startsWith('--sample=')) {
      const n = parseInt(a.slice('--sample='.length), 10);
      if (Number.isFinite(n) && n >= 0) args.sample = n;
    } else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`apply-sales-depletion — Phase-3 sales-driven depletion

Usage:
  node --experimental-strip-types scripts/apply-sales-depletion.mjs [flags]

Flags:
  --period=<label>     Single period_label (sales_lines.period_label).
  --all                Process every distinct period in sales_lines.
  --location=<id>      Default 'default'.
  --apply              Write to DB (default: dry-run).
  --force              Re-run even if (location, period) already in
                       sales_depletion_runs. Does NOT delete prior rows.
  --shift-date=<date>  Stamp inventory_updates.shift_date. Default: today.
  --sample=<n>         Cap unresolved-dish sample size (default 25).
  -h, --help           Show this help.

Resolution chain:
  sales_lines.item_name → dish_components → (vendor_item | recipe → bom_lines)
  Recipe yields read from entities_recipes (Phase-2 backfill required).
  Shrinkage applied per bom_lines.loss_factor.
`);
}

function todayIsoUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.all && !args.period) {
    console.error('error: pass --period=<label> or --all.');
    process.exit(2);
  }

  const { getDb } = await import('../lib/db.ts');
  const { applyDepletionsForPeriod } = await import('../lib/salesDepletion.ts');
  const db = getDb();

  const shiftDate = args.shiftDate || todayIsoUtc();

  let periods;
  if (args.all) {
    periods = db
      .prepare(
        `SELECT DISTINCT period_label FROM sales_lines
          WHERE location_id = ?
            AND period_label IS NOT NULL AND TRIM(period_label) != ''
          ORDER BY period_label`,
      )
      .all(args.location)
      .map((r) => r.period_label);
  } else {
    periods = [args.period];
  }

  if (periods.length === 0) {
    console.log(
      `no sales_lines rows for location='${args.location}'. nothing to do.`,
    );
    return;
  }

  console.log(`apply-sales-depletion (${args.apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`  location=${args.location}`);
  console.log(`  shift_date=${shiftDate}`);
  console.log(`  periods=${periods.length}`);
  console.log('');

  let totalSales = 0;
  let totalWritten = 0;
  let totalUnresolved = 0;
  let skippedAlready = 0;
  const sampleAcc = new Map();

  for (const period of periods) {
    const r = applyDepletionsForPeriod(db, {
      location_id: args.location,
      period_label: period,
      shift_date: shiftDate,
      apply: args.apply,
      force: args.force,
      unresolvedSample: args.sample,
    });
    const tag = r.applied
      ? `run=${r.run_id}`
      : r.skip_reason === 'already_applied'
        ? `skip (already-applied run=${r.run_id})`
        : 'dry';
    console.log(
      `  ${period} … sales=${r.sales_rows_processed} ` +
        `writes=${r.depletions_written} unresolved=${r.unresolved_count} [${tag}]`,
    );
    totalSales += r.sales_rows_processed;
    totalWritten += r.depletions_written;
    totalUnresolved += r.unresolved_count;
    if (!r.applied && r.skip_reason === 'already_applied') skippedAlready++;
    for (const u of r.unresolved_sample) {
      // Aggregate the sample so the operator sees per-dish reasons across
      // periods, not a wall of duplicate "Burger has no dish_components"
      // lines per month.
      const key = `${u.dish_name}\n${u.reason}`;
      sampleAcc.set(key, (sampleAcc.get(key) ?? 0) + 1);
    }
  }

  console.log('');
  console.log(
    `TOTAL  sales=${totalSales}  writes=${totalWritten}  ` +
      `unresolved=${totalUnresolved}  already-applied=${skippedAlready}`,
  );

  if (sampleAcc.size > 0) {
    console.log('');
    console.log(`unresolved dishes (top ${Math.min(args.sample, sampleAcc.size)}):`);
    const items = [...sampleAcc.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.sample);
    for (const [k, n] of items) {
      const [dish, reason] = k.split('\n');
      console.log(`  ${String(n).padStart(4)}× ${reason.padEnd(28)} ${dish}`);
    }
    console.log('');
    console.log('Add a dish_components row at /menu-engineering/components to resolve.');
  }

  if (!args.apply) {
    console.log('');
    console.log('(dry-run: no writes. Re-run with --apply to commit.)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
