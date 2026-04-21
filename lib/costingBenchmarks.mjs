/**
 * T9 benchmark computations — pure functions over an open better-sqlite3
 * handle. Extracted from app/api/costing/route.js and app/api/unmapped/route.js
 * so the node --test harness can import them without going through Next.js
 * module resolution (which resolves extensionless TS/JS imports that raw
 * node does not).
 *
 * All three helpers take an already-open DB and the location id and return
 * plain JSON-shaped objects. No side effects, no network, no I/O beyond the
 * provided handle.
 */

import { normalizeIngredientKey } from './ingredientKey.ts';

/** T3-identical adjustment factor: 1 / (yield × (1 − loss)) with null defaults. */
function yieldAdjustment(yieldPct, lossFactor) {
  const y = yieldPct == null ? 1.0 : yieldPct;
  const l = lossFactor == null ? 0.0 : lossFactor;
  const denom = y * (1 - l);
  if (!(denom > 0) || !Number.isFinite(denom)) return null;
  return 1 / denom;
}

/**
 * B1 — per-recipe theoretical vs rolling-actual variance.
 *
 * theoretical = recipe_costs.cost_per_yield_unit  (yield-adjusted, T3 output)
 * actual      = batch_cost recomputed with the most-recently-imported
 *               vendor_prices row per ingredient (matched via normalized
 *               ingredient key), divided by recipe yield.
 *
 * Recipe-level exclusions: yield NULL or <= 0, theoretical NULL or <= 0, and
 * recipes where no BOM line can be priced (all lines guarded out). Remaining
 * recipes are sorted by variance_pct descending.
 */
export function computeCostVariance(db, locationId) {
  const recipes = db
    .prepare(
      `SELECT recipe_id, recipe_name, cost_per_yield_unit, yield
         FROM recipe_costs
        WHERE location_id = ?
          AND cost_per_yield_unit IS NOT NULL
          AND yield IS NOT NULL
          AND yield > 0`,
    )
    .all(locationId);

  const bomRows = db
    .prepare(
      `SELECT recipe_id, ingredient, qty, pack_price, pack_size, yield_pct, loss_factor
         FROM bom_lines
        WHERE location_id = ?`,
    )
    .all(locationId);

  // ingredient_key → latest vendor_prices row. Ordering by imported_at
  // (then id as tiebreaker) is durable against a future incremental-ingest
  // regime where rowid alone wouldn't reliably mean "most recent".
  const vpRows = db
    .prepare(
      `SELECT ingredient, pack_price, pack_size, id
         FROM vendor_prices
        WHERE location_id = ?
        ORDER BY imported_at DESC, id DESC`,
    )
    .all(locationId);
  const vpByKey = new Map();
  for (const r of vpRows) {
    const key = normalizeIngredientKey(r.ingredient ?? '');
    if (!key) continue;
    if (!vpByKey.has(key)) vpByKey.set(key, r);
  }

  const bomByRecipe = new Map();
  for (const r of bomRows) {
    if (!bomByRecipe.has(r.recipe_id)) bomByRecipe.set(r.recipe_id, []);
    bomByRecipe.get(r.recipe_id).push(r);
  }

  const perRecipe = [];
  for (const r of recipes) {
    const theoretical = r.cost_per_yield_unit;
    if (!(theoretical > 0)) continue;
    const lines = bomByRecipe.get(r.recipe_id) ?? [];
    let actualBatch = 0;
    let contributed = 0;
    for (const line of lines) {
      const { qty } = line;
      if (qty == null || !(qty > 0) || !Number.isFinite(qty)) continue;
      const key = normalizeIngredientKey(line.ingredient ?? '');
      const vp = key ? vpByKey.get(key) : null;
      // Fall back to the bom_line's own pack_price/pack_size when no vendor
      // match exists — ensures a fresh ingest still yields variance ≈ 0.
      const packPrice = vp?.pack_price ?? line.pack_price;
      const packSize = vp?.pack_size ?? line.pack_size;
      if (
        packPrice == null || packSize == null ||
        !(packPrice > 0) || !(packSize > 0) ||
        !Number.isFinite(packPrice) || !Number.isFinite(packSize)
      ) continue;
      const adj = yieldAdjustment(line.yield_pct, line.loss_factor);
      if (adj == null) continue;
      actualBatch += (qty * packPrice / packSize) * adj;
      contributed += 1;
    }
    if (contributed === 0) continue;
    const actual = actualBatch / r.yield;
    const variancePct = (Math.abs(actual - theoretical) / theoretical) * 100;
    perRecipe.push({
      recipe_id: r.recipe_id,
      recipe_name: r.recipe_name,
      theoretical: Math.round(theoretical * 10000) / 10000,
      actual: Math.round(actual * 10000) / 10000,
      variance_pct: Math.round(variancePct * 100) / 100,
    });
  }

  const variances = perRecipe.map((p) => p.variance_pct);
  const max = variances.length ? Math.max(...variances) : 0;
  const mean = variances.length
    ? variances.reduce((a, b) => a + b, 0) / variances.length
    : 0;
  const over5 = variances.filter((v) => v >= 5).length;
  perRecipe.sort((a, b) => b.variance_pct - a.variance_pct);

  return {
    max_variance_pct: Math.round(max * 100) / 100,
    mean_variance_pct: Math.round(mean * 100) / 100,
    recipes_over_5pct: over5,
    rows: perRecipe,
  };
}

