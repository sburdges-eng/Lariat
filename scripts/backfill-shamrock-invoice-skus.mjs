#!/usr/bin/env node
// Backfill `vendor_prices` rows for Shamrock SKUs that appear in
// `shamrock_invoices` but are missing from `vendor_prices`. The price-list
// ingest (scripts/ingest_shamrock_price_list.py) only seeds the SKUs printed
// on the 2025 catalog PDF; anything ordered ad-hoc through an invoice never
// reaches vendor_prices, which leaves recipe costing unable to price those
// ingredients. This script closes that gap from the invoice table itself.
//
// Algorithm:
//   1. For each distinct SKU in `shamrock_invoices` that has no row in
//      `vendor_prices` (filtered by vendor='shamrock'), pick the latest
//      invoice row by (delivery_date DESC, rowid DESC).
//   2. Recompute pricing into vendor_prices semantics:
//        - Catch-weight (item text contains "Actual Weight: NNlbs"):
//            unit_price = invoice.unit_price            // $/lb
//            pack_price = unit_price * pack_size        // nominal case
//        - Otherwise (CS/EA/etc. — invoice billed per case/each):
//            pack_price = invoice.unit_price            // $/case
//            unit_price = pack_price / pack_size        // $/base-unit
//   3. Strip "Actual Weight: NNlbs" debris from the ingredient text;
//      keep the all-caps Shamrock convention. Tag every inserted row with
//      `category='shamrock_invoice_backfill'` so the next ingest-costing
//      run preserves it (see scripts/ingest-costing.mjs BEVERAGE_CATEGORIES
//      — the predicate now also preserves this tag).
//   4. Skip any row whose latest pack_size is NULL/0 (bump
//      `skipped_no_pack_size` counter; never INSERT garbage).
//   5. Idempotent — the SELECT already filters out SKUs that exist in
//      vendor_prices, so a second invocation inserts zero rows.
//
// Usage:
//   node scripts/backfill-shamrock-invoice-skus.mjs [options]
// Options:
//   --db <path>          (default: data/lariat.db)
//   --location <id>      (default: default)
//   --dry-run            print counters; no INSERT, no audit row
//   --limit <n>          cap the SKU count (testing aid; processes the
//                        first n distinct SKUs after the missing-SKU
//                        selection)
//   --help

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    location: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    'Usage: node scripts/backfill-shamrock-invoice-skus.mjs ' +
      '[--db <path>] [--location <id>] [--dry-run] [--limit <n>]\n',
  );
  process.exit(0);
}

const dbPath = path.resolve(values.db ?? 'data/lariat.db');
const locationId = values.location ?? 'default';
const dryRun = Boolean(values['dry-run']);
const limit = values.limit ? Number.parseInt(values.limit, 10) : null;
if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
  process.stderr.write(`backfill-shamrock-invoice-skus: --limit must be a positive integer, got ${values.limit}\n`);
  process.exit(2);
}

// DB existence is enforced inside the CLI block below — importing this
// module for tests must not exit the process.

// ── Exports for tests ───────────────────────────────────────────────
// The test harness imports `runBackfill` against a fixture :memory: DB.
// Keep the implementation a pure function of a `better-sqlite3` Database
// handle and an opts bag so we don't have to launch a child process.

const RE_ACTUAL_WEIGHT = /\s*Actual Weight:\s*[\d.]+lbs?\b/iu;

/**
 * Normalize the invoice `item` text for vendor_prices.ingredient.
 * Strips the catch-weight "Actual Weight: NN.NNlbs" suffix that the
 * Python ingest leaves in place, and collapses redundant whitespace.
 * Preserves the all-caps Shamrock convention (no Title-Case translation).
 */
export function normalizeIngredient(rawItem) {
  if (typeof rawItem !== 'string') return '';
  return rawItem.replace(RE_ACTUAL_WEIGHT, '').replace(/\s+/gu, ' ').trim();
}

