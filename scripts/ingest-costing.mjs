#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { normalizeIngredientKey, deriveMasterId } from '../lib/ingredientKey.ts';
import {
  convertPackSizeToLineUnit,
  normalizeUnit,
} from '../lib/unitConvert.mjs';
import { rollupRecipeCosts } from '../lib/computeEngine/rollupRecipeCosts.ts';

// bridgeCount moved to lib/unitConvert.mjs so lib-level pricing
// (rollupRecipeCosts, costingBenchmarks) can share it. Re-exported here for
// backward compatibility — tests and tooling import it from this module.
export { bridgeCount } from '../lib/unitConvert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(__dirname, 'ingest_costing.py');
const DEFAULT_COSTING = path.join(ROOT, 'XL', 'Lariat_Master_Costing_2026-04-09.xlsx');
const DEFAULT_OPS = path.join(ROOT, 'XL', 'lariat_operations_workbook_2026-04-10.xlsx');

/**
 * Ingest a costing JSON payload (the shape produced by scripts/ingest_costing.py)
 * into the provided SQLite database. Populates vendor_prices.yield_pct and
 * bom_lines.{yield_pct, loss_factor} by joining on the ingredient_yields table
 * via the shared normalizeIngredientKey() normalizer.
 *
 * After the DELETE+INSERT sweep (T2c), a separate post-pass (T3) recomputes
 * recipe_costs.batch_cost and cost_per_yield_unit by summing per-BOM-line
 * yield/loss adjustments on top of Excel's pre-computed values. NULL yield_pct
 * is treated as 1.0 and NULL loss_factor as 0.0 so any recipe whose lines all
 * lack yield data retains its Excel batch_cost byte-exact (zero regression).
 *
 * @param {import('better-sqlite3').Database} db - Open SQLite handle. Caller owns lifecycle.
 * @param {object} data - Parsed payload with arrays: vendor_prices, recipe_costs,
 *                        bom_lines, ingredient_maps, order_guide.
 * @param {string} [locationId='default'] - Tenant scope for the DELETE+INSERT sweep.
 * @returns {{
 *   vendor_prices: number,
 *   recipe_costs: number,
 *   bom_lines: number,
 *   bom_lines_with_yield: number,
 *   bom_coverage_pct: number,
 *   ingredient_maps: number,
 *   order_guide: number,
 *   recipes_yield_adjusted: number,
 *   total_yield_delta_usd: number,
 *   max_recipe_yield_delta_usd: number,
 *   bom_lines_needs_density: number,
 *   pack_size_changes: number,
 * }} Summary of rows inserted, yield coverage, yield-adjustment totals,
 *    count of BOM rows flagged `map_status='NEEDS_DENSITY'` by the T4
 *    volume↔weight conversion pass (these surface in B2's unmapped queue),
 *    and count of vendor pack-size substitutions (T6) detected this run —
 *    each backed by a row in the `pack_size_changes` audit table and
 *    `vendor_prices.map_status='PACK_CHANGED'` on the freshly-inserted row.
 */
export function ingestCosting(db, data, locationId = 'default') {
  initSchema(db);

  // ── T9 / B3: ingest instrumentation ────────────────────────────────
  // Open an `ingest_runs` row BEFORE any work happens so the timestamp
  // reflects the real start of the job (not the end of the transaction).
  // rows_in is computed up-front from the payload arrays; rows_out is filled
  // in from the summary at the end. On any exception, the finally block
  // updates status='failed' and re-throws so the caller still surfaces the
  // error. On success, status='ok' with rows_out populated.
  const runIn =
    (data?.bom_lines?.length ?? 0) +
    (data?.vendor_prices?.length ?? 0) +
    (data?.recipe_costs?.length ?? 0);
  const runInsert = db.prepare(
    `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
     VALUES ('costing', datetime('now','subsec'), 'running', ?)`,
  );
  const runId = Number(runInsert.run(runIn).lastInsertRowid);
  const runFinalize = (status, rowsOut) => {
    try {
      db.prepare(
        `UPDATE ingest_runs
            SET finished_at = datetime('now','subsec'),
                status      = ?,
                rows_out    = ?
          WHERE id = ?`,
      ).run(status, rowsOut ?? null, runId);
    } catch {
      // Never let the instrumentation UPDATE mask the real error path.
    }
  };

  let summaryResult;
  try {
    summaryResult = _ingestCostingImpl(db, data, locationId, runId);
  } catch (err) {
    runFinalize('failed', null);
    throw err;
  }
  const rowsOut =
    (summaryResult.bom_lines ?? 0) +
    (summaryResult.vendor_prices ?? 0) +
    (summaryResult.recipe_costs ?? 0);
  runFinalize('ok', rowsOut);
  return summaryResult;
}

// Categories whose rows are NOT wiped by the costing DELETE+INSERT sweep.
// Beverages live in vendor_prices alongside food but are populated by a
// separate out-of-band importer (scripts/import-vendor-prices.mjs /
// lib/vendorPricesRepo.ts) that the costing ingest has no feed for.
// Without this guard, every `npm run ingest:costing` wiped drink prices.
// Comparison is case-insensitive via LOWER() in the SQL.
// 'shamrock_invoice_backfill' tags rows seeded by
// scripts/backfill-shamrock-invoice-skus.mjs from `shamrock_invoices` for
// SKUs not on the 2025 Shamrock price list. The costing ingest has no feed
// for those rows either, so include the tag here to survive the wipe.
export const BEVERAGE_CATEGORIES = ['beer', 'wine', 'liquor', 'spirit', 'cocktail', 'shamrock_invoice_backfill'];

