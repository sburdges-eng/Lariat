import type { Database } from 'better-sqlite3';
import { deriveMasterId, normalizeIngredientKey } from '../ingredientKey.ts';
import { resolveMergedCost } from '../costingBenchmarks.mjs';
import { convertQty } from '../unitConvert.mjs';

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
  master_id: string | null;
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

function yieldAdjustment(
  yieldPct: number | null | undefined,
  lossFactor: number | null | undefined,
): number | null {
  const y = yieldPct == null ? 1.0 : yieldPct;
  const l = lossFactor == null ? 0.0 : lossFactor;
  const denom = y * (1 - l);
  if (!(denom > 0) || !Number.isFinite(denom)) return null;
  return 1 / denom;
}

export type LeafLineInput = {
  ingredient: string;
  qty: number | null;
  unit: string | null;
  master_id: string | null;
  yield_pct: number | null;
  loss_factor: number | null;
};

/**
 * Price a single BOM line whose ingredient is a vendor-priced leaf (not a
 * sub-recipe). Returns line cost in USD, or null if no vendor_prices row
 * matches.
 *
 * Lookup order mirrors computeCostVariance:
 *   1. master_id (when both sides carry one) -> resolveMergedCost
 *      (preferred_vendor with mean fallback across distinct vendors)
 *   2. normalized ingredient key -> latest vendor_prices row
 *
 * Exported for testing only.
 */
export function _priceLeafLine(
  db: Database,
  locationId: string,
  line: LeafLineInput,
): number | null {
  const qty = line.qty;
  if (qty == null || !(qty > 0) || !Number.isFinite(qty)) return null;
  const adj = yieldAdjustment(line.yield_pct, line.loss_factor);
  if (adj == null) return null;

  let packPrice: number | null = null;
  let packSize: number | null = null;

  if (line.master_id) {
    const rows = db
      .prepare(
        `SELECT vendor, pack_price, pack_size FROM vendor_prices
          WHERE location_id = ? AND master_id = ?
          ORDER BY imported_at DESC, id DESC`,
      )
      .all(locationId, line.master_id) as Array<{
        vendor: string | null;
        pack_price: number | null;
        pack_size: number | null;
      }>;
    const preferred = (
      db
        .prepare(
          `SELECT preferred_vendor FROM ingredient_masters WHERE master_id = ?`,
        )
        .get(line.master_id) as { preferred_vendor: string | null } | undefined
    )?.preferred_vendor ?? null;
    const merged = resolveMergedCost(rows, preferred);
    if (merged) {
      packPrice = merged.pack_price;
      packSize = merged.pack_size;
    }
  }

  if (packPrice == null || packSize == null) {
    const key = normalizeIngredientKey(line.ingredient ?? '');
    if (key) {
      const allRows = db
        .prepare(
          `SELECT ingredient, pack_price, pack_size FROM vendor_prices
            WHERE location_id = ?
            ORDER BY imported_at DESC, id DESC`,
        )
        .all(locationId) as Array<{
          ingredient: string | null;
          pack_price: number | null;
          pack_size: number | null;
        }>;
      for (const r of allRows) {
        const k = normalizeIngredientKey(r.ingredient ?? '');
        if (k === key && r.pack_price != null && r.pack_size != null) {
          packPrice = r.pack_price;
          packSize = r.pack_size;
          break;
        }
      }
    }
  }

  if (
    packPrice == null ||
    packSize == null ||
    !(packPrice > 0) ||
    !(packSize > 0) ||
    !Number.isFinite(packPrice) ||
    !Number.isFinite(packSize)
  ) {
    return null;
  }

  return (qty * packPrice / packSize) * adj;
}

export type SubRecipeLineInput = {
  ingredient: string;
  qty: number | null;
  unit: string | null;
  yield_pct: number | null;
  loss_factor: number | null;
};

export type SubRecipeChild = {
  recipe_id: string;
  yield: number | null;
  yield_unit: string | null;
  batch_cost: number | null;
};

/**
 * Price a single BOM line that references a sub-recipe child.
 *
 * Unit math:
 *   child unit cost  = child.batch_cost / child.yield  (in child.yield_unit)
 *   qty_converted    = convertQty(line.qty, line.unit, child.yield_unit, undefined)
 *   line cost        = qty_converted * child_unit_cost * yieldAdjustment(yield_pct, loss_factor)
 *
 * gPerMl is undefined — sub-recipes don't have a meaningful density (they're
 * aggregates of many ingredients), so convertQty will return null on any
 * cross-dimensional conversion (e.g. cup -> lb). That null is our "incompatible
 * units / needs density" signal.
 *
 * Returns { cost, reason } where reason is null on success or one of the
 * three unconverted-reason codes on failure.
 *
 * Exported for testing only.
 */
