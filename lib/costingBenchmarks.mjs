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
 * T7 — merged-cost resolver for a master_id across vendor_prices rows.
 *
 * Given a master and the set of `vendor_prices` rows pointing at it,
 * produce a single `{pack_price, pack_size}` that represents the
 * "one merged cost" answer. Rule (v1, documented in MAPPING_ENGINE_GAPS.md
 * T7 section):
 *   1. If `ingredient_masters.preferred_vendor` is set AND any of the
 *      provided vendor_prices rows belongs to that vendor, use the most
 *      recent row from that vendor.
 *   2. Otherwise, simple mean of `(pack_price, pack_size)` across the
 *      latest row per distinct vendor. "Latest" uses the caller-provided
 *      array order — callers SHOULD pass rows sorted `imported_at DESC,
 *      id DESC` (same ordering as everywhere else in this file).
 *
 * Why simple mean and not a weighted avg by invoice volume:
 *   - vendor_prices has no volume column; the only signal would be
 *     pack_size × pack_price, which implicitly weights bigger packs
 *     higher without reflecting actual procurement volume.
 *   - Operators who know which vendor they buy from most set
 *     preferred_vendor — that's the primary signal. Mean is a safe
 *     fallback for pre-curated DBs, not the target steady-state.
 *
 * Returns null when no non-zero pack_price / pack_size row is available.
 *
 * @param {{vendor: string | null, pack_price: number | null, pack_size: number | null}[]} rows
 * @param {string | null} preferredVendor
 * @returns {{pack_price: number, pack_size: number, source: 'preferred_vendor' | 'mean'} | null}
 */
export function resolveMergedCost(rows, preferredVendor) {
  // Filter out degenerate rows up-front so both branches see the same data.
  const usable = (rows ?? []).filter((r) =>
    r != null &&
    r.pack_price != null && r.pack_size != null &&
    r.pack_price > 0 && r.pack_size > 0 &&
    Number.isFinite(r.pack_price) && Number.isFinite(r.pack_size),
  );
  if (usable.length === 0) return null;

  if (preferredVendor) {
    const hit = usable.find((r) => r.vendor === preferredVendor);
    if (hit) {
      return {
        pack_price: hit.pack_price,
        pack_size: hit.pack_size,
        source: 'preferred_vendor',
      };
    }
  }

  // Latest-per-vendor mean. Iteration order is caller-provided — when
  // rows arrive sorted by imported_at DESC, the first-seen row per vendor
  // is the most recent.
  const seen = new Set();
  const latest = [];
  for (const r of usable) {
    const v = r.vendor ?? '';
    if (seen.has(v)) continue;
    seen.add(v);
    latest.push(r);
  }
  const n = latest.length;
  if (n === 0) return null;
  const price = latest.reduce((s, r) => s + r.pack_price, 0) / n;
  const size = latest.reduce((s, r) => s + r.pack_size, 0) / n;
  return { pack_price: price, pack_size: size, source: 'mean' };
}

/**
 * B1 — per-recipe theoretical vs rolling-actual variance.
 *
 * theoretical = recipe_costs.cost_per_yield_unit  (yield-adjusted, T3 output)
 * actual      = batch_cost recomputed with the most-recently-imported
 *               vendor_prices row per ingredient (matched via normalized
 *               ingredient key, or — T7 — per master_id when both sides
 *               carry one), divided by recipe yield.
 *
 * T7 join: when `bom_lines.master_id` AND any `vendor_prices.master_id`
 * rows are both populated for an ingredient, aggregation happens per
 * master_id via `resolveMergedCost` (preferred_vendor with mean fallback).
 * When either side is NULL the code falls back to the legacy normalized-
 * ingredient-key path so a partial T7 backfill doesn't strand rows.
 *
 * D6 (debt-bundle-d): the legacy fallback to the BOM row's own
 * `pack_price` / `pack_size` when NO `vendor_prices` row matches has been
 * removed. Such lines are counted as `unmatched` and do NOT contribute
 * to the actual cost. A recipe whose unmatched ratio exceeds
 * `UNMATCHED_THRESHOLD` (default 0.30) is excluded from the variance
 * aggregate with `exclusion_reason='high_unmatched_ratio'` — the B1
 * tile is only meaningful when the vendor-price coverage is sound.
 * Recipes below the threshold still contribute to the aggregate but
 * carry `unmatched_lines > 0` so the UI can render a warning pip.
 *
 * Recipe-level exclusions: yield NULL or <= 0, theoretical NULL or <= 0, and
 * recipes where no BOM line can be priced (all lines guarded out). Remaining
 * recipes are sorted by variance_pct descending.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} locationId
 * @param {{ unmatchedThreshold?: number }} [opts]
 */