function _ingestCostingImpl(db, data, locationId, runId = null) {
  // Build an in-memory lookup of ingredient_key → {yield_pct, loss_factor} once
  // per ingest. Avoids a per-row SELECT on potentially thousands of BOM rows.
  const yieldLookup = new Map();
  for (const row of db.prepare(
    'SELECT ingredient_key, yield_pct, loss_factor FROM ingredient_yields',
  ).all()) {
    yieldLookup.set(row.ingredient_key, {
      yield_pct: row.yield_pct,
      loss_factor: row.loss_factor,
    });
  }

  const lookup = (rawIngredient) => {
    const key = normalizeIngredientKey(rawIngredient ?? '');
    return yieldLookup.get(key) ?? null;
  };

  const summary = {
    vendor_prices: 0,
    recipe_costs: 0,
    bom_lines: 0,
    bom_lines_with_yield: 0,
    bom_coverage_pct: 0,
    ingredient_maps: 0,
    order_guide: 0,
    recipes_yield_adjusted: 0,
    total_yield_delta_usd: 0,
    bom_lines_needs_density: 0,
    pack_size_changes: 0,
    ingredient_masters: 0,
    vp_master_backfilled_rows: 0,
    bom_master_backfilled_rows: 0,
  };

  // ── T6: pack-size substitution detection ──────────────────────────
  // Snapshot the current vendor_prices rows (latest per (vendor, sku))
  // BEFORE the DELETE below — otherwise there's no "prior" pack to diff
  // against. The key is `${vendor}\u0001${sku}` so empty vendor or sku
  // don't collide with anything. Units are compared post-normalizeUnit
  // so 'CS' vs 'cs' or 'pound' vs 'lb' doesn't log a spurious change.
  //
  // Shared (vendor, sku) key — used both here to snapshot prior packs
  // AND below inside the transaction loop to look them up. One definition
  // avoids drift between the two sites.
  const pkey = (v, s) => `${v ?? ''}\u0001${s ?? ''}`;
  const priorPackByKey = new Map();
  for (const row of db.prepare(
    `SELECT vendor, sku, pack_size, pack_unit, pack_price, imported_at, id
       FROM vendor_prices
      WHERE location_id = ?
        AND vendor IS NOT NULL AND vendor != ''
        AND sku IS NOT NULL AND sku != ''
      ORDER BY imported_at DESC, id DESC`,
  ).all(locationId)) {
    const k = pkey(row.vendor, row.sku);
    if (!priorPackByKey.has(k)) {
      priorPackByKey.set(k, {
        pack_size: row.pack_size,
        pack_unit: row.pack_unit,
        pack_price: row.pack_price,
      });
    }
  }
  // Format a "{size}x{unit}" human-readable pack string. If either side
  // is null or empty we return null outright — a half-populated "6x" or
  // "x#10" would be ambiguous in the audit log, and the ingest persists
  // a null pack_unit as '' (see `pack_unit: r.pack_unit ?? ''` in the
  // INSERT below), so treating '' same as null keeps round-trips clean.
  // Detection logic above also null-checks independently, so this is
  // defensive rather than load-bearing, but it keeps prev_pack/new_pack
  // self-describing.
  const formatPack = (packSize, packUnit) => {
    if (packSize == null || packUnit == null) return null;
    const sz = String(packSize);
    const un = String(packUnit);
    if (!sz || !un) return null;
    return `${sz}x${un}`;
  };

  const del = (sql) => db.prepare(sql).run(locationId);

  db.transaction(() => {
    // Snapshot the current vendor_prices rows into vendor_prices_history
    // BEFORE the DELETE so a price series survives the destructive sweep.
    // In the same transaction as the DELETE, so a failure rolls back both
    // the snapshot and the erase — no orphan history rows.
    db.prepare(`
      INSERT INTO vendor_prices_history
        (run_id, source_vendor_price_id, ingredient, vendor, sku,
         pack_size, pack_unit, pack_price, unit_price, category,
         yield_pct, actual_received_lb, reconciled_unit_price, master_id,
         location_id, imported_at, snapshot_reason)
      SELECT ?, id, ingredient, vendor, sku,
             pack_size, pack_unit, pack_price, unit_price, category,
             yield_pct, actual_received_lb, reconciled_unit_price, master_id,
             location_id, imported_at, 'ingest-costing'
        FROM vendor_prices
       WHERE location_id = ?
    `).run(runId, locationId);

    // Preserve beverage rows — they come from import-vendor-prices and the
    // costing ingest has no source feed for them. Food rows (category NULL
    // or any non-beverage category) get wiped as before.
    const bevPlaceholders = BEVERAGE_CATEGORIES.map(() => '?').join(',');
    db.prepare(`
      DELETE FROM vendor_prices
       WHERE location_id = ?
         AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})
    `).run(locationId, ...BEVERAGE_CATEGORIES);

    del('DELETE FROM recipe_costs WHERE location_id = ?');
    del('DELETE FROM bom_lines WHERE location_id = ?');

    // Snapshot operator-curated ingredient_maps statuses BEFORE the wipe.
    // Anything other than the auto-statuses produced by the Python parser
    // (mapped / auto_mapped / empty) is an operator decision that must
    // survive the workbook refresh. Key joins the two name columns with
    // an ASCII '::' separator that neither column can legitimately contain.
    const KEY_SEP = "::";
    const curatedMapStatuses = new Map();
    const curatedRows = db.prepare(
      "SELECT recipe_ingredient, vendor_ingredient, status FROM ingredient_maps " +
      "WHERE location_id = ? AND status IS NOT NULL " +
      "AND status NOT IN ('mapped', 'auto_mapped', '')"
    ).all(locationId);
    for (const r of curatedRows) {
      const k = String(r.recipe_ingredient) + KEY_SEP + String(r.vendor_ingredient ?? '');
      curatedMapStatuses.set(k, r.status);
    }

    del('DELETE FROM ingredient_maps WHERE location_id = ?');
    del('DELETE FROM order_guide_items WHERE location_id = ?');

    // Named parameters — D3 in MAPPING_ENGINE_GAPS.md. Positional `?` lists
    // silently succeed when the schema gains a column (new slot stays NULL).
    // Named binds force a schema match at prepare-time.
    //
    // T6 binds map_status here so a detected pack-size substitution can flag
    // the freshly-INSERTed row in the same statement (no follow-up UPDATE).
    const ivp = db.prepare(`
      INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, yield_pct, map_status, location_id)
      VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @pack_price, @unit_price, @category, @yield_pct, @map_status, @location_id)
    `);
    const ipsc = db.prepare(`
      INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, prev_price, new_price)
      VALUES (@vendor, @sku, @prev_pack, @new_pack, @prev_price, @new_price)
    `);
    for (const r of data.vendor_prices || []) {
      const y = lookup(r.ingredient);

      // T6 diff: only meaningful when BOTH vendor and sku are non-empty
      // (can't key a substitution on blanks). Compare normalized pack_unit
      // + numeric pack_size against the latest prior row; on mismatch log
      // a pack_size_changes audit row and flag the new row 'PACK_CHANGED'.
      //
      // Attention-queue semantics (read this before changing map_status):
      //   vendor_prices.map_status='PACK_CHANGED' is a RUN-SCOPED signal.
      //   It lives on the freshly-INSERTed vendor_prices row and reflects
      //   "this ingest run observed a pack-size diff for (vendor, sku)."
      //   Because the DELETE+INSERT sweep in the transaction wipes
      //   vendor_prices every run, the flag does NOT persist across a
      //   subsequent quiet re-ingest of the post-swap state (run 3 of
      //   the same pack + price after run 2 detected the change): there's
      //   no diff to re-emit, so map_status lands as NULL again.
      //
      //   The DURABLE "surface until acknowledged" queue source is the
      //   pack_size_changes table — specifically `WHERE acknowledged=0`.
      //   pack_size_changes is never DELETEd by the ingest, so the full
      //   per-(vendor,sku) change history is preserved and operators can
      //   acknowledge explicitly (UPDATE … SET acknowledged=1) without
      //   any ingest side-effect racing them. Downstream UI / attention
      //   queues MUST key on pack_size_changes.acknowledged, not on
      //   vendor_prices.map_status, for persistence guarantees.
      let mapStatus = null;
      const hasVendor = r.vendor != null && String(r.vendor) !== '';
      const hasSku = r.sku != null && String(r.sku) !== '';
      if (hasVendor && hasSku) {
        const prior = priorPackByKey.get(pkey(r.vendor, r.sku));
        if (prior) {
          const newUnitCanon = normalizeUnit(r.pack_unit);
          const oldUnitCanon = normalizeUnit(prior.pack_unit);
          const newSize = r.pack_size ?? null;
          const oldSize = prior.pack_size ?? null;
          // Treat numeric equality tolerantly for REAL ↔ int round-trips
          // (SQLite stores 6 as 6.0); unit equality uses canonical form.
          const sizeEq = (newSize == null && oldSize == null) ||
                         (newSize != null && oldSize != null && Number(newSize) === Number(oldSize));
          const unitEq = newUnitCanon === oldUnitCanon;
          if (!(sizeEq && unitEq)) {
            ipsc.run({
              vendor: String(r.vendor),
              sku: String(r.sku),
              prev_pack: formatPack(prior.pack_size, prior.pack_unit),
              new_pack: formatPack(r.pack_size, r.pack_unit),
              prev_price: prior.pack_price ?? null,
              new_price: r.pack_price ?? null,
            });
            summary.pack_size_changes++;
            mapStatus = 'PACK_CHANGED';
          }
        }
      }

      // NOTE: map_status bound below is run-scoped (see block comment
      // above). A quiet re-ingest of the post-swap state will land this
      // column as NULL because there's no new diff; that is intentional.
      // The persistent attention-queue source for pack substitutions is
      // `pack_size_changes WHERE acknowledged=0`.
      ivp.run({
        ingredient: r.ingredient,
        vendor: r.vendor,
        sku: r.sku ?? '',
        pack_size: r.pack_size ?? null,
        pack_unit: r.pack_unit ?? '',
        pack_price: r.pack_price ?? null,
        unit_price: r.unit_price ?? null,
        category: r.category ?? null,
        // NULL on miss — NEVER default to 1.0 (would silently poison COGS).
        yield_pct: y?.yield_pct ?? null,
        map_status: mapStatus,
        location_id: locationId,
      });
      summary.vendor_prices++;
    }

    const irc = db.prepare(`
      INSERT INTO recipe_costs (recipe_id, recipe_name, category, yield, yield_unit, batch_cost, cost_per_yield_unit, costed_lines, total_lines, interpretations, location_id)
      VALUES (@recipe_id, @recipe_name, @category, @yield, @yield_unit, @batch_cost, @cost_per_yield_unit, @costed_lines, @total_lines, @interpretations, @location_id)
    `);
    for (const r of data.recipe_costs || []) {
      if (!r.recipe_id) continue;
      // The Excel "Recipe Cost Summary" sheet emits a trailing TOTAL row
      // (recipe_id='TOTAL', empty name/yield, batch_cost = workbook sum).
      // The T3 deltas block already excludes it, and bom_lines never carries
      // it. Skip the INSERT too so the row never lands in recipe_costs in
      // the first place.
      if (r.recipe_id === 'TOTAL') continue;
      irc.run({
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name,
        category: r.category ?? '',
        yield: r.yield ?? null,
        yield_unit: r.yield_unit ?? '',
        batch_cost: r.batch_cost ?? null,
        cost_per_yield_unit: r.cost_per_yield_unit ?? null,
        costed_lines: r.costed_lines ?? null,
        total_lines: r.total_lines ?? null,
        interpretations: r.interpretations ?? null,
        location_id: locationId,
      });
      summary.recipe_costs++;
    }

    const ibom = db.prepare(`
      INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, vendor_ingredient, map_status, vendor, pack_price, pack_size, yield_pct, loss_factor, location_id)
      VALUES (@recipe_id, @ingredient, @qty, @unit, @sub_recipe, @vendor_ingredient, @map_status, @vendor, @pack_price, @pack_size, @yield_pct, @loss_factor, @location_id)
    `);
    for (const r of data.bom_lines || []) {
      if (!r.recipe_id) continue;
      const y = lookup(r.ingredient);
      const yieldPct = y?.yield_pct ?? null;
      const lossFactor = y?.loss_factor ?? null;
      ibom.run({
        recipe_id: r.recipe_id,
        ingredient: r.ingredient ?? '',
        qty: r.qty ?? null,
        unit: r.unit ?? '',
        sub_recipe: r.sub_recipe ?? null,
        vendor_ingredient: r.vendor_ingredient ?? null,
        map_status: r.map_status ?? null,
        vendor: r.vendor ?? null,
        pack_price: r.pack_price ?? null,
        pack_size: r.pack_size ?? null,
        yield_pct: yieldPct,
        loss_factor: lossFactor,
        location_id: locationId,
      });
      summary.bom_lines++;
      if (yieldPct !== null) summary.bom_lines_with_yield++;
    }

    const iim = db.prepare(`
      INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
      VALUES (@recipe_ingredient, @vendor_ingredient, @status, @location_id)
    `);
    for (const r of data.ingredient_maps || []) {
      // Restore the operator-curated status if one was snapshotted for this
      // (recipe_ingredient, vendor_ingredient) key. Falls through to the
      // Python parser's auto-status when no snapshot exists.
      const k = String(r.recipe_ingredient) + KEY_SEP + String(r.vendor_ingredient ?? '');
      const curated = curatedMapStatuses.get(k);
      iim.run({
        recipe_ingredient: r.recipe_ingredient,
        vendor_ingredient: r.vendor_ingredient ?? '',
        status: curated ?? r.status ?? '',
        location_id: locationId,
      });
      summary.ingredient_maps++;
    }

    const iog = db.prepare(`
      INSERT INTO order_guide_items (ingredient, base_qty, unit, vendor, unit_price, location_id)
      VALUES (@ingredient, @base_qty, @unit, @vendor, @unit_price, @location_id)
    `);
    for (const r of data.order_guide || []) {
      iog.run({
        ingredient: r.ingredient,
        base_qty: r.base_qty ?? null,
        unit: r.unit ?? '',
        vendor: r.vendor ?? '',
        unit_price: r.unit_price ?? null,
        location_id: locationId,
      });
      summary.order_guide++;
    }
  })();

  summary.bom_coverage_pct =
    summary.bom_lines > 0 ? (100 * summary.bom_lines_with_yield) / summary.bom_lines : 0;

  const postPass = runCostingPostPass(db, locationId);
  summary.recipes_yield_adjusted = postPass.recipes_yield_adjusted;
  summary.total_yield_delta_usd = postPass.total_yield_delta_usd;
  summary.max_recipe_yield_delta_usd = postPass.max_recipe_yield_delta_usd;
  summary.bom_lines_needs_density = postPass.bom_lines_needs_density;
  summary.catch_weight_backfilled_rows = postPass.catch_weight_backfilled_rows ?? 0;
  summary.ingredient_masters = postPass.ingredient_masters ?? 0;
  summary.vp_master_backfilled_rows = postPass.vp_master_backfilled_rows ?? 0;
  summary.bom_master_backfilled_rows = postPass.bom_master_backfilled_rows ?? 0;
  summary.excel_drift_warnings = postPass.excel_drift_warnings ?? 0;
  summary.subrecipe_rollup_updated = postPass.subrecipe_rollup_updated ?? 0;
  summary.subrecipe_rollup_cycles = postPass.subrecipe_rollup_cycles ?? 0;
  summary.subrecipe_rollup_unconverted = postPass.subrecipe_rollup_unconverted ?? 0;
  summary.subrecipe_flags_set = postPass.subrecipe_flags_set ?? 0;
  return summary;
}