export function _priceSubRecipeLine(
  line: SubRecipeLineInput,
  child: SubRecipeChild,
): { cost: number | null; reason: RollupResult['unconverted'][number]['reason'] | null } {
  if (child.yield == null || !(child.yield > 0)) {
    return { cost: null, reason: 'child_no_yield' };
  }
  if (child.batch_cost == null || !(child.batch_cost > 0)) {
    return { cost: null, reason: 'child_no_yield' };
  }
  const qty = line.qty;
  if (qty == null || !(qty > 0) || !Number.isFinite(qty)) return { cost: null, reason: null };
  const adj = yieldAdjustment(line.yield_pct, line.loss_factor);
  if (adj == null) return { cost: null, reason: null };

  const unitCost = child.batch_cost / child.yield; // $/yield_unit
  const qtyConverted = convertQty(qty, line.unit ?? '', child.yield_unit ?? '', undefined);
  if (qtyConverted == null) {
    // convertQty returns null for cross-dim w/o density OR unknown units.
    // Distinguish (best-effort): same-dim + no density -> 'no_density';
    // otherwise -> 'incompatible_units'.
    // Cheap heuristic: try identity to see if both units are at least recognized.
    const idA = convertQty(1, line.unit ?? '', line.unit ?? '', undefined);
    const idB = convertQty(1, child.yield_unit ?? '', child.yield_unit ?? '', undefined);
    if (idA == null || idB == null) {
      return { cost: null, reason: 'incompatible_units' };
    }
    return { cost: null, reason: 'no_density' };
  }

  return { cost: qtyConverted * unitCost * adj, reason: null };
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

  // (T3 + T4: build DAG + detect cycles)
  const { children } = _buildRecipeDag(db, locationId);
  const { order, cycles } = _topologicalOrder(children);
  result.cycles = cycles;
  if (cycles.length > 0) {
    console.warn(
      `⚠ rollupRecipeCosts: ${cycles.length} recipe(s) in cycle — skipped: ${cycles.sort().join(', ')}`,
    );
  }

  // (T7: topo walk)
  // Load recipe_costs rows once into a Map so we can look up child cost
  // without re-querying inside the inner loop. Updates land in this map AND
  // in the DB on each iteration so a parent's lookup of an already-rolled
  // child gets the fresh number.
  const recipesById = new Map<string, RecipeRow>();
  for (const r of db
    .prepare(
      `SELECT recipe_id, yield, yield_unit, batch_cost FROM recipe_costs WHERE location_id = ?`,
    )
    .all(locationId) as RecipeRow[]) {
    recipesById.set(r.recipe_id, r);
  }

  // Per-recipe BOM lines, grouped.
  const bomByRecipe = new Map<string, BomRow[]>();
  for (const r of db
    .prepare(
      `SELECT id, recipe_id, ingredient, qty, unit, sub_recipe, yield_pct, loss_factor, master_id
         FROM bom_lines WHERE location_id = ?`,
    )
    .all(locationId) as BomRow[]) {
    if (!bomByRecipe.has(r.recipe_id)) bomByRecipe.set(r.recipe_id, []);
    bomByRecipe.get(r.recipe_id)!.push(r);
  }

  const updateBatchCost = db.prepare(
    `UPDATE recipe_costs SET batch_cost = ? WHERE recipe_id = ? AND location_id = ?`,
  );
  const flagDensity = db.prepare(
    `UPDATE bom_lines SET map_status = 'NEEDS_DENSITY' WHERE id = ?`,
  );

  for (const recipeId of order) {
    const lines = bomByRecipe.get(recipeId) ?? [];
    let total = 0;
    let anyContributed = false;
    for (const line of lines) {
      const slug = deriveMasterId(line.ingredient ?? '');
      const isSubRecipe = line.sub_recipe === 'YES' || (slug != null && recipeIds.has(slug));
      if (isSubRecipe && slug != null && recipesById.has(slug)) {
        const child = recipesById.get(slug)!;
        const { cost, reason } = _priceSubRecipeLine(
          {
            ingredient: line.ingredient,
            qty: line.qty,
            unit: line.unit,
            yield_pct: line.yield_pct,
            loss_factor: line.loss_factor,
          },
          {
            recipe_id: child.recipe_id,
            yield: child.yield,
            yield_unit: child.yield_unit,
            batch_cost: child.batch_cost,
          },
        );
        if (cost != null) {
          total += cost;
          anyContributed = true;
        } else if (reason != null) {
          result.unconverted.push({
            recipe_id: recipeId,
            ingredient: line.ingredient,
            reason,
          });
          if (reason === 'no_density' || reason === 'incompatible_units') {
            flagDensity.run(line.id);
          }
        }
        continue;
      }
      // Vendor-priced leaf.
      const leafCost = _priceLeafLine(db, locationId, {
        ingredient: line.ingredient,
        qty: line.qty,
        unit: line.unit,
        master_id: line.master_id ?? null,
        yield_pct: line.yield_pct,
        loss_factor: line.loss_factor,
      });
      if (leafCost != null) {
        total += leafCost;
        anyContributed = true;
      }
    }

    if (anyContributed) {
      updateBatchCost.run(total, recipeId, locationId);
      result.updated += 1;
      // Refresh the in-memory map so a parent that uses this recipe later
      // in the topo walk sees the new batch_cost.
      const cur = recipesById.get(recipeId)!;
      recipesById.set(recipeId, { ...cur, batch_cost: total });
    }
  }

  return result;
}