export const DEFAULT_UNMATCHED_THRESHOLD = 0.30;

export function computeCostVariance(db, locationId, opts = {}) {
  const unmatchedThreshold = opts.unmatchedThreshold ?? DEFAULT_UNMATCHED_THRESHOLD;
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
      `SELECT recipe_id, ingredient, master_id, qty, pack_price, pack_size,
              yield_pct, loss_factor
         FROM bom_lines
        WHERE location_id = ?`,
    )
    .all(locationId);

  // ingredient_key → latest vendor_prices row AND master_id → [rows].
  // Ordering by imported_at (then id as tiebreaker) is durable against a
  // future incremental-ingest regime where rowid alone wouldn't reliably
  // mean "most recent". The per-master map holds ALL rows for the master
  // (not just the latest) so `resolveMergedCost` can run the mean
  // fallback across distinct vendors.
  const vpRows = db
    .prepare(
      `SELECT ingredient, master_id, vendor, pack_price, pack_size, id
         FROM vendor_prices
        WHERE location_id = ?
        ORDER BY imported_at DESC, id DESC`,
    )
    .all(locationId);
  const vpByKey = new Map();
  const vpByMaster = new Map();
  for (const r of vpRows) {
    const key = normalizeIngredientKey(r.ingredient ?? '');
    if (key && !vpByKey.has(key)) vpByKey.set(key, r);
    if (r.master_id) {
      let arr = vpByMaster.get(r.master_id);
      if (!arr) { arr = []; vpByMaster.set(r.master_id, arr); }
      arr.push(r);
    }
  }

  // Preferred-vendor lookup for resolveMergedCost. Read once, reuse per
  // line — cheap even on DBs with hundreds of masters.
  const preferredByMaster = new Map();
  if (vpByMaster.size > 0) {
    const masterRows = db.prepare(
      `SELECT master_id, preferred_vendor FROM ingredient_masters`,
    ).all();
    for (const r of masterRows) {
      preferredByMaster.set(r.master_id, r.preferred_vendor ?? null);
    }
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

    // D6 counters.
    //   total_lines  — BOM lines on this recipe that ARE cost-eligible
    //                  (qty > 0, yield_pct/loss_factor resolvable). Lines
    //                  guarded out for bad qty/yield are noise, not
    //                  unmapped-mapping signal, and are dropped from both
    //                  numerator and denominator here.
    //   unmatched    — cost-eligible lines where NO vendor_prices row
    //                  matched (via master_id OR normalized ingredient
    //                  key). Pre-D6, these silently fell back to the
    //                  BOM row's own pack_price/pack_size, yielding
    //                  variance=0 on fresh ingest even when the mapping
    //                  engine had zero coverage. Post-D6 they are
    //                  excluded from the actual-cost calculation and
    //                  counted for the ratio gate.
    let actualBatch = 0;
    let contributed = 0;
    let totalLines = 0;
    let unmatchedLines = 0;
    for (const line of lines) {
      const { qty } = line;
      if (qty == null || !(qty > 0) || !Number.isFinite(qty)) continue;
      const adj = yieldAdjustment(line.yield_pct, line.loss_factor);
      if (adj == null) continue;
      totalLines += 1;

      // T7: prefer master_id join when both sides carry one. The merged
      // cost is the master's preferred_vendor row if available, else
      // the mean across latest-per-vendor rows. Fall back to the
      // normalized-ingredient-key path when the master isn't populated
      // on either side yet — graceful degradation during a partial
      // T7 backfill so rows aren't stranded mid-migration.
      //
      // D6: if NEITHER master_id nor normalized-ingredient-key lookup
      // lands a vendor_prices row, the line counts as unmatched and is
      // skipped. The pre-D6 fallback to line.pack_price / line.pack_size
      // is gone — an unmapped ingredient produces a warning signal, not
      // a fabricated "variance = 0".
      let packPrice = null;
      let packSize = null;
      let matched = false;
      if (line.master_id && vpByMaster.has(line.master_id)) {
        const merged = resolveMergedCost(
          vpByMaster.get(line.master_id),
          preferredByMaster.get(line.master_id) ?? null,
        );
        if (merged) {
          packPrice = merged.pack_price;
          packSize = merged.pack_size;
          matched = true;
        }
      }
      if (!matched) {
        const key = normalizeIngredientKey(line.ingredient ?? '');
        const vp = key ? vpByKey.get(key) : null;
        if (vp && vp.pack_price != null && vp.pack_size != null) {
          packPrice = vp.pack_price;
          packSize = vp.pack_size;
          matched = true;
        }
      }

      if (!matched) {
        unmatchedLines += 1;
        continue;
      }

      if (
        packPrice == null || packSize == null ||
        !(packPrice > 0) || !(packSize > 0) ||
        !Number.isFinite(packPrice) || !Number.isFinite(packSize)
      ) {
        // Matched row exists but its numerics are degenerate. Treat as
        // unmatched for D6 purposes — a 0 / NaN / infinite pack_price is
        // just as misleading as a missing row for variance math.
        unmatchedLines += 1;
        continue;
      }
      actualBatch += (qty * packPrice / packSize) * adj;
      contributed += 1;
    }

    // Nothing cost-eligible: drop the recipe entirely (pre-D6 behavior).
    if (totalLines === 0) continue;

    const unmatchedRatio = unmatchedLines / totalLines;
    if (unmatchedRatio > unmatchedThreshold) {
      // Excluded from aggregates — variance would be misleading. We
      // still emit the row so the UI can surface the exclusion reason
      // and counts. theoretical stays populated; actual/variance are
      // null because they can't be computed with coverage this sparse.
      perRecipe.push({
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name,
        theoretical: Math.round(theoretical * 10000) / 10000,
        actual: null,
        variance_pct: null,
        total_lines: totalLines,
        unmatched_lines: unmatchedLines,
        excluded: true,
        exclusion_reason: 'high_unmatched_ratio',
      });
      continue;
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
      total_lines: totalLines,
      unmatched_lines: unmatchedLines,
      excluded: false,
      exclusion_reason: null,
    });
  }

  // Aggregate only over non-excluded rows with numeric variance_pct.
  const included = perRecipe.filter((p) => !p.excluded && p.variance_pct != null);
  const variances = included.map((p) => p.variance_pct);
  const max = variances.length ? Math.max(...variances) : 0;
  const mean = variances.length
    ? variances.reduce((a, b) => a + b, 0) / variances.length
    : 0;
  const over5 = variances.filter((v) => v >= 5).length;
  const over2 = variances.filter((v) => v >= 2 && v < 5).length;
  const excludedHighUnmatched = perRecipe.filter(
    (p) => p.excluded && p.exclusion_reason === 'high_unmatched_ratio',
  ).length;

  // Sort excluded rows to the END of the list (variance_pct=null). Within
  // each bucket, descending variance_pct; excluded rows retain insertion
  // order for stability.
  perRecipe.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (a.variance_pct == null && b.variance_pct == null) return 0;
    if (a.variance_pct == null) return 1;
    if (b.variance_pct == null) return -1;
    return b.variance_pct - a.variance_pct;
  });

  return {
    max_variance_pct: Math.round(max * 100) / 100,
    mean_variance_pct: Math.round(mean * 100) / 100,
    recipes_over_5pct: over5,
    rows: perRecipe,
    summary: {
      healthy: included.length - over5 - over2,
      yellow: over2,
      red: over5,
      excluded_high_unmatched: excludedHighUnmatched,
    },
  };
}