/**
 * Decide which pricing branch applies to a candidate row and return
 * `{ pack_price, unit_price, branch }`. Returns null if pack_size is
 * unusable (NULL or 0) — caller skips and bumps the counter.
 *
 * Branches:
 *   - 'catch_weight'  : item contains "Actual Weight:" suffix.
 *                       invoice.unit_price is $/lb; pack_size is the
 *                       nominal case weight. pack_price = up * ps.
 *   - 'per_case'      : invoice.unit_price is per pack (CS / EA / pk /
 *                       gal / cs / etc.). pack_price = up;
 *                       unit_price = up / ps.
 */
export function recomputePricing(row) {
  const packSize = Number(row.pack_size);
  if (!Number.isFinite(packSize) || packSize <= 0) return null;
  // Tight unit_price check: explicit null/undefined fails, and we require
  // a strictly positive numeric price (a $0/case row is meaningless and
  // would propagate as a zero-cost ingredient downstream).
  if (row.unit_price === null || row.unit_price === undefined) return null;
  const invoiceUnitPrice = Number(row.unit_price);
  if (!Number.isFinite(invoiceUnitPrice) || invoiceUnitPrice <= 0) return null;

  const isCatchWeight =
    typeof row.item === 'string' && RE_ACTUAL_WEIGHT.test(row.item);

  if (isCatchWeight) {
    return {
      branch: 'catch_weight',
      unit_price: invoiceUnitPrice,
      pack_price: Math.round(invoiceUnitPrice * packSize * 100) / 100,
    };
  }
  return {
    branch: 'per_case',
    pack_price: Math.round(invoiceUnitPrice * 100) / 100,
    unit_price: invoiceUnitPrice / packSize,
  };
}

const SELECT_LATEST_MISSING_SKUS_SQL = `
  WITH missing AS (
    SELECT DISTINCT si.sku
      FROM shamrock_invoices si
     WHERE si.sku IS NOT NULL AND si.sku <> ''
       AND si.location_id = @location_id
       AND NOT EXISTS (
         SELECT 1 FROM vendor_prices vp
          WHERE vp.vendor = 'shamrock'
            AND vp.sku = si.sku
            AND vp.location_id = @location_id
       )
  ),
  ranked AS (
    SELECT si.sku,
           si.item,
           si.pack_size,
           si.pack_unit,
           si.unit_price,
           si.delivery_date,
           ROW_NUMBER() OVER (
             PARTITION BY si.sku
             ORDER BY COALESCE(si.delivery_date, '') DESC,
                      si.rowid DESC
           ) AS rn
      FROM shamrock_invoices si
     WHERE si.sku IN (SELECT sku FROM missing)
       AND si.location_id = @location_id
  )
  SELECT sku, item, pack_size, pack_unit, unit_price, delivery_date
    FROM ranked
   WHERE rn = 1
   ORDER BY sku
`;

/**
 * Core implementation. Runs against an open better-sqlite3 handle.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   locationId?: string,
 *   dryRun?: boolean,
 *   limit?: number | null,
 *   now?: () => string,
 * }} [opts]
 * @returns {{
 *   candidates: number,
 *   inserted: number,
 *   skipped_no_pack_size: number,
 *   skipped_no_unit_price: number,
 *   branch_catch_weight: number,
 *   branch_per_case: number,
 *   skus: string[],
 *   skipped_skus: string[],
 *   run_id: number | null,
 *   before_count: number,
 *   after_count: number,
 * }}
 */
