#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { normalizeIngredientKey } from '../lib/ingredientKey.ts';
import {
  convertQty,
  normalizeUnit,
  unitDimension,
  WEIGHT_TO_G,
  VOLUME_TO_ML,
} from '../lib/unitConvert.mjs';

/**
 * T4.1 count-bridge. Converts a quantity of a count unit (ea / bunch / can /
 * …) into a weight or volume unit using a per-ingredient grams-per-unit
 * lookup as the anchor. Returns `null` on any failure path so the caller can
 * fall back to `convertQty` or flag the row.
 *
 *   count → weight:  qty × g_per_unit = g  →  g / WEIGHT_TO_G[to]
 *   count → volume:  qty × g_per_unit = g  →  (g / density) / VOLUME_TO_ML[to]
 *   weight → count:  qty × WEIGHT_TO_G[from] = g  →  g / g_per_unit[to]
 *   volume → count:  qty × VOLUME_TO_ML[from] × density = g  →  g / g_per_unit[to]
 *   count → count:   different units bridged via grams.
 *
 * Assumes `fromCanon` / `toCanon` are already normalized by `normalizeUnit`.
 * `unitWeights` is a Map<string,number> keyed on canonical count unit →
 * grams-per-one, scoped to the specific ingredient (typically
 * `unitWeightByKey.get(normalizeIngredientKey(ingredient))`). May be
 * undefined — treated as empty.
 *
 * @param {number} qty
 * @param {string} fromCanon
 * @param {string} toCanon
 * @param {number | null | undefined} density g/ml
 * @param {Map<string,number> | undefined} unitWeights
 * @returns {number | null}
 */