/**
 * B2 — union-of-failures BOM queue.
 *
 * Priority (first match wins; single BOM row surfaces at most once):
 *   1. no_pack_size     — pack_size IS NULL
 *   2. no_price         — pack_price IS NULL
 *   3. no_yield         — yield_pct IS NULL AND ingredient key has no row in
 *                         ingredient_yields. A NULL yield_pct whose key IS
 *                         seeded is treated as "ingest hasn't run yet" — not
 *                         a data gap — and is NOT flagged.
 *   4. unmapped_status  — map_status NULL or not in {confirmed,mapped,auto_mapped}
 */
const GOOD_STATUSES = new Set(['confirmed', 'mapped', 'auto_mapped']);

export function computeUnmapped(db, locationId) {
  const rows = db
    .prepare(
      `SELECT b.id, b.recipe_id, b.ingredient, b.pack_price, b.pack_size,
              b.yield_pct, b.map_status,
              r.recipe_name
         FROM bom_lines b
         LEFT JOIN recipe_costs r
           ON r.recipe_id = b.recipe_id AND r.location_id = b.location_id
        WHERE b.location_id = ?`,
    )
    .all(locationId);

  const yieldKeys = new Set(
    db.prepare('SELECT ingredient_key FROM ingredient_yields').all().map((r) => r.ingredient_key),
  );

  const totalItems = rows.length;
  const unmapped = [];

  for (const r of rows) {
    let reason = null;
    if (r.pack_size == null) {
      reason = 'no_pack_size';
    } else if (r.pack_price == null) {
      reason = 'no_price';
    } else if (r.yield_pct == null) {
      const key = normalizeIngredientKey(r.ingredient ?? '');
      if (!key || !yieldKeys.has(key)) {
        reason = 'no_yield';
      }
    }
    if (reason === null) {
      const status = r.map_status;
      if (status == null || !GOOD_STATUSES.has(status)) {
        reason = 'unmapped_status';
      }
    }
    if (reason !== null) {
      unmapped.push({
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name ?? null,
        ingredient: r.ingredient ?? '',
        reason,
      });
    }
  }

  const unmappedCount = unmapped.length;
  const unmappedPct = totalItems > 0
    ? Math.round((unmappedCount / totalItems) * 10000) / 100
    : 0;

  return {
    total_items: totalItems,
    unmapped_count: unmappedCount,
    unmapped_pct: unmappedPct,
    rows: unmapped.slice(0, 50),
  };
}

/**
 * B3 — last costing ingest run, with age in whole minutes since started_at.
 *
 * SQLite's datetime('now', 'subsec') returns a UTC string without the 'Z'
 * suffix; we append it before parsing so Date.parse doesn't mistake it for
 * local time (which would fabricate a 6-hour "age" depending on the
 * machine's timezone).
 */
export function readLastCostingIngest(db) {
  const row = db
    .prepare(
      `SELECT id, kind, started_at, finished_at, rows_in, rows_out, status
         FROM ingest_runs
        WHERE kind = 'costing'
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    )
    .get();
  if (!row) return { last_run_at: null, last_status: null, age_minutes: null };
  const iso = /Z$/.test(row.started_at) ? row.started_at : `${row.started_at}Z`;
  const t = Date.parse(iso);
  const age = Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : null;
  return {
    last_run_at: row.started_at,
    last_status: row.status,
    age_minutes: age,
  };
}