/**
 * T3+T4 post-pass. Reads fresh bom_lines/vendor_prices/ingredient_densities/
 * ingredient_unit_weights/ingredient_yields for the given location and
 * UPDATEs recipe_costs.{batch_cost, cost_per_yield_unit} with the yield/loss/
 * unit-conversion delta for each recipe. Safe to call outside the DELETE+
 * INSERT path, so an operator who already has good vendor_prices in place
 * can apply T4.1 deltas without re-ingesting the workbook.
 *
 * Caller must ensure bom_lines.{yield_pct, loss_factor} are populated (either
 * by a prior ingestCosting run or by a JOIN-on-ingredient_yields migration).
 * Post-pass does not re-populate those columns — it reads them as-is.
 *
 * Returns the same fields the ingestCosting summary surfaces for the
 * post-pass metrics (recipes_yield_adjusted, total_yield_delta_usd,
 * max_recipe_yield_delta_usd, bom_lines_needs_density).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [locationId='default']
 */
export function runCostingPostPass(db, locationId = 'default') {
  const summary = {
    recipes_yield_adjusted: 0,
    total_yield_delta_usd: 0,
    max_recipe_yield_delta_usd: 0,
    bom_lines_needs_density: 0,
    catch_weight_backfilled_rows: 0,
    ingredient_masters: 0,
    vp_master_backfilled_rows: 0,
    bom_master_backfilled_rows: 0,
    excel_drift_warnings: 0,
    subrecipe_rollup_updated: 0,
    subrecipe_rollup_cycles: 0,
    subrecipe_rollup_unconverted: 0,
    subrecipe_flags_set: 0,
  };

  // ── D4: Excel batch_cost vs raw-sum drift observability ───────────
  // T3's yield-delta math adds on top of Excel's `recipe_costs.batch_cost`
  // assuming `excel_batch_cost === Σ (bom_qty × pack_price / pack_size)`
  // across BOM lines. The current workbook holds this identity, but
  // per-line rounding / case-minimum bucketing / sub-recipe caching in a
  // future workbook would silently break it — the yield-delta is still
  // correct FOR the yield portion, but the resulting batch_cost is
  // "Excel + our delta" rather than "absolute true cost".
  //
  // Snapshot batch_cost BEFORE the T3/T4 UPDATEs, compute the raw-sum
  // against the same guards the delta loop uses (skip null/zero/infinite
  // qty / pack_price / pack_size), and log an INFO line when |drift| >
  // $0.10. Observability only — no behavior change. See
  // docs/MAPPING_ENGINE_GAPS.md#D4.
  const excelBatchCostByRecipe = new Map();
  for (const row of db.prepare(
    `SELECT recipe_id, batch_cost FROM recipe_costs
      WHERE location_id = ?
        AND recipe_id IS NOT NULL
        AND recipe_id != 'TOTAL'
        AND batch_cost IS NOT NULL`,
  ).all(locationId)) {
    excelBatchCostByRecipe.set(row.recipe_id, row.batch_cost);
  }
  // ── T3 + T4: yield + loss + unit-conversion post-pass ──────────────
  // After T2c populated bom_lines.{yield_pct, loss_factor, pack_price, pack_size,
  // qty}, sum the per-BOM-line "true cost" adjustment for each recipe and apply
  // it on top of Excel's pre-computed batch_cost. NULL yield_pct → 1.0 (no
  // trim), NULL loss_factor → 0.0 (no shrinkage); zero-guards on qty /
  // pack_price / pack_size prevent division crashes. One-shot per ingest: the
  // DELETE+INSERT sweep above reinserts a fresh Excel batch_cost every time, so
  // running `ingestCosting` twice never double-applies the delta.
  //
  // T4 extension: the delta formula `qty × pack_price / pack_size × (adj − 1)`
  // assumed bom `qty` and `pack_size` were in the same unit. Live DB survey
  // showed ~85% of BOM rows mix volume (cup/tbsp/tsp) with weight (lb/oz)
  // vendor packs. To keep the ratio dimensionally meaningful we convert
  // `pack_size` into the bom_line's unit before dividing. When the conversion
  // cannot be completed — cross-dim without a known density, count units,
  // unknown unit tokens — we flag the row `map_status='NEEDS_DENSITY'` so B2's
  // unmapped queue surfaces it (reason='unmapped_status') and skip the row's
  // delta contribution. We only overwrite NULL / unrecognized map_status —
  // rows already 'confirmed' / 'mapped' / 'auto_mapped' are left alone so a
  // missing density on a confirmed mapping still gets the operator's attention
  // through B1 variance rather than clobbering curator intent.
  //
  // Recovery: on T3/T4 failure mid-UPDATE, the T2c transaction above is
  // already committed, so vendor_prices / bom_lines / recipe_costs have fresh
  // Excel values (pre-delta). Rerun `ingestCosting()` end-to-end — the
  // DELETE+INSERT sweep is idempotent and the second T3 pass starts from the
  // same raw Excel base.
  const adjustment = (yieldPct, lossFactor) => {
    const y = yieldPct == null ? 1.0 : yieldPct;
    const l = lossFactor == null ? 0.0 : lossFactor;
    const denom = y * (1 - l);
    if (!(denom > 0) || !Number.isFinite(denom)) return null; // caller emits warning
    return 1 / denom;
  };

  // Density lookup: ingredient_key → g/ml, built once and reused per-line.
  const densityByKey = new Map();
  for (const row of db.prepare('SELECT ingredient_key, g_per_ml FROM ingredient_densities').all()) {
    densityByKey.set(row.ingredient_key, row.g_per_ml);
  }

  // T4.1: per-(ingredient, count-unit) weight. Two-level Map so count-bridge
  // lookups can fall back across the legal count synonyms for the same item.
  //   unitWeightByKey.get(key).get(canonCountUnit) = grams per 1 of that unit
  // Populated once per ingest, same idempotency posture as densityByKey.
  const unitWeightByKey = new Map();
  for (const row of db.prepare(
    'SELECT ingredient_key, unit, g_per_unit FROM ingredient_unit_weights',
  ).all()) {
    let inner = unitWeightByKey.get(row.ingredient_key);
    if (!inner) { inner = new Map(); unitWeightByKey.set(row.ingredient_key, inner); }
    inner.set(row.unit, row.g_per_unit);
  }

  // Vendor pack_unit lookup. bom_lines.pack_size / pack_price arrive from the
  // Excel BOM sheet keyed by `vendor_ingredient` (the vendor-catalog string),
  // so we look up pack_unit with the same key, both in its raw form (exact
  // vendor catalog match) and in a normalized form (fallback for case /
  // whitespace drift). The same ORDER BY as B1 — imported_at DESC, id DESC,
  // first row wins per key — keeps "latest priced pack" semantics consistent.
  const vpPackUnitByRaw = new Map();
  const vpPackUnitByNormKey = new Map();
  for (const row of db.prepare(
    `SELECT ingredient, pack_unit
       FROM vendor_prices
      WHERE location_id = ?
      ORDER BY imported_at DESC, id DESC`,
  ).all(locationId)) {
    const raw = row.ingredient ?? '';
    if (raw && !vpPackUnitByRaw.has(raw)) vpPackUnitByRaw.set(raw, row.pack_unit);
    const key = normalizeIngredientKey(raw);
    if (!key) continue;
    if (!vpPackUnitByNormKey.has(key)) vpPackUnitByNormKey.set(key, row.pack_unit);
  }
  const resolvePackUnit = (bomIngredient, vendorIngredient) => {
    // 1. raw vendor string match on bom_lines.vendor_ingredient.
    if (vendorIngredient && vpPackUnitByRaw.has(vendorIngredient)) {
      return vpPackUnitByRaw.get(vendorIngredient);
    }
    // 2. normalized vendor string (case/whitespace drift).
    const vKey = normalizeIngredientKey(vendorIngredient ?? '');
    if (vKey && vpPackUnitByNormKey.has(vKey)) return vpPackUnitByNormKey.get(vKey);
    // 3. normalized bom ingredient as last resort (matches the B1 fallback
    //    semantics for recipes whose vendor_ingredient is blank but whose
    //    bom ingredient string happens to match a vendor row).
    const bKey = normalizeIngredientKey(bomIngredient ?? '');
    if (bKey && vpPackUnitByNormKey.has(bKey)) return vpPackUnitByNormKey.get(bKey);
    return undefined;
  };

  const bomForDelta = db.prepare(`
    SELECT id, recipe_id, ingredient, vendor_ingredient, unit, qty,
           pack_price, pack_size, yield_pct, loss_factor, map_status
      FROM bom_lines
     WHERE location_id = ?
  `).all(locationId);

  const perRecipeDelta = new Map(); // recipe_id -> delta (USD)
  // D4: Σ (qty × pack_price / pack_size) per recipe, using the same
  // guards as the delta loop. Compared against the Excel-sourced
  // batch_cost snapshot above to surface workbook-math drift before it
  // poisons COGS silently. INFO-level log only; no behavior change.
  const perRecipeRawSum = new Map();
  let guardSkipped = 0;
  let denomSkipped = 0;
  let denomConvertedSkipped = 0;

  // Track which BOM rows need `map_status='NEEDS_DENSITY'` so the flag update
  // can run inside one transaction after the scan completes.
  const needsDensityIds = [];
  // Rows already carrying one of these values were hand-curated or set by an
  // earlier pipeline stage; we never downgrade them to NEEDS_DENSITY.
  const PROTECTED_MAP_STATUSES = new Set(['confirmed', 'mapped', 'auto_mapped']);

  for (const line of bomForDelta) {
    const {
      id, recipe_id, ingredient, vendor_ingredient, unit, qty, pack_price, pack_size,
      yield_pct, loss_factor, map_status,
    } = line;
    // Guard: zero/null qty, pack_price, or pack_size contributes 0 delta.
    if (
      qty == null || pack_price == null || pack_size == null ||
      !(qty > 0) || !(pack_price > 0) || !(pack_size > 0) ||
      !Number.isFinite(qty) || !Number.isFinite(pack_price) || !Number.isFinite(pack_size)
    ) {
      guardSkipped++;
      continue;
    }
    // D4: accumulate the raw Σ (qty × pack_price / pack_size) in bom_line
    // units — same guard posture as the delta loop, computed BEFORE any
    // unit-conversion so it matches the Excel formula's assumptions. If
    // the workbook's batch_cost departs from this sum in a future
    // Excel revision, the INFO log downstream catches it.
    perRecipeRawSum.set(
      recipe_id,
      (perRecipeRawSum.get(recipe_id) ?? 0) + (qty * pack_price / pack_size),
    );
    const adj = adjustment(yield_pct, loss_factor);
    if (adj === null) {
      denomSkipped++;
      continue;
    }

    // T4: resolve pack_unit from vendor_prices (keyed by vendor_ingredient
    // first — the authoritative join on the Excel BOM sheet — then fall back
    // through normalized vendor string and normalized bom ingredient) and
    // convert pack_size into the bom_line's unit. Identity path (same
    // canonical unit) short-circuits so weight×weight with matching tokens
    // still hits the fast path.
    const key = normalizeIngredientKey(ingredient ?? '');
    const packUnit = resolvePackUnit(ingredient, vendor_ingredient);
    const bomUnit = unit;
    const density = key ? densityByKey.get(key) : undefined;

    // Shared T4 conversion (lib/unitConvert.mjs convertPackSizeToLineUnit):
    // identity fallback when the vendor pack_unit is unknown, flag+skip when
    // the ratio can't be interpreted (empty bom unit, cross-dim without
    // density, count involvement without unit_weight, unknown unit),
    // count-bridge before convertQty otherwise.
    const { value: packSizeInBomUnit, flag } = convertPackSizeToLineUnit(
      pack_size, packUnit, bomUnit, density, unitWeightByKey.get(key),
    );
    if (packSizeInBomUnit === null) {
      if (flag && !PROTECTED_MAP_STATUSES.has(map_status ?? '')) needsDensityIds.push(id);
      denomConvertedSkipped++;
      continue;
    }

    // delta = qty × pack_price / pack_size_in_bom_unit × (adj - 1)
    const delta = (qty * pack_price / packSizeInBomUnit) * (adj - 1);
    if (delta === 0) continue;
    perRecipeDelta.set(recipe_id, (perRecipeDelta.get(recipe_id) ?? 0) + delta);
  }

  if (guardSkipped > 0) {
    console.warn(
      `⚠ ${guardSkipped} bom_line(s) had null/zero qty, pack_price, or pack_size — delta skipped`,
    );
  }
  if (denomSkipped > 0) {
    console.warn(
      `⚠ ${denomSkipped} bom_line(s) had yield_pct × (1 - loss_factor) ≤ 0 — delta skipped (seed data out of domain, investigate ingredient_yields)`,
    );
  }
  if (denomConvertedSkipped > 0) {
    console.warn(
      `⚠ ${denomConvertedSkipped} bom_line(s) could not convert pack_size → bom_unit (missing density, count unit, or unknown unit) — delta skipped`,
    );
  }

  // D4: emit one WARN line per recipe whose Excel `batch_cost` differs
  // from the raw Σ (qty × pack_price / pack_size) by > $0.10. Runs
  // BEFORE the UPDATE transaction below so the comparison is against
  // Excel's original value — post-UPDATE, `batch_cost` is "Excel +
  // yield-delta" and the signal is lost.
  //
  // Threshold picked at $0.10 because (a) penny-level float noise from
  // Excel rounding is routine and noise-floor, and (b) $0.10 × typical
  // ~50 recipes × weekly runs ≈ $5/week of drift — below that, other
  // signals in the unmapped queue would catch it first.
  //
  // Promotion to a $1.00 hard-fail (throw + non-zero CLI exit code) is
  // gated on observability confirming the invariant — see
  // docs/audit/2026-05-08-codebase-audit.md §4 LOW (D4 threshold).
  // File a GitHub issue + raise this to throw once N consecutive
  // ingests show no drift > $0.10. Until then we stay at WARN-only so
  // legitimate vendor-renegotiation drifts ($0.10–$1.00) don't break
  // the weekly ingest.
  const DRIFT_THRESHOLD_USD = 0.10;
  for (const [recipe_id, rawSum] of perRecipeRawSum) {
    const excelValue = excelBatchCostByRecipe.get(recipe_id);
    if (excelValue == null) continue; // recipe_costs row had NULL batch_cost
    const drift = excelValue - rawSum;
    if (Math.abs(drift) > DRIFT_THRESHOLD_USD) {
      summary.excel_drift_warnings++;
      console.warn(
        `⚠ D4 Excel drift: recipe_id=${recipe_id} excel_value=$${excelValue.toFixed(4)} computed_sum=$${rawSum.toFixed(4)} drift_usd=$${drift.toFixed(4)} — investigate before next ingest (audit ref: docs/audit/2026-05-08-codebase-audit.md §4 LOW)`,
      );
    }
  }

  // Flag rows that need density (or any other unit-conversion failure). B2's
  // computeUnmapped treats any map_status not in
  // {confirmed, mapped, auto_mapped, no_cost_utility} as
  // reason='unmapped_status', so the new NEEDS_DENSITY rows appear in the
  // queue without further wiring. (`no_cost_utility` is additionally
  // pre-filtered before the per-row checks — see lib/costingBenchmarks.mjs.)
  if (needsDensityIds.length > 0) {
    const flagStmt = db.prepare(
      `UPDATE bom_lines
          SET map_status = 'NEEDS_DENSITY'
        WHERE id = ?
          AND location_id = ?
          AND (map_status IS NULL
               OR map_status NOT IN ('confirmed', 'mapped', 'auto_mapped'))`,
    );
    let flagged = 0;
    db.transaction(() => {
      for (const id of needsDensityIds) {
        const r = flagStmt.run(id, locationId);
        if (r.changes > 0) flagged++;
      }
    })();
    summary.bom_lines_needs_density = flagged;
    if (flagged > 0) {
      console.warn(
        `⚠ ${flagged} bom_line(s) flagged NEEDS_DENSITY — B2 unmapped queue will surface them`,
      );
    }
  }

  const updateRecipe = db.prepare(`
    UPDATE recipe_costs
       SET batch_cost = batch_cost + @delta,
           cost_per_yield_unit = CASE
             WHEN yield IS NULL OR yield = 0 THEN NULL
             ELSE (batch_cost + @delta) / yield
           END
     WHERE recipe_id = @recipe_id
       AND location_id = @location_id
       AND batch_cost IS NOT NULL
  `);

  let totalDelta = 0;
  let maxPerRecipeDelta = 0;
  let adjustedCount = 0;
  db.transaction(() => {
    for (const [recipe_id, delta] of perRecipeDelta) {
      if (delta === 0) continue; // preserves zero-regression invariant byte-exact
      // recipe_id='TOTAL' is the Excel Recipe Cost Summary row. It is never
      // INSERTed (see the skip in the recipe_costs loop above), so this is
      // purely defensive — bom_lines should never carry recipe_id='TOTAL'.
      if (recipe_id === 'TOTAL') continue;
      const result = updateRecipe.run({ recipe_id, delta, location_id: locationId });
      if (result.changes > 0) {
        adjustedCount++;
        totalDelta += delta;
        if (Math.abs(delta) > Math.abs(maxPerRecipeDelta)) maxPerRecipeDelta = delta;
      }
    }
  })();

  summary.recipes_yield_adjusted = adjustedCount;
  summary.total_yield_delta_usd = Math.round(totalDelta * 100) / 100;
  summary.max_recipe_yield_delta_usd = Math.round(maxPerRecipeDelta * 100) / 100;

  // T5b.3: backfill catch-weight reconciliation from the latest invoice
  // per (vendor, sku) into vendor_prices. The costing ingest's DELETE+
  // INSERT sweep above wipes vendor_prices.actual_received_lb and
  // reconciled_unit_price every run; this re-applies them so the latest
  // invoice's audit trail persists on the canonical vendor_prices row.
  // No-op when shamrock_invoices lacks catch-weight rows or the table
  // is missing (pre-T5b DB).
  const cwBackfill = backfillCatchWeightsIntoVendorPrices(db, locationId);
  summary.catch_weight_backfilled_rows = cwBackfill.updated;

  // T7: populate ingredient_masters from confirmed ingredient_maps rows,
  // then backfill master_id onto vendor_prices and bom_lines. Runs after
  // the DELETE+INSERT sweep and the other post-passes because it reads
  // the fresh ingredient_maps rows this ingest just wrote. Unconfirmed
  // maps do NOT produce masters — they stay in the unmapped queue (same
  // "no fuzz match" posture as `_make_join_key`).
  const masterSync = rebuildIngredientMasters(db, locationId);
  summary.ingredient_masters = masterSync.masters;
  summary.vp_master_backfilled_rows = masterSync.vp_backfilled;
  summary.bom_master_backfilled_rows = masterSync.bom_backfilled;

  // Sub-recipe rollup (2026-05-30 spec): walks the recipe DAG and rewrites
  // recipe_costs.batch_cost for any recipe whose cost can be assembled from
  // BOM lines (vendor_prices for leaves, prior rolled child for sub-recipes).
  // Runs after rebuildIngredientMasters so master_id and confirmed-map
  // semantics are in place.
  const rollup = rollupRecipeCosts(db, locationId);
  summary.subrecipe_rollup_updated = rollup.updated;
  summary.subrecipe_rollup_cycles = rollup.cycles.length;
  summary.subrecipe_rollup_unconverted = rollup.unconverted.length;
  summary.subrecipe_flags_set = rollup.new_subrecipe_flags;

  return summary;
}

