# Sub-recipe pricing rollup — design

## Problem

The variance compute in `lib/costingBenchmarks.mjs computeCostVariance`
prices each BOM line by joining `bom_lines.ingredient` against
`vendor_prices` (via `master_id` first, then normalized ingredient key).
BOM lines that reference sub-recipes (e.g. `nashville_oil` consuming
`lariat rub`, `bread and butter pickle juice`) never match — sub-recipes
live in `recipe_costs`, not `vendor_prices`. Today these lines count as
`unmatched`, and any recipe whose unmatched ratio exceeds 30% gets
excluded with `exclusion_reason='high_unmatched_ratio'`.

Current DB state (2026-05-30, post catch-weight + T7 backfill):

- 42 recipes total.
- 26 excluded for `high_unmatched_ratio` — most because of unpriced
  sub-recipe lines.
- 15 red (>5% variance).
- 1 healthy.
- 8 BOM lines flagged `sub_recipe='YES'`; at least 4 additional
  sub-recipe references (`bread and butter pickle juice`, `bacon lard`,
  etc.) are not flagged.

Goal: make the costing engine the source of truth for recipe cost via
recursive sub-recipe rollup, while preserving the Excel-imported
`cost_per_yield_unit` as the theoretical baseline so variance keeps
its signal.

## Decisions locked during brainstorming

| Question | Choice |
|---|---|
| Success criterion | Engine is source of truth AND every recipe gets a number where possible |
| Rollup home | Hybrid — ingest does initial rollup; `recipeCosting.recomputeRecipeCosts` re-rolls on demand. Shared function. |
| Detection | Both — `bom_lines.sub_recipe='YES'` OR `deriveMasterId(ingredient)` matches an existing `recipe_costs.recipe_id` |
| Unit-conversion failure mode | Best-effort: use `lib/unitConvert.mjs`; if a density is required but missing, flag `NEEDS_DENSITY` and skip the line |
| Architecture | C — materialized rollup writes `recipe_costs.batch_cost`; `computeCostVariance` gains a sub-recipe fallback that reads it. No new columns. No recursion on the read path. |

## Architecture

### New module — `lib/computeEngine/rollupRecipeCosts.ts`

Pure function:

```ts
export function rollupRecipeCosts(
  db: Database,
  locationId: string,
): {
  updated: number;                                       // recipes whose batch_cost was rewritten
  cycles: string[];                                      // recipe_ids participating in a non-trivial SCC
  unconverted: Array<{                                   // sub-recipe lines where unit conversion failed
    recipe_id: string;
    ingredient: string;
    reason: 'no_density' | 'incompatible_units' | 'child_no_yield';
  }>;
  new_subrecipe_flags: number;                           // BOM lines auto-flagged sub_recipe='YES' this pass
};
```

The function owns the entire rollup pass. No side effects beyond the
provided DB handle. Safe to call inside a transaction; the function
does not open its own.

### Detection (both flag + auto-detect)

A BOM line is treated as a sub-recipe reference iff EITHER:

1. `bom_lines.sub_recipe = 'YES'`, OR
2. `deriveMasterId(bom_lines.ingredient)` (the existing slug normalizer
   in `scripts/ingest-costing.mjs`, exported from there or re-defined
   locally) matches an existing `recipe_costs.recipe_id` for the same
   `location_id`.

Auto-detect side effect: any line matched by rule 2 whose `sub_recipe`
flag is `NULL` or empty gets set to `'YES'` during the rollup pass.
Tracked in `result.new_subrecipe_flags` so the operator-visible count
of "lines newly recognized as sub-recipe" is observable. The flag
write is idempotent — re-running the rollup with no new BOM data is
a no-op on this counter.

### Topological sort and rollup

1. **Build the DAG**:
   - Nodes: every `recipe_costs.recipe_id` for the location.
   - Edges (parent → child): every BOM line whose detection step
     resolves to a child recipe_id. Self-loops are kept (they'll
     surface as length-1 SCCs in step 2).
