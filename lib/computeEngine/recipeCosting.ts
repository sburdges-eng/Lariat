import type { Database } from 'better-sqlite3';
import { computeCostVariance } from '../costingBenchmarks.mjs';

/**
 * Refresh `recipe_costs.batch_cost` + `.cost_per_yield_unit` from current
 * `vendor_prices` for a location.
 *
 * We delegate the per-recipe cost computation to `computeCostVariance`
 * from `lib/costingBenchmarks.mjs` so that the live compute-engine path
 * and the established T9/B1 variance-tile path use **one** ingredient →
 * price resolver. That resolver is T7-aware (master_id + preferred_vendor
 * via `resolveMergedCost`) and D6-aware (high-unmatched recipes are
 * excluded from the refresh so we don't persist a fabricated cost for a
 * recipe whose BOM doesn't actually match any vendor rows).
 *
 * Prior to this refactor recipeCosting.ts re-implemented matching via a
 * raw SQL join (`b.vendor_ingredient = v.ingredient OR b.ingredient =
 * v.ingredient`) plus a `GROUP BY ingredient HAVING MAX(imported_at)`
 * pattern that is non-deterministic in SQLite when a GROUP's non-
 * aggregated columns are referenced — docs/COMPUTE_ENGINE_REVIEW C1/C4.
 */
export function recomputeRecipeCosts(db: Database, locationId: string) {
  // Variance rows carry per-recipe `actual` = cost per yield unit. We
  // need `batch_cost = actual * yield`, so fetch yields in a side map.
  const yieldsByRecipe = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT recipe_id, yield FROM recipe_costs WHERE location_id = ?`,
    )
    .all(locationId) as Array<{ recipe_id: string; yield: number | null }>) {
    if (r.yield != null && r.yield > 0) yieldsByRecipe.set(r.recipe_id, r.yield);
  }

  const variance = computeCostVariance(db, locationId);

  const update = db.prepare(`
    UPDATE recipe_costs
       SET batch_cost = @batch_cost,
           cost_per_yield_unit = @cost_per_yield_unit
     WHERE recipe_id = @recipe_id
       AND location_id = @location_id
  `);

  db.transaction(() => {
    for (const row of variance.rows) {
      if (row.excluded || row.actual == null) continue;
      const y = yieldsByRecipe.get(row.recipe_id);
      if (!y) continue;
      update.run({
        batch_cost: row.actual * y,
        cost_per_yield_unit: row.actual,
        recipe_id: row.recipe_id,
        location_id: locationId,
      });
    }
  })();
}