/**
 * T5b.3 — join the most recent per-(vendor, sku) invoice catch-weight
 * reconciliation into vendor_prices. Scans both shamrock_invoices and
 * sysco_invoices; writes actual_received_lb + reconciled_unit_price on
 * matching vendor_prices rows. Leaves unchanged rows that have no invoice
 * match. Runs in a single transaction per vendor.
 *
 * Each source table either exists (written by its respective invoice
 * ingest) or is absent on fresh DBs — missing tables are silently skipped,
 * so callers can run the backfill on any DB state. vendor_prices.{
 * actual_received_lb, reconciled_unit_price} require the T5a migration;
 * if either column is absent, the whole backfill is a no-op.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [locationId='default']
 * @returns {{updated: number, by_vendor: Record<string, number>}}
 */
export function backfillCatchWeightsIntoVendorPrices(db, locationId = 'default') {
  const out = { updated: 0, by_vendor: {} };
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  if (!tables.has('vendor_prices')) return out;
  const vpCols = new Set(
    db.prepare('PRAGMA table_info(vendor_prices)').all().map((c) => c.name),
  );
  if (!vpCols.has('actual_received_lb') || !vpCols.has('reconciled_unit_price')) return out;

  const sources = [
    { vendor: 'shamrock', table: 'shamrock_invoices' },
    { vendor: 'sysco',    table: 'sysco_invoices'    },
  ];

  const upd = db.prepare(`
    UPDATE vendor_prices
       SET actual_received_lb = @actual_received_lb,
           reconciled_unit_price = @reconciled_unit_price
     WHERE vendor = @vendor
       AND sku = @sku
       AND location_id = @location_id
  `);

  for (const { vendor, table } of sources) {
    if (!tables.has(table)) continue;
    // Latest catch-weight row per SKU, preferring rows with non-NULL
    // reconciled_unit_price so the dashboard surfaces actual drift first.
    // ROW_NUMBER() guarantees exactly one row per SKU even when multiple
    // invoice lines share the same delivery_date (the table's UNIQUE
    // constraint allows that across different invoice_no/item combos).
    // Replaces the prior GROUP BY sku HAVING MAX(delivery_date) form,
    // which was non-deterministic in SQLite when non-aggregated columns
    // were referenced — see PR #41 / cursor/ingest-database-reliability.
    const latest = db.prepare(`
      SELECT sku, actual_received_lb, reconciled_unit_price
        FROM (
          SELECT sku, actual_received_lb, reconciled_unit_price,
                 ROW_NUMBER() OVER (
                   PARTITION BY sku
                   ORDER BY delivery_date DESC,
                            (reconciled_unit_price IS NULL) ASC,
                            rowid DESC
                 ) AS rn
            FROM ${table}
           WHERE location_id = ?
             AND actual_received_lb IS NOT NULL
             AND sku IS NOT NULL AND sku != ''
        )
       WHERE rn = 1
    `).all(locationId);
    if (latest.length === 0) { out.by_vendor[vendor] = 0; continue; }

    let vendorUpdated = 0;
    db.transaction(() => {
      for (const row of latest) {
        const r = upd.run({
          vendor,
          sku: row.sku,
          actual_received_lb: row.actual_received_lb,
          reconciled_unit_price: row.reconciled_unit_price ?? null,
          location_id: locationId,
        });
        vendorUpdated += r.changes;
      }
    })();
    out.by_vendor[vendor] = vendorUpdated;
    out.updated += vendorUpdated;
  }
  return out;
}