/**
 * B2 — union-of-failures queue.
 *
 * Two sources, unioned into a single payload:
 *
 *   1. `bom_lines` (kind='bom_line', priority-ranked reason; first match
 *      wins so a single BOM row surfaces at most once):
 *        a. no_pack_size     — pack_size IS NULL
 *        b. no_price         — pack_price IS NULL
 *        c. no_yield         — yield_pct IS NULL AND ingredient key has no
 *                              row in ingredient_yields. A NULL yield_pct
 *                              whose key IS seeded is treated as "ingest
 *                              hasn't run yet" — not a data gap.
 *        d. unmapped_status  — map_status NULL or not in
 *                              {confirmed,mapped,auto_mapped}
 *
 *   2. `vendor_prices` rows with `map_status='PACK_CHANGED'` (T6).
 *      Kind='vendor_pack_change', reason='pack_changed'. This is the
 *      run-scoped signal; the DURABLE source is
 *      `pack_size_changes.acknowledged=0` which is surfaced as a
 *      summary counter (`pack_size_changes_unacknowledged`) without
 *      expanding each row into the unmapped payload.
 *
 * `total_items` counts only bom_lines (the historical denominator for
 * "unmapped %"); vendor_pack_change rows are additive attention-queue
 * signal and shouldn't inflate the BOM coverage denominator. The
 * `unmapped_count` is `bom_unmapped + vendor_pack_change` so the tile
 * shows the full attention load. No key collision risk — bom_lines row
 * keys are `bom:<id>` and vendor_prices keys are `vp:<id>`.
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
        kind: 'bom_line',
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name ?? null,
        ingredient: r.ingredient ?? '',
        reason,
      });
    }
  }

  // T6 B2 extension: vendor_prices rows the ingest flagged PACK_CHANGED.
  // Each row surfaces as a separate attention-queue entry with its own
  // reason string so the UI can render distinct copy (a pack-size swap
  // is actionable in a different way from an unmapped BOM line).
  //
  // Guarded SELECT: a fresh DB created before T6's vendor_prices
  // migration might not carry `map_status` on vendor_prices. The
  // assertion in lib/db.ts should prevent that in practice, but we
  // wrap in try/catch to avoid crashing the endpoint on a half-migrated
  // test DB.
  let packChanged = [];
  try {
    packChanged = db.prepare(
      `SELECT id, ingredient, vendor, sku
         FROM vendor_prices
        WHERE location_id = ?
          AND map_status = 'PACK_CHANGED'
        ORDER BY id DESC`,
    ).all(locationId);
  } catch { packChanged = []; }
  for (const r of packChanged) {
    unmapped.push({
      kind: 'vendor_pack_change',
      recipe_id: null,
      recipe_name: null,
      ingredient: r.ingredient ?? '',
      vendor: r.vendor ?? null,
      sku: r.sku ?? null,
      reason: 'pack_changed',
    });
  }

  // Durable pack-size attention queue: count only, not per-row. The
  // ingest's run-scoped map_status=PACK_CHANGED flag above covers the
  // "detected THIS run" case; this count covers the "still unackd from
  // any prior run" case. Operators clear by UPDATE SET acknowledged=1.
  let packSizeChangesUnacknowledged = 0;
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0`,
    ).get();
    packSizeChangesUnacknowledged = row?.c ?? 0;
  } catch { /* pack_size_changes table absent in legacy DB */ }

  const unmappedCount = unmapped.length;
  const unmappedPct = totalItems > 0
    ? Math.round((unmappedCount / totalItems) * 10000) / 100
    : 0;

  return {
    total_items: totalItems,
    unmapped_count: unmappedCount,
    unmapped_pct: unmappedPct,
    pack_size_changes_unacknowledged: packSizeChangesUnacknowledged,
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
