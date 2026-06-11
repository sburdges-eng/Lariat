import type { Database } from 'better-sqlite3';
import { rollupRecipeCosts } from './rollupRecipeCosts.ts';

/**
 * Refresh `recipe_costs.batch_cost` for a location.
 *
 * Delegates to `rollupRecipeCosts(db, locationId)`, which:
 *   - walks the recipe DAG in topological order,
 *   - prices each recipe from BOM lines (vendor_prices for leaves, prior
 *     rolled child cost for sub-recipe references, via convertQty),
 *   - writes the result to `recipe_costs.batch_cost`,
 *   - leaves `recipe_costs.cost_per_yield_unit` untouched (Excel theoretical
 *     baseline preserved — the variance tile compares these two).
 *
 * The previous implementation iterated `computeCostVariance(db, loc).rows` and
 * wrote `actual * yield` per recipe; that path excluded any recipe with a
 * high unmatched ratio (including all sub-recipe-bearing recipes). The
 * rollup-based path handles them.
 *
 * Semantic contract (unchanged):
 *   - `recipe_costs.cost_per_yield_unit` = Excel theoretical baseline (never overwritten here)
 *   - `recipe_costs.batch_cost`          = engine actual (refreshed on every call)
 *
 * repriceLeafOnly: this live-recompute path rewrites EVERY recipe, including
 * leaf-only ones, from the latest vendor prices. The ingest post-pass calls
 * rollupRecipeCosts without it so the T4 unit-converted yield-delta numbers
 * survive ingest.
 */
export function recomputeRecipeCosts(db: Database, locationId: string) {
  rollupRecipeCosts(db, locationId, { repriceLeafOnly: true });
}