// deriveMasterId moved to lib/ingredientKey.ts (2026-05-30) — re-export
// here for backward compatibility with any external callers still
// importing from the script path.
export { deriveMasterId } from '../lib/ingredientKey.ts';

/**
 * T7 — rebuild ingredient_masters from confirmed ingredient_maps rows,
 * then backfill master_id onto vendor_prices and bom_lines.
 *
 * Seeding posture matches `_make_join_key` (no fuzz match): ONLY rows with
 * `ingredient_maps.status='confirmed'` produce a master. Unconfirmed /
 * mapped / auto_mapped rows stay in the unmapped queue until a human
 * promotes them. Re-entrant: UPSERT on master_id means a second run with
 * the same confirmed maps is a no-op; a newly confirmed map on the next
 * run picks up a master without touching earlier ones.
 *
 * Backfill join rules:
 *   vendor_prices.master_id ← set when vendor_prices.ingredient matches
 *     either recipe_ingredient OR vendor_ingredient (raw OR normalized)
 *     on a confirmed map. First-wins on ties (same collation as the T4
 *     post-pass vendor-prices lookup).
 *   bom_lines.master_id ← set when bom_lines.ingredient matches the
 *     recipe_ingredient (raw OR normalized) on a confirmed map.
 *
 * Master metadata:
 *   canonical_name = recipe_ingredient
 *   category       = NULL (future extension from recipe_costs.category)
 *   preferred_vendor = first vendor observed in vendor_prices for this
 *                      ingredient (NULL when no match yet)
 *   last_reviewed = datetime('now')
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [locationId='default']
 * @returns {{masters: number, vp_backfilled: number, bom_backfilled: number}}
 */