export function bridgeCount(qty, fromCanon, toCanon, density, unitWeights) {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) return null;
  if (!fromCanon || !toCanon) return null;
  if (fromCanon === toCanon) return qty;

  const fromDim = unitDimension(fromCanon);
  const toDim = unitDimension(toCanon);
  if (!fromDim || !toDim) return null;
  if (fromDim !== 'count' && toDim !== 'count') return null; // nothing to bridge

  const gramsFromCount = (q, canon) => {
    const g = unitWeights?.get(canon);
    return g != null && g > 0 && Number.isFinite(g) ? q * g : null;
  };
  const countFromGrams = (g, canon) => {
    const w = unitWeights?.get(canon);
    return w != null && w > 0 && Number.isFinite(w) ? g / w : null;
  };

  let grams;
  if (fromDim === 'count') {
    grams = gramsFromCount(qty, fromCanon);
  } else if (fromDim === 'weight') {
    const f = WEIGHT_TO_G[fromCanon];
    if (!(f > 0)) return null;
    grams = qty * f;
  } else {
    // volume → grams requires density.
    if (density == null || !Number.isFinite(density) || !(density > 0)) return null;
    const f = VOLUME_TO_ML[fromCanon];
    if (!(f > 0)) return null;
    grams = qty * f * density;
  }
  if (grams == null || !Number.isFinite(grams) || grams < 0) return null;

  if (toDim === 'count') return countFromGrams(grams, toCanon);
  if (toDim === 'weight') {
    const t = WEIGHT_TO_G[toCanon];
    if (!(t > 0)) return null;
    return grams / t;
  }
  // volume
  if (density == null || !Number.isFinite(density) || !(density > 0)) return null;
  const t = VOLUME_TO_ML[toCanon];
  if (!(t > 0)) return null;
  return (grams / density) / t;
}

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
 * }} Summary of rows inserted, yield coverage, yield-adjustment totals, and
 *    count of BOM rows flagged `map_status='NEEDS_DENSITY'` by the T4
 *    volume↔weight conversion pass (these surface in B2's unmapped queue).
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
    summaryResult = _ingestCostingImpl(db, data, locationId);
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

function _ingestCostingImpl(db, data, locationId) {
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
  };

  const del = (sql) => db.prepare(sql).run(locationId);

  db.transaction(() => {
    del('DELETE FROM vendor_prices WHERE location_id = ?');
    del('DELETE FROM recipe_costs WHERE location_id = ?');
    del('DELETE FROM bom_lines WHERE location_id = ?');
    del('DELETE FROM ingredient_maps WHERE location_id = ?');
    del('DELETE FROM order_guide_items WHERE location_id = ?');

    // Named parameters — D3 in MAPPING_ENGINE_GAPS.md. Positional `?` lists
    // silently succeed when the schema gains a column (new slot stays NULL).
    // Named binds force a schema match at prepare-time.
    const ivp = db.prepare(`
      INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, yield_pct, location_id)
      VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @pack_price, @unit_price, @category, @yield_pct, @location_id)
    `);
    for (const r of data.vendor_prices || []) {
      const y = lookup(r.ingredient);
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
      iim.run({
        recipe_ingredient: r.recipe_ingredient,
        vendor_ingredient: r.vendor_ingredient ?? '',
        status: r.status ?? '',
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
  };
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

    let packSizeInBomUnit;
    const bomCanon = normalizeUnit(bomUnit);
    const packCanon = normalizeUnit(packUnit);
    if (!packCanon) {
      // No vendor_prices row for this ingredient, or vendor row has an empty
      // pack_unit — no way to dim-check. Fall back to T3's identity
      // assumption (treat pack_size as already in the bom_line's unit) so a
      // costing workbook without vendor sheets still computes deltas. B2
      // already surfaces "unmapped_status" and no_price reasons, and the
      // variance benchmark would flag gross inaccuracies downstream.
      packSizeInBomUnit = pack_size;
    } else if (!bomCanon) {
      // bom_line unit is empty/unknown but vendor pack_unit is present: we
      // can't interpret the ratio. Flag and skip.
      if (!PROTECTED_MAP_STATUSES.has(map_status ?? '')) needsDensityIds.push(id);
      denomConvertedSkipped++;
      continue;
    } else if (bomCanon === packCanon) {
      // Identity — no conversion needed, preserves T3's byte-exact same-unit path.
      packSizeInBomUnit = pack_size;
    } else {
      // T4.1: try count-bridge FIRST when either side is a count unit — the
      // generic convertQty never returns non-null for count involvement, so
      // attempting bridgeCount before convertQty keeps a single code path.
      // The bridge uses grams as the intermediate: count → g (via
      // unitWeightByKey), g → volume (via density) as needed.
      const bridged = bridgeCount(pack_size, packCanon, bomCanon, density, unitWeightByKey.get(key));
      if (bridged !== null) {
        packSizeInBomUnit = bridged;
      } else {
        packSizeInBomUnit = convertQty(pack_size, packUnit, bomUnit, density);
      }
      if (packSizeInBomUnit === null || !(packSizeInBomUnit > 0) || !Number.isFinite(packSizeInBomUnit)) {
        // Cross-dim without density, count involvement without unit_weight,
        // unknown unit — flag and skip.
        if (!PROTECTED_MAP_STATUSES.has(map_status ?? '')) needsDensityIds.push(id);
        denomConvertedSkipped++;
        continue;
      }
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

  // Flag rows that need density (or any other unit-conversion failure). B2's
  // computeUnmapped treats any map_status not in
  // {confirmed,mapped,auto_mapped} as reason='unmapped_status', so the new
  // NEEDS_DENSITY rows appear in the queue without further wiring.
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
      // recipe_id='TOTAL' is a summary row from Excel's Recipe Cost Summary
      // sheet — it has no bom_lines of its own but gets INSERTed verbatim by
      // the ingest. Skip it here so the per-recipe delta doesn't land on the
      // summary (which would double-apply once we update TOTAL below).
      // Defensive: bom_lines should never carry recipe_id='TOTAL' anyway.
      if (recipe_id === 'TOTAL') continue;
      const result = updateRecipe.run({ recipe_id, delta, location_id: locationId });
      if (result.changes > 0) {
        adjustedCount++;
        totalDelta += delta;
        if (Math.abs(delta) > Math.abs(maxPerRecipeDelta)) maxPerRecipeDelta = delta;
      }
    }
    // Keep the summary row in sync: TOTAL must equal SUM(individual
    // batch_cost). Without this, dashboards / audits that trust TOTAL see a
    // stale pre-T3 value while the per-recipe sum reflects the yield-adjusted
    // delta. Guard: only update if the row actually exists and has a batch_cost.
    if (totalDelta !== 0) {
      updateRecipe.run({ recipe_id: 'TOTAL', delta: totalDelta, location_id: locationId });
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

  return summary;
}

/**
 * T5b.3 — join the most recent per-(vendor, sku) invoice catch-weight
 * reconciliation into vendor_prices. Writes both actual_received_lb and
 * reconciled_unit_price on matching vendor_prices rows; leaves unchanged
 * rows that have no invoice match. Runs in a single transaction.
 *
 * Only Shamrock is wired for now because its invoice history lives in
 * the shamrock_invoices table. Sysco invoices live in vendor_summary.json
 * (file-cached); a future follow-up can import that into a sibling table
 * and extend this function to scan both sources.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [locationId='default']
 * @returns {{updated: number}}
 */
export function backfillCatchWeightsIntoVendorPrices(db, locationId = 'default') {
  const out = { updated: 0 };
  // Guard: shamrock_invoices may be absent on fresh DBs where the ingest
  // hasn't run yet. vendor_prices.actual_received_lb / reconciled_unit_price
  // likewise require the T5a migration. Either missing → skip cleanly.
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  if (!tables.has('shamrock_invoices') || !tables.has('vendor_prices')) return out;
  const vpCols = new Set(
    db.prepare('PRAGMA table_info(vendor_prices)').all().map((c) => c.name),
  );
  if (!vpCols.has('actual_received_lb') || !vpCols.has('reconciled_unit_price')) return out;

  // Latest catch-weight row per SKU, preferring rows with non-NULL
  // reconciled_unit_price so the dashboard surfaces actual drift first.
  const latest = db.prepare(`
    SELECT sku, actual_received_lb, reconciled_unit_price
      FROM shamrock_invoices
     WHERE location_id = ?
       AND actual_received_lb IS NOT NULL
       AND sku IS NOT NULL AND sku != ''
     GROUP BY sku
     HAVING delivery_date = MAX(delivery_date)
  `).all(locationId);

  if (latest.length === 0) return out;

  const upd = db.prepare(`
    UPDATE vendor_prices
       SET actual_received_lb = @actual_received_lb,
           reconciled_unit_price = @reconciled_unit_price
     WHERE vendor = 'shamrock'
       AND sku = @sku
       AND location_id = @location_id
  `);
  db.transaction(() => {
    for (const row of latest) {
      const r = upd.run({
        sku: row.sku,
        actual_received_lb: row.actual_received_lb,
        reconciled_unit_price: row.reconciled_unit_price ?? null,
        location_id: locationId,
      });
      out.updated += r.changes;
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
    if (summary.bom_lines > 0 && summary.bom_coverage_pct < 50) {
      console.warn(
        `⚠ yield coverage ${summary.bom_coverage_pct.toFixed(1)}% is below 50% — ingredient_yields seed may be stale vs current BOM ingredient names`,
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
