import type { Database } from 'better-sqlite3';
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

/**
 * Build the parent → children adjacency map for the recipe DAG.
 *
 * A child is any sub-recipe referenced by a BOM line on the parent —
 * either via sub_recipe='YES' OR via auto-detect (the line's
 * deriveMasterId(ingredient) matches an existing recipe_id).
 *
 * Exported for testing only; not part of the public surface.
 */
export function _buildRecipeDag(
  db: Database,
  locationId: string,
): { children: Map<string, string[]>; recipeIds: Set<string> } {
  const recipeIds = new Set<string>(
    (
      db
        .prepare(`SELECT recipe_id FROM recipe_costs WHERE location_id = ?`)
        .all(locationId) as Array<{ recipe_id: string }>
    ).map((r) => r.recipe_id),
  );

  const children = new Map<string, string[]>();
  for (const id of recipeIds) children.set(id, []);

  const bomRows = db
    .prepare(
      `SELECT recipe_id, ingredient, sub_recipe FROM bom_lines WHERE location_id = ?`,
    )
    .all(locationId) as Array<{
      recipe_id: string;
      ingredient: string | null;
      sub_recipe: string | null;
    }>;

  for (const r of bomRows) {
    if (!children.has(r.recipe_id)) continue; // BOM points at a recipe row we don't have
    const slug = deriveMasterId(r.ingredient ?? '');
    if (!slug) continue;
    const isSubRecipe = r.sub_recipe === 'YES' || recipeIds.has(slug);
    if (!isSubRecipe) continue;
    if (!recipeIds.has(slug)) continue; // flag says YES but child doesn't exist
    const arr = children.get(r.recipe_id)!;
    if (!arr.includes(slug)) arr.push(slug);
  }

  return { children, recipeIds };
}

/**
 * Kahn's algorithm. Returns a leaves-first topological order over the DAG
 * AND the set of recipe_ids that participate in any cycle (i.e. were never
 * enqueued because they still have unresolved in-degree after the queue
 * empties).
 *
 * Exported for testing only.
 */
export function _topologicalOrder(
  children: Map<string, string[]>,
): { order: string[]; cycles: string[] } {
  // Compute in-degree per node (in-degree = number of parents pointing at it).
  // A "leaf" has zero children -> we want leaves first, so we sort BY children:
  // enqueue nodes whose children are all already in the order.
  const remaining = new Map<string, Set<string>>();
  for (const [parent, kids] of children) {
    remaining.set(parent, new Set(kids));
  }

  const order: string[] = [];
  const queue: string[] = [];
  for (const [node, deps] of remaining) {
    if (deps.size === 0) queue.push(node);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const [other, deps] of remaining) {
      if (deps.delete(node) && deps.size === 0 && !order.includes(other)) {
        queue.push(other);
      }
    }
  }

  // Anything still in remaining with non-empty deps is in a cycle.
  const cycles: string[] = [];
  for (const [node, deps] of remaining) {
    if (!order.includes(node)) cycles.push(node);
    void deps;
  }
  return { order, cycles };
}

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

  const { children } = _buildRecipeDag(db, locationId);
  const { order, cycles } = _topologicalOrder(children);
  result.cycles = cycles;
  if (cycles.length > 0) {
    console.warn(
      `⚠ rollupRecipeCosts: ${cycles.length} recipe(s) participate in a cycle — skipped: ${cycles.sort().join(', ')}`,
    );
  }
  // `order` is consumed by the topo walk in Task 8; for now it's unused so
  // lint doesn't complain — Tasks 5–7 add the per-line costing logic and
  // Task 8 puts them all together.
  void order;

  return result;
}