export function rebuildIngredientMasters(db, locationId = 'default') {
  const out = { masters: 0, vp_backfilled: 0, bom_backfilled: 0 };

  // Guardrail: columns / table may be absent on pre-T7 DBs that skipped
  // initSchema. Silently no-op so legacy smoke paths don't blow up.
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all().map((r) => r.name),
  );
  if (!tables.has('ingredient_masters')) return out;
  const vpCols = new Set(
    db.prepare('PRAGMA table_info(vendor_prices)').all().map((c) => c.name),
  );
  const bomCols = new Set(
    db.prepare('PRAGMA table_info(bom_lines)').all().map((c) => c.name),
  );
  if (!vpCols.has('master_id') || !bomCols.has('master_id')) return out;

  // Confirmed maps only — same posture as the existing ingest's "no fuzz
  // match" rule. Returns recipe_ingredient + vendor_ingredient for join-
  // string coverage.
  const confirmed = db.prepare(
    `SELECT recipe_ingredient, vendor_ingredient
       FROM ingredient_maps
      WHERE location_id = ?
        AND status = 'confirmed'
        AND recipe_ingredient IS NOT NULL
        AND recipe_ingredient != ''`,
  ).all(locationId);

  if (confirmed.length === 0) return out;

  // Snapshot vendor_prices once so preferred_vendor can be derived from
  // "first vendor observed" without a per-master subquery. Ordering by
  // imported_at DESC + id DESC mirrors the costing benchmark's "latest
  // vendor row per ingredient" semantics (costingBenchmarks.mjs).
  const vpRows = db.prepare(
    `SELECT ingredient, vendor
       FROM vendor_prices
      WHERE location_id = ?
      ORDER BY imported_at DESC, id DESC`,
  ).all(locationId);
  const vendorByRaw = new Map();
  const vendorByNorm = new Map();
  for (const r of vpRows) {
    const raw = r.ingredient ?? '';
    if (raw && !vendorByRaw.has(raw) && r.vendor) vendorByRaw.set(raw, r.vendor);
    const key = normalizeIngredientKey(raw);
    if (key && !vendorByNorm.has(key) && r.vendor) vendorByNorm.set(key, r.vendor);
  }

  // Build (master_id → {canonical_name, preferred_vendor, join_strings})
  // index. A single master can be reached through multiple map rows (a
  // "ketchup" recipe ingredient with two vendor_ingredient aliases) —
  // collapse them so the INSERT runs once per master.
  const masterIndex = new Map();
  for (const m of confirmed) {
    const masterId = deriveMasterId(m.recipe_ingredient);
    if (!masterId) continue;
    let entry = masterIndex.get(masterId);
    if (!entry) {
      entry = {
        canonical_name: m.recipe_ingredient,
        preferred_vendor: null,
        recipe_ingredients: new Set(),
        vendor_ingredients: new Set(),
      };
      masterIndex.set(masterId, entry);
    }
    entry.recipe_ingredients.add(m.recipe_ingredient);
    if (m.vendor_ingredient) entry.vendor_ingredients.add(m.vendor_ingredient);
    // First vendor hit wins — vendorByRaw lookup against any of the join
    // strings for this master. Normalized fallback mirrors T4 resolver.
    if (entry.preferred_vendor == null) {
      for (const s of [m.recipe_ingredient, m.vendor_ingredient]) {
        if (!s) continue;
        const v = vendorByRaw.get(s) ?? vendorByNorm.get(normalizeIngredientKey(s));
        if (v) { entry.preferred_vendor = v; break; }
      }
    }
  }

  // UPSERT ingredient_masters rows. ON CONFLICT updates canonical_name /
  // last_reviewed so a renamed confirmed mapping propagates without
  // manual intervention. category is left alone — operator-curated.
  // preferred_vendor is INTENTIONALLY omitted from the UPDATE clause:
  // on first INSERT we seed it from the first-vendor-observed derivation
  // (useful default), but once the row exists any operator override in
  // ingredient_masters.preferred_vendor must persist across re-ingests.
  // COALESCE(excluded.preferred_vendor, ...) would silently revert an
  // operator-set 'shamrock' back to auto-derived 'sysco' as soon as the
  // seed vendor changed.
  const upsert = db.prepare(`
    INSERT INTO ingredient_masters (master_id, canonical_name, category, preferred_vendor, last_reviewed)
    VALUES (@master_id, @canonical_name, NULL, @preferred_vendor, datetime('now'))
    ON CONFLICT(master_id) DO UPDATE SET
      canonical_name   = excluded.canonical_name,
      category         = COALESCE(excluded.category, ingredient_masters.category),
      last_reviewed    = excluded.last_reviewed
      -- preferred_vendor intentionally omitted: preserve operator curation.
  `);

  // Raw-string backfill. `master_id IS NULL` guard is critical: without
  // it a second confirmed map that normalizes to a different slug but
  // shares a vendor_ingredient raw string would silently overwrite the
  // earlier master's claim, and re-running ingest would flap master_id
  // back and forth between aliases on every run. First-write-wins
  // matches the normalized sweep below, and makes result.changes == 0
  // on idempotent re-runs.
  const updateVp = db.prepare(`
    UPDATE vendor_prices
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND master_id IS NULL
       AND ingredient = @match
  `);
  const updateVpNorm = db.prepare(`
    UPDATE vendor_prices
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND master_id IS NULL
       AND ingredient IS NOT NULL
       AND LOWER(TRIM(ingredient)) = @norm_match
  `);
  const updateBom = db.prepare(`
    UPDATE bom_lines
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND master_id IS NULL
       AND ingredient = @match
  `);
  const updateBomNorm = db.prepare(`
    UPDATE bom_lines
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND master_id IS NULL
       AND ingredient IS NOT NULL
       AND LOWER(TRIM(ingredient)) = @norm_match
  `);

  db.transaction(() => {
    for (const [masterId, entry] of masterIndex) {
      // Deterministic canonical_name: Set iteration order is insertion
      // order, which depends on the SQLite row order of confirmed maps
      // (not guaranteed stable across reruns). Sort + take first so the
      // displayed name is reproducible even when multiple case-variant
      // recipe_ingredients collapse to one master ('Salt' + 'salt').
      const canonical =
        Array.from(entry.recipe_ingredients).sort()[0] ?? entry.canonical_name;

      upsert.run({
        master_id: masterId,
        canonical_name: canonical,
        preferred_vendor: entry.preferred_vendor,
      });
      out.masters++;

      // Backfill vendor_prices.master_id. Raw-string joins first (exact
      // match on recipe_ingredient or vendor_ingredient), then a
      // normalized-key sweep for any rows that differ only in case /
      // whitespace. Both passes are guarded by `master_id IS NULL` so
      // the first master to claim a row keeps it — prevents two
      // confirmed maps pointing at the same vendor_ingredient from
      // clobbering each other's master_id on every ingest run.
      for (const s of entry.recipe_ingredients) {
        const r = updateVp.run({ master_id: masterId, location_id: locationId, match: s });
        out.vp_backfilled += r.changes;
      }
      for (const s of entry.vendor_ingredients) {
        const r = updateVp.run({ master_id: masterId, location_id: locationId, match: s });
        out.vp_backfilled += r.changes;
      }
      // Normalized sweep: compare LOWER(TRIM(ingredient)) against the
      // normalized join strings. normalizeIngredientKey strips punctuation
      // entirely, which would over-match ("tomato paste" vs "tomato
      // (paste)"), so the SQL comparison uses a lighter LOWER(TRIM) that
      // catches case / whitespace drift without fuzz-matching — matches
      // the "no auto fuzz" posture.
      for (const s of [...entry.recipe_ingredients, ...entry.vendor_ingredients]) {
        const norm = (s ?? '').toLowerCase().trim();
        if (!norm) continue;
        const rNorm = updateVpNorm.run({ master_id: masterId, location_id: locationId,
                                         norm_match: norm });
        out.vp_backfilled += rNorm.changes;
      }

      for (const s of entry.recipe_ingredients) {
        const r = updateBom.run({ master_id: masterId, location_id: locationId, match: s });
        out.bom_backfilled += r.changes;
      }
      for (const s of entry.recipe_ingredients) {
        const norm = (s ?? '').toLowerCase().trim();
        if (!norm) continue;
        const rNorm = updateBomNorm.run({ master_id: masterId, location_id: locationId,
                                          norm_match: norm });
        out.bom_backfilled += rNorm.changes;
      }
    }
  })();

  return out;
}