2. **Cycle detection** (Kahn's algorithm + SCC labeling):
   - Compute strongly connected components.
   - Any recipe in a non-trivial SCC (size ≥ 2, or size 1 with a
     self-loop) is marked `recipe_costs.exclusion_reason='subrecipe_cycle'`
     and skipped from the topo walk. The string `'subrecipe_cycle'`
     is a new value in an existing column — no migration needed.
   - The cycle list is included in the returned `result.cycles` and
     surfaced via a console.warn at ingest time.
3. **Leaves-first topo walk**. For each non-excluded recipe in order:
   - Recompute `batch_cost` as `Σ (per-line cost)` where each line is
     one of:
     - **Vendor-priced leaf**: existing T7 path —
       `master_id → vendor_prices` via `resolveMergedCost`
       (preferred_vendor or mean fallback), else
       `normalizeIngredientKey(ingredient) → vendor_prices` latest
       row. Line cost = `qty × pack_price / pack_size × yieldAdjustment(yield_pct, loss_factor)`.
     - **Sub-recipe ref**: `unit_cost = child.batch_cost / child.yield`
       in `child.yield_unit`. Convert the line's `qty` from `line.unit`
       to `child.yield_unit` via `convertQty(qty, line.unit, child.yield_unit, undefined)`
       from `lib/unitConvert.mjs`. `gPerMl` is `undefined` for
       sub-recipes (a rolled-up recipe has no single ingredient
       density), so `convertQty` returns `null` for cross-dimensional
       conversions (e.g. cup → lb) — that's our "needs density" /
       "incompatible units" signal. When conversion succeeds:
       line cost = `qtyConverted × unit_cost × yieldAdjustment(yield_pct, loss_factor)`.
     - **Density needed but missing**: set
       `bom_lines.map_status='NEEDS_DENSITY'` (existing string value
       in B2 unmapped queue), record `{recipe_id, ingredient, reason: 'no_density'}`
       in `result.unconverted`, skip the line.
   - Write the rolled `batch_cost` to `recipe_costs.batch_cost`.
   - **Leave `cost_per_yield_unit` untouched** — it remains the
     ingest-time Excel theoretical baseline. This preserves the
     contract documented in `lib/computeEngine/recipeCosting.ts`:
     `cost_per_yield_unit = theoretical`, `batch_cost = live actual`.

### Compute path change

`computeCostVariance` already iterates BOM lines and tries two lookup
paths into `vendor_prices`. Add ONE fallback step **before** the
unmatched-line increment:

```
// (existing) 1. master_id → vendor_prices via resolveMergedCost
// (existing) 2. normalized key → vendor_prices latest row
// (new)      3. resolve as sub-recipe:
//              let recipe_id = deriveMasterId(line.ingredient);
//              if recipe_costs[recipe_id, locationId] has batch_cost > 0
//                                                  and yield > 0:
//                unit_cost = batch_cost / yield  (in child.yield_unit)
//                unit_cost_converted = unitConvert(unit_cost,
//                                                  child.yield_unit,
//                                                  line.unit);
//                if conversion fails (no density / incompatible units):
//                  counts as unmatched, skip
//                else:
//                  actualBatch += qty * unit_cost_converted * yieldAdjustment
//                  contributed += 1
//                  matched = true
```

The D6 unmatched-ratio guard continues to apply to whatever lines
still fall through (e.g. vendor SKUs we don't have prices for).

Recipes like Nashville Oil (today excluded with 2/4 unmatched) will
now produce an `actual` and a `variance_pct`. The `theoretical`
column stays the Excel-derived comparison reference, so the variance
still measures Excel-vs-engine drift.

## Hybrid integration

- **Ingest** — `scripts/ingest-costing.mjs runCostingPostPass` currently
  calls `backfillCatchWeightsIntoVendorPrices` then
  `rebuildIngredientMasters`. Add a third call:
  `rollupRecipeCosts(db, locationId)`. Runs after `rebuildIngredientMasters`
  so `master_id` is available and sub-recipe auto-detect benefits from
  the freshest data. Adds three counters to the ingest summary:
  `subrecipe_cycles`, `subrecipe_unconverted`, `subrecipe_flags_set`.
- **Live recompute** — `lib/computeEngine/recipeCosting.ts recomputeRecipeCosts`
  currently iterates `variance.rows` and writes `batch_cost`. Replace
  that loop with a single call to `rollupRecipeCosts(db, locationId)`.
  Same net effect at the recipe-cost level; sub-recipes get proper
  handling and the per-line variance computation no longer duplicates
  the rollup math. One shared function for both rollup callers.

## Error handling

| Condition | Behavior | Operator surface |
|---|---|---|
| Recipe participates in cycle SCC | `exclusion_reason='subrecipe_cycle'`, skipped from rollup | console.warn at ingest listing cycle members; variance tile shows excluded with reason |
| Sub-recipe ref needs density, missing | `bom_lines.map_status='NEEDS_DENSITY'`, line skipped, `result.unconverted` entry | Already surfaces in B2 unmapped queue |
| Sub-recipe `yield` ≤ 0 / NULL | Line counts as unmatched, `result.unconverted` with `reason: 'child_no_yield'` | Recipe may end up excluded via existing D6 path |
| Child has high unmatched ratio in its own BOM | Parent uses child's partial `batch_cost` as-is | v1 invariant — do NOT propagate "child is incomplete" upward. Revisit if it causes visible confusion. |
| Auto-detect found a recipe_id match but row is degenerate (no batch_cost, no yield) | Line counts as unmatched | D6 path handles |
| Units dimensionally incompatible (e.g. recipe in cup, line in ea) and no density | Line counts as unmatched, `result.unconverted` with `reason: 'incompatible_units'` | B2 unmapped queue |

## Testing

New file — `tests/js/test-rollup-recipe-costs.mjs`. Test cases:

1. **No regression** — recipe with all vendor-priced leaves rolls up to
   the same `batch_cost` as today's path (sanity).
2. **Sub-recipe chain** — parent uses child; child uses leaves;
   parent `batch_cost` equals expected with unit conversion (cup → tbsp).
3. **Cycle detection** — A→B→A; both marked
   `exclusion_reason='subrecipe_cycle'`; `result.cycles` lists both.
4. **NEEDS_DENSITY** — child yields cup, parent consumes lb, no
   density seed → child line flagged, parent variance reflects skipped
   line, `result.unconverted` entry.
5. **Auto-detect side effect** — BOM line `ingredient='lariat rub'` with
   `sub_recipe=NULL` and existing `lariat_rub` recipe → flag set to
   `'YES'` after pass; `result.new_subrecipe_flags === 1`.
6. **Variance integration** — a recipe with the Nashville Oil shape
   (2 leaves + 2 sub-recipes, originally excluded for high unmatched
   ratio) now produces an `actual` and `variance_pct` from
   `computeCostVariance`.

Existing tests extended:

- `tests/js/test-ingest-costing-yields.mjs` — add assertion that
  `runCostingPostPass` calls `rollupRecipeCosts` and updates
  `recipe_costs.batch_cost` for sub-recipe-bearing recipes.

`tests/js/test-sandbox-costing.mjs` is unaffected — `computeSandboxCost`
operates on an LLM-provided ingredient list and a flat vendor_prices
map, not on `bom_lines` / `recipe_costs`, so the sub-recipe rollup
doesn't enter its path.

## Migration / data

- **No new columns.** Existing `recipe_costs`, `bom_lines`,
  `vendor_prices` schemas suffice.
- `bom_lines.sub_recipe` will be populated where today it's
  blank — one-time correction observable via
  `result.new_subrecipe_flags`. Idempotent on subsequent runs.
- `recipe_costs.exclusion_reason` gains the new string value
  `'subrecipe_cycle'`. Pre-existing values (`'high_unmatched_ratio'`)
  are unaffected.

## Out of scope (explicit)

- Propagating "child has partial coverage" upward to parent variance
  metadata. v1 uses child's partial `batch_cost` as-is.
- Operator UI for cycle resolution. CLI warning + DB row is enough
  for v1.
- Sub-recipe pricing for recipes Excel doesn't list (we only roll up
  recipes already in `recipe_costs`).
- Snapshotting rolled-up `batch_cost` history. The
  `vendor_prices_history` table covers leaf-price audit; the rollup is
  a function of vendor_prices + BOM at a point in time and can be
  recomputed.
- Changing the Excel ingest's parser. Sub-recipes are inferred from
  the rolled-up DB, not from the workbook structure.

## File touch list

- **New**: `lib/computeEngine/rollupRecipeCosts.ts`
- **New**: `tests/js/test-rollup-recipe-costs.mjs`
- **Modified**: `scripts/ingest-costing.mjs` — add third post-pass call,
  add three counters to summary, export `deriveMasterId` so the rollup
  module shares the same slug-normalization semantics.
- **Modified**: `lib/computeEngine/recipeCosting.ts recomputeRecipeCosts` —
  replace per-recipe loop with `rollupRecipeCosts` call.
- **Modified**: `lib/costingBenchmarks.mjs computeCostVariance` — add
  sub-recipe fallback step before the unmatched-line increment.
- **Modified**: `tests/js/test-ingest-costing-yields.mjs` — sub-recipe
  assertion.
