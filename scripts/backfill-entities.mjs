#!/usr/bin/env node
// scripts/backfill-entities.mjs
//
// Orchestrate Phase-2 backfill of the canonical entity layer from
// existing live-DB tables. Walks each backfill module in sequence
// (employees → vendors → menu_items → recipes → ingredients) and
// prints a tally per module.
//
// Usage:
//   node --experimental-strip-types scripts/backfill-entities.mjs           # dry-run
//   node --experimental-strip-types scripts/backfill-entities.mjs --apply   # write
//   node --experimental-strip-types scripts/backfill-entities.mjs --apply --only=vendors,menu_items
//
// Default is dry-run so an accidental invocation is harmless. Re-running
// with --apply is idempotent (the resolvers dedupe via external_ids).

import { backfillEmployees } from './backfill/employees.mjs';
import { backfillVendors } from './backfill/vendors.mjs';
import { backfillMenuItems } from './backfill/menu_items.mjs';
import { backfillRecipes } from './backfill/recipes.mjs';
import { backfillIngredients } from './backfill/ingredients.mjs';

const MODULES = {
  employees: backfillEmployees,
  vendors: backfillVendors,
  menu_items: backfillMenuItems,
  recipes: backfillRecipes,
  ingredients: backfillIngredients,
};

function parseArgs(argv) {
  const args = { apply: false, only: null };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--only=')) {
      args.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`backfill-entities — populate the canonical entity layer

Usage:
  node --experimental-strip-types scripts/backfill-entities.mjs [flags]

Flags:
  --apply            Write to DB (default: dry-run, no writes).
  --only=<csv>       Comma-separated module names. Default: all.
                     Modules: ${Object.keys(MODULES).join(', ')}
  -h, --help         Show this help.

Notes:
  - Idempotent: re-running with --apply is safe — entries dedupe via the
    external_ids unique key. Re-runs only bump last_seen_at.
  - To reverse: DELETE FROM external_ids; DELETE FROM entities_*; rerun.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  // Late import so --help doesn't open the DB or run schema migrations.
  const { getDb } = await import('../lib/db.ts');
  const db = getDb();

  const order = ['employees', 'vendors', 'menu_items', 'recipes', 'ingredients'];
  const selected = args.only ?? order;
  const unknown = selected.filter((m) => !MODULES[m]);
  if (unknown.length) {
    console.error(`unknown modules: ${unknown.join(', ')}`);
    console.error(`known: ${Object.keys(MODULES).join(', ')}`);
    process.exit(2);
  }

  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`backfill-entities (${mode})`);

  let totalCreated = 0;
  let totalReused = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const m of selected) {
    const fn = MODULES[m];
    process.stdout.write(`  ${m.padEnd(12)} … `);
    const t = fn(db, { apply: args.apply });
    console.log(
      `created=${t.created}  reused=${t.reused}  skipped=${t.skipped}  errors=${t.errors}`,
    );
    totalCreated += t.created;
    totalReused += t.reused;
    totalSkipped += t.skipped;
    totalErrors += t.errors;
  }

  console.log('');
  console.log(
    `TOTAL  created=${totalCreated}  reused=${totalReused}  skipped=${totalSkipped}  errors=${totalErrors}`,
  );
  if (!args.apply) {
    console.log('');
    console.log('(dry-run: no writes. Re-run with --apply to commit.)');
  }
  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
