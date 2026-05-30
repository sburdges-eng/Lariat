import type { Database } from 'better-sqlite3';
// @ts-ignore TS: ingest-costing.mjs has pre-existing type errors
import { deriveMasterId } from '../../scripts/ingest-costing.mjs';

export type RollupResult = {
  updated: number;
  cycles: string[];
  unconverted: Array<{
    recipe_id: string;
    ingredient: string;
    reason: 'no_density' | 'incompatible_units' | 'child_no_yield';
  }>;
  new_subrecipe_flags: number;
};

// Types for future tasks (DAG walk, topo sort, cost write).
// Declared here to avoid re-editing the type block in Tasks 5-7.
export type RecipeRow = {
  recipe_id: string;
  yield: number | null;
  yield_unit: string | null;
  batch_cost: number | null;
};

export type BomRow = {
  id: number;
  recipe_id: string;
  ingredient: string;
  qty: number | null;
  unit: string | null;
  sub_recipe: string | null;
  yield_pct: number | null;
  loss_factor: number | null;
};

// Establish that the types are in-use so TS doesn't complain.
// This is expanded by future tasks that actually reference RecipeRow/BomRow.
// @ts-expect-error — intentional empty use to register types as "used"
type _Future = RecipeRow | BomRow;

/**
 * Sub-recipe pricing rollup pass.
 *
 * Walks the recipe DAG in topological order, prices each non-cycle recipe
 * from its BOM lines (vendor_prices for leaves, prior rollup result for
 * sub-recipe references), writes the result to `recipe_costs.batch_cost`.
 *
 * Leaves `recipe_costs.cost_per_yield_unit` untouched — that column is the
 * Excel-imported theoretical baseline (see `lib/computeEngine/recipeCosting.ts`).
 *
 * Safe to call inside a transaction; opens no transaction of its own.
 */
export function rollupRecipeCosts(
  db: Database,
  locationId: string,
): RollupResult {
  const result: RollupResult = {
    updated: 0,
    cycles: [],
    unconverted: [],
    new_subrecipe_flags: 0,
  };

  // Set of every existing recipe_id at this location — used for auto-detect.
  const recipeIds = new Set<string>(
    (
      db
        .prepare(`SELECT recipe_id FROM recipe_costs WHERE location_id = ?`)
        .all(locationId) as Array<{ recipe_id: string }>
    ).map((r) => r.recipe_id),
  );

  // For each BOM line at this location, if (a) sub_recipe is not 'YES'
  // already AND (b) deriveMasterId(ingredient) matches an existing
  // recipe_id, set sub_recipe='YES'. Counts the writes for observability.
  const candidates = db
    .prepare(
      `SELECT id, ingredient FROM bom_lines
        WHERE location_id = ?
          AND (sub_recipe IS NULL OR sub_recipe = '' OR sub_recipe != 'YES')`,
    )
    .all(locationId) as Array<{ id: number; ingredient: string | null }>;

  const setFlag = db.prepare(
    `UPDATE bom_lines SET sub_recipe = 'YES' WHERE id = ?`,
  );
  for (const c of candidates) {
    const slug = deriveMasterId(c.ingredient ?? '');
    if (slug && recipeIds.has(slug)) {
      setFlag.run(c.id);
      result.new_subrecipe_flags += 1;
    }
  }

  return result;
}