// ── CLI entrypoint ─────────────────────────────────────────────────
// Only runs when invoked directly (node scripts/ingest-costing.mjs), not when
// imported by the test harness.
function main() {
  const COSTING = process.env.LARIAT_COSTING || DEFAULT_COSTING;
  const OPS = process.env.LARIAT_OPS || DEFAULT_OPS;

  if (!fs.existsSync(COSTING)) {
    console.error('✗ Costing workbook not found:', COSTING);
    process.exit(1);
  }

  const env = { ...process.env, LARIAT_COSTING: COSTING, LARIAT_OPS: fs.existsSync(OPS) ? OPS : '' };

  let data;
  try {
    data = JSON.parse(execSync(`python3 ${JSON.stringify(PY)}`, { maxBuffer: 100 * 1024 * 1024, env }));
  } catch (e) {
    console.error('✗ ingest_costing.py failed:', e.stderr?.toString() || e.message);
    process.exit(1);
  }

  const LOC = 'default';
  const db = new Database(DB_FILE);
  try {
    const summary = ingestCosting(db, data, LOC);

    console.log(
      `✓ Costing ingest: ${summary.vendor_prices} vendor prices, ${summary.recipe_costs} recipe costs, ${summary.bom_lines} BOM lines, ${summary.ingredient_maps} maps, ${summary.order_guide} order guide rows → SQLite (${LOC})`,
    );
    console.log(
      `  yield coverage: ${summary.bom_lines_with_yield}/${summary.bom_lines} bom_lines (${summary.bom_coverage_pct.toFixed(1)}%) have yield_pct populated`,
    );
    console.log(
      `✓ Yield-adjusted ${summary.recipes_yield_adjusted} recipes (Δ_total=$${summary.total_yield_delta_usd.toFixed(2)}, max per-recipe delta=$${summary.max_recipe_yield_delta_usd.toFixed(2)})`,
    );
    if (
      summary.subrecipe_rollup_updated > 0 ||
      summary.subrecipe_rollup_cycles > 0 ||
      summary.subrecipe_flags_set > 0 ||
      summary.subrecipe_rollup_unconverted > 0
    ) {
      console.log(
        `✓ Sub-recipe rollup: ${summary.subrecipe_rollup_updated} recipes updated, ${summary.subrecipe_flags_set} new sub_recipe flags set, ${summary.subrecipe_rollup_cycles} cycle(s), ${summary.subrecipe_rollup_unconverted} unconverted line(s)`,
      );
    }
    if (summary.bom_lines > 0 && summary.bom_coverage_pct < 50) {
      console.warn(
        `⚠ yield coverage ${summary.bom_coverage_pct.toFixed(1)}% is below 50% — ingredient_yields seed may be stale vs current BOM ingredient names`,
      );
    }
    if (summary.pack_size_changes > 0) {
      console.warn(
        `⚠ T6: ${summary.pack_size_changes} vendor pack-size substitution(s) detected — review the pack_size_changes table / attention queue`,
      );
    }
    if (summary.excel_drift_warnings > 0) {
      console.warn(
        `⚠ D4: ${summary.excel_drift_warnings} Excel batch_cost drift warning(s) > $0.10 — see WARN lines above (audit ref: docs/audit/2026-05-08-codebase-audit.md §4 LOW)`,
      );
    }
  } finally {
    db.close();
  }
}

// Detect direct invocation so `import { ingestCosting }` from tests doesn't
// trigger the CLI path. Uses pathToFileURL to handle symlinks, spaces, and
// percent-encoding correctly (raw string-template form breaks on all three).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