export function runBackfill(db, opts = {}) {
  const locationId = opts.locationId ?? 'default';
  const dryRun = Boolean(opts.dryRun);
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : null;

  const before = db
    .prepare(
      `SELECT COUNT(*) AS c FROM vendor_prices
        WHERE vendor='shamrock' AND location_id = ?`,
    )
    .get(locationId).c;

  const rows = db.prepare(SELECT_LATEST_MISSING_SKUS_SQL).all({ location_id: locationId });
  const candidates = rows.length;
  const slice = limit !== null ? rows.slice(0, limit) : rows;

  // Run-level audit row. Only created on a real (non-dry) run.
  let runId = null;
  const startedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');

  const counters = {
    candidates,
    inserted: 0,
    skipped_no_pack_size: 0,
    skipped_no_unit_price: 0,
    branch_catch_weight: 0,
    branch_per_case: 0,
  };
  const insertedSkus = [];
  const skippedSkus = [];

  const txn = () => {
    if (!dryRun) {
      const r = db
        .prepare(
          `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
           VALUES (?, ?, 'running', ?)`,
        )
        .run('backfill-shamrock-invoice-skus', startedAt, candidates);
      runId = Number(r.lastInsertRowid);
    }

    const insertStmt = db.prepare(`
      INSERT INTO vendor_prices
        (ingredient, vendor, sku, pack_size, pack_unit, pack_price,
         unit_price, category, yield_pct, map_status, master_id,
         location_id, imported_at)
      VALUES
        (@ingredient, 'shamrock', @sku, @pack_size, @pack_unit, @pack_price,
         @unit_price, 'shamrock_invoice_backfill', NULL, NULL, NULL,
         @location_id, datetime('now'))
    `);

    for (const r of slice) {
      const priced = recomputePricing(r);
      if (priced === null) {
        if (!Number.isFinite(Number(r.pack_size)) || Number(r.pack_size) <= 0) {
          counters.skipped_no_pack_size += 1;
        } else {
          counters.skipped_no_unit_price += 1;
        }
        skippedSkus.push(r.sku);
        continue;
      }

      if (priced.branch === 'catch_weight') counters.branch_catch_weight += 1;
      else counters.branch_per_case += 1;

      if (!dryRun) {
        insertStmt.run({
          ingredient: normalizeIngredient(r.item),
          sku: r.sku,
          pack_size: r.pack_size,
          pack_unit: r.pack_unit,
          pack_price: priced.pack_price,
          unit_price: priced.unit_price,
          location_id: locationId,
        });
      }
      counters.inserted += 1;
      insertedSkus.push(r.sku);
    }

    if (!dryRun) {
      const finishedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
      db.prepare(
        `UPDATE ingest_runs
            SET finished_at = ?, rows_out = ?, status = 'ok'
          WHERE id = ?`,
      ).run(finishedAt, counters.inserted, runId);
    }
  };

  if (dryRun) {
    txn();
  } else {
    db.transaction(txn)();
  }

  const after = db
    .prepare(
      `SELECT COUNT(*) AS c FROM vendor_prices
        WHERE vendor='shamrock' AND location_id = ?`,
    )
    .get(locationId).c;

  // Verify step: in non-dry mode, the after count must be before + inserted.
  // In dry mode it should be unchanged.
  if (!dryRun && after !== before + counters.inserted) {
    throw new Error(
      `backfill verify failed: before=${before} inserted=${counters.inserted} after=${after}`,
    );
  }
  if (dryRun && after !== before) {
    throw new Error(`dry-run verify failed: vendor_prices count changed (${before} -> ${after})`);
  }

  return {
    ...counters,
    skus: insertedSkus,
    skipped_skus: skippedSkus,
    run_id: runId,
    before_count: before,
    after_count: after,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────
// When invoked as a script (not imported by a test), open the DB at the
// supplied --db path, run the backfill, and emit a JSON-shaped summary
// plus a human-readable line on stderr.

const invokedAsScript = (() => {
  try {
    const argvPath = fs.realpathSync(process.argv[1]);
    const modulePath = fs.realpathSync(new URL(import.meta.url).pathname);
    return argvPath === modulePath;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`backfill-shamrock-invoice-skus: DB not found: ${dbPath}\n`);
    process.exit(1);
  }
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = FULL');

  try {
    const result = runBackfill(db, {
      locationId,
      dryRun,
      limit,
    });

    const summary = {
      mode: dryRun ? 'dry-run' : 'apply',
      db: dbPath,
      location: locationId,
      ...result,
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.stderr.write(
      `backfill-shamrock-invoice-skus: ${dryRun ? 'DRY-RUN ' : ''}` +
        `candidates=${result.candidates} inserted=${result.inserted} ` +
        `skipped_no_pack_size=${result.skipped_no_pack_size} ` +
        `branch_catch_weight=${result.branch_catch_weight} ` +
        `branch_per_case=${result.branch_per_case} ` +
        `before=${result.before_count} after=${result.after_count}\n`,
    );
  } finally {
    db.close();
  }
}
