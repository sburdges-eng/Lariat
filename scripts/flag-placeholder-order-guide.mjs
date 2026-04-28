#!/usr/bin/env node
/**
 * Flag recipe-derived placeholder rows in order_guide_items.
 *
 * Background: a handful of alcohol rows (dry white wine, rye whiskey,
 * stout beer, vodka) got written into order_guide_items with unit_price
 * values that are recipe-derived per-unit-cost placeholders
 * (~$0.0001–0.0005), NOT real vendor costs. When drink dishes fall
 * through from vendor_prices into the order_guide fallback (lib/
 * dishCostBridge.ts), those placeholders silently corrupt the
 * per-serving cost.
 *
 * The dishCostBridge fallback query now filters
 * COALESCE(is_placeholder, 0) = 0 (PR {this one}). This script stamps
 * is_placeholder=1 on the four known-bad rows so the filter takes
 * effect.
 *
 * Usage:
 *   # Dry run (default): prints what would change, writes nothing.
 *   node scripts/flag-placeholder-order-guide.mjs
 *
 *   # Apply: actually UPDATE the rows.
 *   node scripts/flag-placeholder-order-guide.mjs --apply
 *
 *   # Custom DB path (defaults to data/lariat.db under repo root):
 *   LARIAT_DB=/tmp/lariat.db node scripts/flag-placeholder-order-guide.mjs --apply
 *
 * Idempotent: re-running against an already-flagged DB is a no-op.
 *
 * The expected list of placeholders below is intentionally explicit
 * (not a pattern match on "unit_price < 0.01") because the wider
 * order_guide_items table holds many legitimate low-unit-price rows
 * (e.g. spices priced per gram). Touching only these four keeps the
 * blast radius surgical. If the drink menu grows, extend the list or
 * re-run this with edits.
 */
import path from 'path';
import Database from 'better-sqlite3';
import { initSchema } from '../lib/db.ts';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LOCATION = (args.find((a) => a.startsWith('--location=')) || '--location=default').slice('--location='.length);
const DB_PATH = process.env.LARIAT_DB || path.join(process.cwd(), 'data', 'lariat.db');

const PLACEHOLDERS = [
  'dry white wine',
  'rye whiskey',
  'stout beer',
  'vodka',
];

// Dry-run opens readonly so it never touches the live DB; --apply opens
// read-write and runs initSchema first so the idempotent ADD COLUMN
// migration lands before the UPDATE.
const db = new Database(DB_PATH, { readonly: !APPLY });
if (APPLY) {
  initSchema(db); // idempotent; adds is_placeholder if this DB predates it
}

// Close the DB on the way out so WAL/SHM files are flushed before the
// process exits. CodeRabbit nit from PR #30 review.
function exit(code) {
  try { db.close(); } catch { /* best-effort */ }
  process.exit(code);
}

console.log(`[flag-placeholder-order-guide] db=${DB_PATH} location=${LOCATION} apply=${APPLY}`);

const cols = db.prepare(`PRAGMA table_info(order_guide_items)`).all();
if (!cols.some((c) => c.name === 'is_placeholder')) {
  if (APPLY) {
    // Should be unreachable: initSchema ran above.
    console.error(`[flag-placeholder-order-guide] initSchema did not add is_placeholder; aborting.`);
    exit(2);
  }
  console.warn(
    `[flag-placeholder-order-guide] order_guide_items.is_placeholder not present on this DB.\n` +
    `  Dry-run cannot preview the UPDATE because the column is unreadable.\n` +
    `  Re-run with --apply (which runs the idempotent ADD COLUMN migration first) to proceed.`,
  );
  exit(0);
}

const selectStmt = db.prepare(
  `SELECT id, ingredient, unit, unit_price, vendor,
          COALESCE(is_placeholder, 0) AS is_placeholder
     FROM order_guide_items
    WHERE LOWER(TRIM(ingredient)) = ?
      AND location_id = ?`,
);

let plannedUpdates = 0;
let alreadyFlagged = 0;
const toUpdate = [];

for (const ing of PLACEHOLDERS) {
  const rows = selectStmt.all(ing, LOCATION);
  if (rows.length === 0) {
    console.log(`  - ${ing.padEnd(16)} : no rows (skipped)`);
    continue;
  }
  for (const r of rows) {
    if (r.is_placeholder === 1) {
      alreadyFlagged++;
      console.log(`  - ${ing.padEnd(16)} id=${r.id} already flagged (unit_price=${r.unit_price})`);
    } else {
      plannedUpdates++;
      toUpdate.push(r.id);
      console.log(
        `  - ${ing.padEnd(16)} id=${r.id} ` +
          `unit_price=${r.unit_price} unit=${r.unit} vendor=${r.vendor}` +
          ` → WILL FLAG`,
      );
    }
  }
}

console.log(
  `\n[flag-placeholder-order-guide] summary: plan to flag ${plannedUpdates}, ` +
    `already flagged ${alreadyFlagged}.`,
);

if (!APPLY) {
  console.log(`[flag-placeholder-order-guide] dry-run only. Re-run with --apply to write.`);
  exit(0);
}

if (plannedUpdates === 0) {
  console.log(`[flag-placeholder-order-guide] nothing to do.`);
  exit(0);
}

const updateStmt = db.prepare(
  `UPDATE order_guide_items SET is_placeholder = 1 WHERE id = ?`,
);
const tx = db.transaction((ids) => {
  for (const id of ids) updateStmt.run(id);
});
tx(toUpdate);
db.close();

console.log(`[flag-placeholder-order-guide] flagged ${plannedUpdates} row(s).`);
