# Sub-recipe Pricing Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roll up sub-recipe costs into `recipe_costs.batch_cost` so recipes referencing other recipes (lariat rub, pickle juice, etc.) stop being excluded from the variance tile and the engine becomes the source of truth for cost.

**Architecture:** New pure function `rollupRecipeCosts(db, locationId)` lives in `lib/computeEngine/rollupRecipeCosts.ts`. Called from both `scripts/ingest-costing.mjs runCostingPostPass` (ingest path) and `lib/computeEngine/recipeCosting.ts recomputeRecipeCosts` (live recompute path). The function walks the recipe DAG in topological order, prices each recipe from BOM lines (vendor_prices for leaves, prior rollup result for sub-recipe references via `convertQty`), writes results to `recipe_costs.batch_cost`. `computeCostVariance` in `lib/costingBenchmarks.mjs` gains a sub-recipe fallback step that reads the stored `batch_cost` so previously-excluded recipes get a real `actual` + `variance_pct`.

**Tech Stack:** Node + ESM, `better-sqlite3`, `node:test`, existing `lib/unitConvert.mjs convertQty`, existing `scripts/ingest-costing.mjs deriveMasterId`.

**Spec:** `docs/superpowers/specs/2026-05-30-sub-recipe-pricing-rollup-design.md`

**Spec deviation noted at plan-write:** the spec said cycle-participating recipes would be marked via `recipe_costs.exclusion_reason='subrecipe_cycle'`. `recipe_costs` has no such column (its `interpretations` field is INTEGER, not TEXT). Plan handles cycles via `result.cycles` + a single console.warn at ingest time + skipping the rollup write entirely for cycle members. Their Excel-imported `batch_cost` stays; their variance row will naturally degenerate via the existing D6 unmatched path. No DB migration added.

---

## File Structure

**Create:**
- `lib/computeEngine/rollupRecipeCosts.ts` — pure rollup function. One responsibility: take a DB + locationId, walk recipe DAG, write batch_cost. Returns observability counters.
- `tests/js/test-rollup-recipe-costs.mjs` — unit + integration tests for the new module.

**Modify:**
- `scripts/ingest-costing.mjs` — export `deriveMasterId` (now needed by the rollup module); add third call to `runCostingPostPass`; thread three new counters into `summary`.
- `lib/computeEngine/recipeCosting.ts` — replace inner per-recipe loop with a single `rollupRecipeCosts(db, locationId)` call. Same contract preserved (writes `batch_cost`, never `cost_per_yield_unit`).
- `lib/costingBenchmarks.mjs` — `computeCostVariance` gains one sub-recipe fallback step before counting a line as unmatched.
- `tests/js/test-ingest-costing-yields.mjs` — add assertion that the post-pass now also calls the rollup and populates batch_cost for sub-recipe-bearing recipes.

---

## Task 1: Scaffold the rollup module

**Files:**
- Create: `lib/computeEngine/rollupRecipeCosts.ts`
- Create: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/js/test-rollup-recipe-costs.mjs
#!/usr/bin/env node
// Tests for the sub-recipe pricing rollup pass.
// Run: node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { rollupRecipeCosts } from '../../lib/computeEngine/rollupRecipeCosts.ts';

const LOC = 'default';

describe('rollupRecipeCosts — smoke', () => {
  it('returns an all-zero result on an empty DB', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const result = rollupRecipeCosts(db, LOC);
    assert.deepEqual(result, {
      updated: 0,
      cycles: [],
      unconverted: [],
      new_subrecipe_flags: 0,
    });
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: FAIL with "Cannot find module './lib/computeEngine/rollupRecipeCosts.ts'" (or similar import error).

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/computeEngine/rollupRecipeCosts.ts
import type { Database } from 'better-sqlite3';

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
  void db;
  void locationId;
  return { updated: 0, cycles: [], unconverted: [], new_subrecipe_flags: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: PASS — `tests 1, pass 1, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): scaffold rollupRecipeCosts pass

Empty stub returning zeroed RollupResult. Following tasks add detection,
DAG construction, cycle handling, per-line costing, and the topological
walk that writes recipe_costs.batch_cost."
```

---

## Task 2: Auto-detect sub-recipe references + set the sub_recipe flag

**Files:**
- Modify: `scripts/ingest-costing.mjs` — export `deriveMasterId` so the rollup module can reuse the same slug normalization.
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Make `deriveMasterId` importable from the rollup module**

The function already has `export function deriveMasterId(...)` in `scripts/ingest-costing.mjs` (search for it to confirm). No change needed if the export already exists. Verify:

Run: `grep -n "^export function deriveMasterId" scripts/ingest-costing.mjs`
Expected: prints the export line.

If it doesn't print (or shows only an internal definition), add the `export` keyword. No standalone commit for this — the import will land with the test in step 2.

- [ ] **Step 2: Write the failing test**

Add this `describe` block to `tests/js/test-rollup-recipe-costs.mjs`:

```javascript
import { deriveMasterId } from '../../scripts/ingest-costing.mjs';

describe('rollupRecipeCosts — detection + sub_recipe flag autocorrect', () => {
  it("sets sub_recipe='YES' on BOM lines whose ingredient resolves to an existing recipe_id", () => {
    const db = new Database(':memory:');
    initSchema(db);

    // Parent recipe with one sub-recipe-referencing BOM line that lacks the flag.
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent', 'Parent', 1, 'qt', 10, 10, ?), ('lariat_rub', 'Lariat Rub', 4, 'cup', 8, 2, ?)`,
    ).run(LOC, LOC);

    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub', 1, 'cup', NULL, 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);

    assert.equal(result.new_subrecipe_flags, 1);
    const row = db.prepare(
      `SELECT sub_recipe FROM bom_lines WHERE recipe_id='parent' AND ingredient='lariat rub' AND location_id=?`,
    ).get(LOC);
    assert.equal(row.sub_recipe, 'YES');

    db.close();
  });

  it("does not re-flag a BOM line already marked sub_recipe='YES'", () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',10,10,?), ('lariat_rub','Lariat Rub',4,'cup',8,2,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub', 1, 'cup', 'YES', 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.new_subrecipe_flags, 0);
    db.close();
  });

  it('does not flag BOM lines whose ingredient does not resolve to a recipe_id', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',10,10,?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'kosher salt', 0.5, 'tsp', NULL, 'confirmed', ?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.new_subrecipe_flags, 0);
    const row = db.prepare(`SELECT sub_recipe FROM bom_lines LIMIT 1`).get();
    assert.equal(row.sub_recipe, null);
    db.close();
  });

  it('sanity: deriveMasterId("Lariat Rub") === "lariat_rub"', () => {
    assert.equal(deriveMasterId('Lariat Rub'), 'lariat_rub');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: 3 failures (the smoke test still passes; the new flag tests fail because the stub doesn't set the flag).

- [ ] **Step 4: Implement detection + flag autocorrect**

Replace the stub body in `lib/computeEngine/rollupRecipeCosts.ts` with:

```typescript
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

type RecipeRow = {
  recipe_id: string;
  yield: number | null;
  yield_unit: string | null;
  batch_cost: number | null;
};

type BomRow = {
  id: number;
  recipe_id: string;
  ingredient: string;
  qty: number | null;
  unit: string | null;
  sub_recipe: string | null;
  yield_pct: number | null;
  loss_factor: number | null;
};

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 4, pass 4, fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs scripts/ingest-costing.mjs
git commit -m "feat(costing): rollupRecipeCosts auto-detects sub-recipe BOM lines

Any BOM line whose normalized ingredient slug matches an existing
recipe_id gets bom_lines.sub_recipe='YES'. Idempotent — re-runs on a
clean dataset don't re-flag. Sets the foundation for the topological
DAG walk in the next task."
```

---

## Task 3: Build the parent → child adjacency map

**Files:**
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/js/test-rollup-recipe-costs.mjs`. Import the new internal helper at the top:

```javascript
import { rollupRecipeCosts, _buildRecipeDag } from '../../lib/computeEngine/rollupRecipeCosts.ts';
```

Then add this `describe` block:

```javascript
describe('rollupRecipeCosts — DAG construction', () => {
  it('returns adjacency where parent points at every child it references via a sub-recipe BOM line', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('parent','Parent',1,'qt',NULL,NULL,?),
              ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('pickle_juice','Pickle Juice',2,'cup',6,3,?)`,
    ).run(LOC, LOC, LOC);

    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('parent', 'lariat rub',    0.5, 'cup', 'YES', 'confirmed', ?),
              ('parent', 'pickle juice',  1,   'cup', 'YES', 'confirmed', ?),
              ('parent', 'kosher salt',   1,   'tsp', NULL,  'confirmed', ?)`,
    ).run(LOC, LOC, LOC);

    const { children } = _buildRecipeDag(db, LOC);
    assert.deepEqual(
      [...(children.get('parent') ?? [])].sort(),
      ['lariat_rub', 'pickle_juice'],
    );
    assert.deepEqual(children.get('lariat_rub') ?? [], []);
    assert.deepEqual(children.get('pickle_juice') ?? [], []);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: import error (`_buildRecipeDag` is not exported).

- [ ] **Step 3: Add the DAG builder**

In `lib/computeEngine/rollupRecipeCosts.ts`, after the type declarations, add:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 5, pass 5, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): rollupRecipeCosts builds parent->child recipe DAG

Adjacency map is the input to topological sort (Task 4) and cycle
detection. Treats a BOM line as a sub-recipe link iff the
sub_recipe='YES' flag is set OR its slug matches an existing
recipe_id (matching the Task 2 detection rule)."
```

---

## Task 4: Cycle detection via Kahn's algorithm

**Files:**
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add the import:

```javascript
import {
  rollupRecipeCosts,
  _buildRecipeDag,
  _topologicalOrder,
} from '../../lib/computeEngine/rollupRecipeCosts.ts';
```

Add this `describe`:

```javascript
describe('rollupRecipeCosts — cycle detection', () => {
  it('returns a topo order over a clean DAG (leaves first)', () => {
    const children = new Map([
      ['parent', ['lariat_rub']],
      ['lariat_rub', []],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, ['lariat_rub', 'parent']);
    assert.deepEqual(cycles, []);
  });

  it('detects a 2-cycle A->B->A and reports both members as cycles', () => {
    const children = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, []); // nothing can be rolled up
    assert.deepEqual(cycles.slice().sort(), ['a', 'b']);
  });

  it('detects a self-loop A->A', () => {
    const children = new Map([['a', ['a']]]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, []);
    assert.deepEqual(cycles, ['a']);
  });

  it('partial cycle: clean recipe is still ordered, cycle members are reported separately', () => {
    const children = new Map([
      ['clean', []],
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const { order, cycles } = _topologicalOrder(children);
    assert.deepEqual(order, ['clean']);
    assert.deepEqual(cycles.slice().sort(), ['a', 'b']);
  });

  it('end-to-end: rollupRecipeCosts surfaces cycle members in result.cycles', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('a','A',1,'cup',1,1,?), ('b','B',1,'cup',1,1,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('a','b',0.5,'cup','YES','confirmed',?),
              ('b','a',0.5,'cup','YES','confirmed',?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.deepEqual(result.cycles.slice().sort(), ['a', 'b']);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: import failure (`_topologicalOrder` not exported).

- [ ] **Step 3: Implement Kahn's topological sort + cycle reporting**

Add this function to `lib/computeEngine/rollupRecipeCosts.ts`:

```typescript
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
```

Then wire it into `rollupRecipeCosts` (after the flag-autocorrect block, before the `return result;`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 9, pass 9, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): rollupRecipeCosts detects cycles via Kahn's topo sort

Cycle members are surfaced in result.cycles and a single console.warn at
ingest time; their recipe_costs.batch_cost is left as-is (the Excel
value) so the variance compute still has something to compare. No new
DB column added — the spec's exclusion_reason approach was infeasible
because recipe_costs has no such column."
```

---

## Task 5: Price a vendor-priced leaf BOM line

**Files:**
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add the import:

```javascript
import {
  rollupRecipeCosts,
  _buildRecipeDag,
  _topologicalOrder,
  _priceLeafLine,
} from '../../lib/computeEngine/rollupRecipeCosts.ts';
```

Add the describe block:

```javascript
describe('rollupRecipeCosts — leaf line pricing', () => {
  it('prices a vendor_prices-matched line via the existing T7 path', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('OIL, CANOLA CLR FRY ZTF', 'shamrock', '1950621', 35, 'lb', 38.01, 1.086, ?)`,
    ).run(LOC);

    // T7 master_id: the line carries it, the vendor_prices row carries it.
    db.prepare(`UPDATE vendor_prices SET master_id = 'canola_oil' WHERE ingredient = 'OIL, CANOLA CLR FRY ZTF'`).run();

    // qty=2 lb of canola oil, yield_pct=1.0, loss_factor=0.
    const line = {
      ingredient: 'canola oil',
      qty: 2,
      unit: 'lb',
      master_id: 'canola_oil',
      yield_pct: 1.0,
      loss_factor: null,
    };
    const cost = _priceLeafLine(db, LOC, line);
    // 2 lb * (38.01 / 35) = 2 * 1.086 = 2.172
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost - 2.172) < 0.001, `got ${cost}`);

    db.close();
  });

  it('returns null when no vendor_prices row matches', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const cost = _priceLeafLine(db, LOC, {
      ingredient: 'asafoetida',
      qty: 0.01,
      unit: 'lb',
      master_id: null,
      yield_pct: 1.0,
      loss_factor: null,
    });
    assert.equal(cost, null);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: import error (`_priceLeafLine` not exported).

- [ ] **Step 3: Add the leaf pricer**

Add to `lib/computeEngine/rollupRecipeCosts.ts`. First, add these imports at the top of the file:

```typescript
import { normalizeIngredientKey } from '../ingredientKey.ts';
import { resolveMergedCost } from '../costingBenchmarks.mjs';
```

Then add the helper:

```typescript
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
      const vp = db
        .prepare(
          `SELECT pack_price, pack_size FROM vendor_prices
            WHERE location_id = ? AND ingredient IS NOT NULL
            ORDER BY imported_at DESC, id DESC`,
        )
        .all(locationId) as Array<{ pack_price: number | null; pack_size: number | null }>;
      // (We re-fetch ingredient here rather than rebuilding a Map every call;
      // the rollup wrapper in Task 8 builds the Map once and caches it.)
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
      void vp;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 11, pass 11, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): rollupRecipeCosts can price a vendor-priced leaf line

Reuses resolveMergedCost (preferred_vendor + mean fallback) and the
normalized-ingredient-key fallback from costingBenchmarks. Falls back
gracefully to null when no vendor_prices row matches. Per-call lookup
is O(N) over vendor_prices today; the topo-walk wrapper in Task 8
hoists this into a per-call Map."
```

---

## Task 6: Price a sub-recipe BOM line with unit conversion

**Files:**
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add import:

```javascript
import {
  rollupRecipeCosts,
  _buildRecipeDag,
  _topologicalOrder,
  _priceLeafLine,
  _priceSubRecipeLine,
} from '../../lib/computeEngine/rollupRecipeCosts.ts';
```

Add describe:

```javascript
describe('rollupRecipeCosts — sub-recipe line pricing', () => {
  it('converts the BOM qty from line.unit to child.yield_unit and computes cost', () => {
    // child: lariat_rub, yield=4 cup, batch_cost=$8 -> $2/cup
    const child = { recipe_id: 'lariat_rub', yield: 4, yield_unit: 'cup', batch_cost: 8 };
    // line: parent consumes 16 tbsp lariat rub. 16 tbsp = 1 cup. Cost = 1 * 2 = $2.
    const cost = _priceSubRecipeLine(
      { ingredient: 'lariat rub', qty: 16, unit: 'tbsp', yield_pct: 1.0, loss_factor: null },
      child,
    );
    assert.ok(cost.cost !== null);
    assert.ok(Math.abs(cost.cost - 2.0) < 0.0001, `got ${cost.cost}`);
    assert.equal(cost.reason, null);
  });

  it('handles identity units (line.unit == child.yield_unit)', () => {
    const child = { recipe_id: 'pickle_juice', yield: 2, yield_unit: 'cup', batch_cost: 6 };
    // 1 cup of pickle juice = $6/2 cup * 1 cup = $3
    const cost = _priceSubRecipeLine(
      { ingredient: 'pickle juice', qty: 1, unit: 'cup', yield_pct: 1.0, loss_factor: null },
      child,
    );
    assert.ok(Math.abs(cost.cost - 3.0) < 0.0001);
  });

  it('applies yield_pct/loss_factor', () => {
    const child = { recipe_id: 'rub', yield: 1, yield_unit: 'cup', batch_cost: 10 };
    // qty=1 cup * $10 * adj. yield 0.5, loss 0 -> adj = 1 / (0.5 * 1) = 2.
    const cost = _priceSubRecipeLine(
      { ingredient: 'rub', qty: 1, unit: 'cup', yield_pct: 0.5, loss_factor: null },
      child,
    );
    assert.ok(Math.abs(cost.cost - 20.0) < 0.0001, `got ${cost.cost}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: import error.

- [ ] **Step 3: Add the sub-recipe pricer**

Add this import at the top of `lib/computeEngine/rollupRecipeCosts.ts`:

```typescript
import { convertQty } from '../unitConvert.mjs';
```

Add the function:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 14, pass 14, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): rollupRecipeCosts prices sub-recipe lines via convertQty

Unit-converts the BOM qty into the child's yield_unit, then multiplies by
child.batch_cost / child.yield. Cross-dimensional conversions (cup -> lb)
return null because sub-recipes have no single density — that null is the
NEEDS_DENSITY signal handled by the topo walk in Task 8."
```

---

## Task 7: Topological walk that writes batch_cost

**Files:**
- Modify: `lib/computeEngine/rollupRecipeCosts.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/js/test-rollup-recipe-costs.mjs`:

```javascript
describe('rollupRecipeCosts — end-to-end batch_cost rewrite', () => {
  it('rolls up a parent that uses a sub-recipe and a vendor-priced leaf', () => {
    const db = new Database(':memory:');
    initSchema(db);

    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('lariat_rub','Lariat Rub',4,'cup',8,2,?),
              ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);

    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('OIL, CANOLA CLR FRY ZTF', 'shamrock', '1', 35, 'lb', 35, 1, ?)`,
    ).run(LOC);

    // parent consumes 1 cup lariat rub ($2) + 1 lb canola oil ($1) = $3.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','lariat rub',1,'cup','YES','confirmed',1.0,NULL,?),
              ('parent','canola oil',1,'lb',NULL,'confirmed',1.0,NULL,?)`,
    ).run(LOC, LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.updated, 1); // only parent was actually overwritten
    assert.deepEqual(result.cycles, []);

    const parent = db.prepare(
      `SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent' AND location_id=?`,
    ).get(LOC);
    assert.ok(Math.abs(parent.batch_cost - 3.0) < 0.001, `got ${parent.batch_cost}`);
    db.close();
  });

  it('skips cycle members and leaves their batch_cost untouched', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('a','A',1,'cup',99,99,?), ('b','B',1,'cup',88,88,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, location_id)
       VALUES ('a','b',0.5,'cup','YES','confirmed',?),
              ('b','a',0.5,'cup','YES','confirmed',?)`,
    ).run(LOC, LOC);

    rollupRecipeCosts(db, LOC);
    const a = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='a'`).get();
    const b = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='b'`).get();
    assert.equal(a.batch_cost, 99);
    assert.equal(b.batch_cost, 88);
    db.close();
  });

  it('records a NEEDS_DENSITY entry when sub-recipe units are cross-dimensional and no density is available', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('rub','Rub',4,'cup',8,2,?), ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','rub',1,'lb','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    const result = rollupRecipeCosts(db, LOC);
    assert.equal(result.unconverted.length, 1);
    assert.equal(result.unconverted[0].reason, 'no_density');
    assert.equal(result.unconverted[0].recipe_id, 'parent');

    const status = db.prepare(
      `SELECT map_status FROM bom_lines WHERE recipe_id='parent' AND ingredient='rub'`,
    ).get();
    assert.equal(status.map_status, 'NEEDS_DENSITY');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: 3 new failures.

- [ ] **Step 3: Implement the topo walk**

Replace the `// ... Task 8 ...` placeholder in `rollupRecipeCosts` (the area after `_topologicalOrder` is called) with this complete topo walk. The full function body for `rollupRecipeCosts` becomes:

```typescript
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

  // (Task 2: detection + flag autocorrect, unchanged)
  const recipeIds = new Set<string>(
    (
      db
        .prepare(`SELECT recipe_id FROM recipe_costs WHERE location_id = ?`)
        .all(locationId) as Array<{ recipe_id: string }>
    ).map((r) => r.recipe_id),
  );
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

  // (Tasks 3 + 4: build DAG + detect cycles)
  const { children } = _buildRecipeDag(db, locationId);
  const { order, cycles } = _topologicalOrder(children);
  result.cycles = cycles;
  if (cycles.length > 0) {
    console.warn(
      `⚠ rollupRecipeCosts: ${cycles.length} recipe(s) in cycle — skipped: ${cycles.sort().join(', ')}`,
    );
  }

  // (Task 7: topo walk)
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
      `SELECT id, recipe_id, ingredient, qty, unit, sub_recipe, yield_pct, loss_factor
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
        // BomRow doesn't carry master_id explicitly in this query — the
        // existing T7 path inside _priceLeafLine handles fallback to
        // normalizeIngredientKey, which is sufficient for leaves.
        master_id: null,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: `tests 17, pass 17, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/rollupRecipeCosts.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): rollupRecipeCosts performs the topological batch_cost walk

Leaves-first walk; each recipe is priced from BOM lines (sub-recipe lines
use the prior-rolled child cost; leaf lines reuse the T7 / normalized-key
vendor lookup). NEEDS_DENSITY is set on cross-dim sub-recipe lines.
Cycles are skipped — their Excel batch_cost stays in place."
```

---

## Task 8: Wire rollupRecipeCosts into the ingest's post-pass

**Files:**
- Modify: `scripts/ingest-costing.mjs` — add call + three counters.
- Modify: `tests/js/test-ingest-costing-yields.mjs` — assert the call landed.

- [ ] **Step 1: Add the post-pass call**

Open `scripts/ingest-costing.mjs`. Find the end of `runCostingPostPass` (look for `summary.bom_master_backfilled_rows = masterSync.bom_backfilled;` followed by `return summary;`). Add the import at the top of the file (near the other lib imports):

```javascript
import { rollupRecipeCosts } from '../lib/computeEngine/rollupRecipeCosts.ts';
```

Then insert this block immediately before `return summary;` in `runCostingPostPass`:

```javascript
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
```

Also add the four counters to the initial `summary` object (search for `ingredient_maps: 0,` in the impl-level `summary = { ... }` initialization and add alongside):

```javascript
    subrecipe_rollup_updated: 0,
    subrecipe_rollup_cycles: 0,
    subrecipe_rollup_unconverted: 0,
    subrecipe_flags_set: 0,
```

And add a one-line log near the existing post-pass log lines in `main()` (the `console.log` after `✓ Yield-adjusted` lines):

```javascript
    if (summary.subrecipe_rollup_updated > 0 || summary.subrecipe_rollup_cycles > 0) {
      console.log(
        `✓ Sub-recipe rollup: ${summary.subrecipe_rollup_updated} recipes updated, ${summary.subrecipe_flags_set} new sub_recipe flags set, ${summary.subrecipe_rollup_cycles} cycle(s), ${summary.subrecipe_rollup_unconverted} unconverted line(s)`,
      );
    }
```

- [ ] **Step 2: Add the integration test assertion**

Open `tests/js/test-ingest-costing-yields.mjs`. Find the `describe('ingestCosting — non-yield behavior preserved', ...)` block (near the end). Add a new `it` inside it:

```javascript
  it('runs the sub-recipe rollup as part of the post-pass', () => {
    // The existing fixture has no sub-recipes — assert the rollup ran (it's a
    // no-op on this dataset) without exploding, and that the new counters
    // appear on the summary.
    assert.ok('subrecipe_rollup_updated' in summary, 'summary.subrecipe_rollup_updated missing');
    assert.ok('subrecipe_rollup_cycles' in summary, 'summary.subrecipe_rollup_cycles missing');
    assert.ok('subrecipe_rollup_unconverted' in summary, 'summary.subrecipe_rollup_unconverted missing');
    assert.ok('subrecipe_flags_set' in summary, 'summary.subrecipe_flags_set missing');
    assert.equal(summary.subrecipe_rollup_cycles, 0);
  });
```

(The variable `summary` is already in scope from earlier `describe` setup — confirm by reading the surrounding tests.)

- [ ] **Step 3: Run both test files to verify pass**

Run: `node --experimental-strip-types --test tests/js/test-ingest-costing-yields.mjs tests/js/test-rollup-recipe-costs.mjs`
Expected: all prior tests still pass; the new assertion in `test-ingest-costing-yields.mjs` passes.

- [ ] **Step 4: Run the live ingest against the real DB and confirm no crash**

Run:
```bash
LARIAT_COSTING=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/Lariat_Master_Costing_2026-04-09.xlsx \
LARIAT_OPS=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/lariat_operations_workbook_2026-04-10.xlsx \
PATH="$PWD/.venv/bin:$PATH" \
node scripts/ingest-costing.mjs 2>&1 | grep -v "D4 Excel drift" | tail -10
```

Expected: the existing `✓ Costing ingest:` line plus a new `✓ Sub-recipe rollup:` line with non-zero `recipes updated` (because Nashville Oil and the other sub-recipe-bearing recipes are now in play).

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-costing.mjs tests/js/test-ingest-costing-yields.mjs
git commit -m "feat(costing): wire rollupRecipeCosts into ingest-costing post-pass

Adds the third call in runCostingPostPass (after catch-weight backfill
and ingredient_masters rebuild). Four new counters appear on the ingest
summary: subrecipe_rollup_updated, subrecipe_rollup_cycles,
subrecipe_rollup_unconverted, subrecipe_flags_set. Operator-visible log
line emitted when the pass found anything."
```

---

## Task 9: Wire rollupRecipeCosts into recomputeRecipeCosts

**Files:**
- Modify: `lib/computeEngine/recipeCosting.ts`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/js/test-rollup-recipe-costs.mjs`:

```javascript
import { recomputeRecipeCosts } from '../../lib/computeEngine/recipeCosting.ts';

describe('recomputeRecipeCosts — uses rollupRecipeCosts under the hood', () => {
  it('produces the same batch_cost values as a direct rollup call', () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('child','Child',2,'cup',6,3,?), ('parent','Parent',1,'qt',NULL,NULL,?)`,
    ).run(LOC, LOC);
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','child',1,'cup','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    recomputeRecipeCosts(db, LOC);
    const parent = db.prepare(`SELECT batch_cost FROM recipe_costs WHERE recipe_id='parent'`).get();
    // 1 cup * $3/cup = $3
    assert.ok(Math.abs(parent.batch_cost - 3.0) < 0.001, `got ${parent.batch_cost}`);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: the new test fails because `recomputeRecipeCosts` still uses its old variance-based loop, which does NOT handle sub-recipe references.

- [ ] **Step 3: Replace `recomputeRecipeCosts`'s body**

Open `lib/computeEngine/recipeCosting.ts`. Replace the entire function body with a single call to `rollupRecipeCosts`. The header (imports + docstring) and contract stay; only the inner implementation changes:

```typescript
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
 */
export function recomputeRecipeCosts(db: Database, locationId: string) {
  rollupRecipeCosts(db, locationId);
}
```

Remove the old `computeCostVariance` import and the in-function logic.

- [ ] **Step 4: Run all relevant tests**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs tests/js/test-ingest-costing-yields.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/computeEngine/recipeCosting.ts tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): recomputeRecipeCosts now delegates to rollupRecipeCosts

Single-line body. The previous variance.rows-based loop excluded any
recipe with sub-recipe BOM lines (high unmatched ratio); the rollup path
handles them properly. Semantic contract preserved:
cost_per_yield_unit untouched, batch_cost is the live engine value."
```

---

## Task 10: Add sub-recipe fallback to computeCostVariance

**Files:**
- Modify: `lib/costingBenchmarks.mjs`
- Modify: `tests/js/test-rollup-recipe-costs.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/js/test-rollup-recipe-costs.mjs`:

```javascript
import { computeCostVariance } from '../../lib/costingBenchmarks.mjs';

describe('computeCostVariance — sub-recipe fallback', () => {
  it("a recipe whose only unmatched lines are sub-recipes now gets an actual + variance_pct", () => {
    const db = new Database(':memory:');
    initSchema(db);
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost, cost_per_yield_unit, location_id)
       VALUES ('child','Child',2,'cup',6,3,?), ('parent','Parent',1,'cup',NULL,5,?)`,
    ).run(LOC, LOC);
    // Parent: 1 cup of child = $3. Theoretical = $5. Variance = (5-3)/5 = 40%.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, map_status, yield_pct, loss_factor, location_id)
       VALUES ('parent','child',1,'cup','YES','confirmed',1.0,NULL,?)`,
    ).run(LOC);

    const v = computeCostVariance(db, LOC);
    const parent = v.rows.find((r) => r.recipe_id === 'parent');
    assert.ok(parent, 'parent should appear in variance rows');
    assert.equal(parent.excluded, false);
    assert.ok(parent.actual !== null, 'parent.actual should be non-null after sub-recipe fallback');
    assert.ok(Math.abs(parent.actual - 3.0) < 0.001, `got actual=${parent.actual}`);
    assert.ok(parent.variance_pct !== null);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs`
Expected: assertion fails because the parent line counts as unmatched (no vendor_prices match) and the recipe is excluded with `high_unmatched_ratio`.

- [ ] **Step 3: Add the sub-recipe fallback to computeCostVariance**

Open `lib/costingBenchmarks.mjs`. Locate the per-line loop inside `computeCostVariance` — specifically the block that runs after the `master_id` lookup AND the normalized-key fallback have both failed. Currently it does:

```javascript
      if (!matched) {
        unmatchedLines += 1;
        continue;
      }
```

Replace that block with:

```javascript
      if (!matched) {
        // Sub-recipe fallback: if the line's normalized ingredient resolves
        // to an existing recipe_id, use that recipe's stored batch_cost /
        // yield as the unit cost (in child.yield_unit), convert to the
        // line's unit via convertQty, and contribute to actualBatch.
        // gPerMl is undefined for sub-recipes (a rolled-up recipe has no
        // single density); convertQty returns null on cross-dim conversions,
        // which we treat as "still unmatched" so the D6 ratio gate fires.
        const slug = deriveMasterId(line.ingredient ?? '');
        if (slug) {
          const child = subRecipeById.get(slug);
          if (
            child &&
            child.batch_cost != null &&
            child.batch_cost > 0 &&
            child.yield != null &&
            child.yield > 0
          ) {
            const unitCost = child.batch_cost / child.yield;
            const qtyConverted = convertQty(
              qty,
              line.unit ?? '',
              child.yield_unit ?? '',
              undefined,
            );
            if (qtyConverted != null && Number.isFinite(qtyConverted)) {
              actualBatch += qtyConverted * unitCost * adj;
              contributed += 1;
              continue;
            }
          }
        }
        unmatchedLines += 1;
        continue;
      }
```

At the top of `computeCostVariance` (or near the existing similar Map builders), build the sub-recipe lookup map ONCE per call:

```javascript
  const subRecipeById = new Map();
  for (const r of db.prepare(
    `SELECT recipe_id, yield, yield_unit, batch_cost
       FROM recipe_costs WHERE location_id = ?`,
  ).all(locationId)) {
    subRecipeById.set(r.recipe_id, r);
  }
```

Also add the imports at the top of `lib/costingBenchmarks.mjs`:

```javascript
import { convertQty } from './unitConvert.mjs';
import { deriveMasterId } from '../scripts/ingest-costing.mjs';
```

(Both already exist in the codebase; this just makes them visible here.)

- [ ] **Step 4: Run all relevant tests**

Run: `node --experimental-strip-types --test tests/js/test-rollup-recipe-costs.mjs tests/js/test-ingest-costing-yields.mjs tests/js/test-ingest-costing-yield-math.mjs`
Expected: all pass; the new sub-recipe-fallback test passes; no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/costingBenchmarks.mjs tests/js/test-rollup-recipe-costs.mjs
git commit -m "feat(costing): computeCostVariance reads sub-recipe cost as fallback

After master_id and normalized-key vendor_prices lookups both miss, the
line's slug is resolved against recipe_costs. If a non-degenerate row
exists, its batch_cost / yield is converted via convertQty into the
line's unit and contributes to actualBatch. Recipes previously excluded
for high_unmatched_ratio (Nashville Oil + 25 others) now produce an
actual + variance_pct."
```

---

## Task 11: Real-data sanity check + commit

**Files:**
- (No code changes — manual verification + commit of any incidental fixes.)

- [ ] **Step 1: Re-run the live ingest against `data/lariat.db`**

```bash
LARIAT_COSTING=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/Lariat_Master_Costing_2026-04-09.xlsx \
LARIAT_OPS=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/lariat_operations_workbook_2026-04-10.xlsx \
PATH="$PWD/.venv/bin:$PATH" \
node scripts/ingest-costing.mjs 2>&1 | grep -v "D4 Excel drift" | tail -10
```

Expected: the existing `✓ Costing ingest:` line plus `✓ Sub-recipe rollup:` with `recipes updated > 0`, and a non-zero `subrecipe_flags_set` (we know there are ≥4 sub-recipe lines lacking the flag from the spec's findings).

- [ ] **Step 2: Confirm Nashville Oil is no longer excluded**

```bash
sqlite3 data/lariat.db "SELECT recipe_id, batch_cost FROM recipe_costs WHERE recipe_id='nashville_oil';"
```

Expected: a `batch_cost` value (not the prior Excel value of $335.37 — this is the engine's rolled-up number, which incorporates `lariat rub` priced from BOM and `bread and butter pickle juice` similarly).

Then check the variance row via a small inline script (do NOT add a permanent file; this is throwaway verification):

```bash
node --experimental-strip-types -e "
import('./lib/costingBenchmarks.mjs').then(async ({ computeCostVariance }) => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database('./data/lariat.db', { readonly: true });
  const v = computeCostVariance(db, 'default');
  const n = v.rows.find(r => r.recipe_id === 'nashville_oil');
  console.log(JSON.stringify(n, null, 2));
  console.log('summary:', JSON.stringify(v.summary));
});
"
```

Expected: `nashville_oil` is no longer `excluded`; `actual` and `variance_pct` are populated. `summary.excluded_high_unmatched` is materially lower than the pre-rollup value of 26.

- [ ] **Step 3: Spot-check for new D4 drift warnings**

The newly-rolled-up `batch_cost` values may differ wildly from the Excel-imported baseline (which is what the D4 warning compares). Confirm the warnings still print but the *count* hasn't shifted dramatically (the rollup writes batch_cost, but the D4 warning compares Excel-vs-computed-sum which is independent of the rollup).

Run:
```bash
LARIAT_COSTING=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/Lariat_Master_Costing_2026-04-09.xlsx \
LARIAT_OPS=/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/lariat_operations_workbook_2026-04-10.xlsx \
PATH="$PWD/.venv/bin:$PATH" \
node scripts/ingest-costing.mjs 2>&1 | grep "⚠ D4" | wc -l
```

Expected: similar order of magnitude to the pre-rollup count of 38 (it's possible a couple shift in either direction; large divergence would be a regression worth investigating).

- [ ] **Step 4: Run the full relevant test suite**

```bash
node --experimental-strip-types --test \
  tests/js/test-rollup-recipe-costs.mjs \
  tests/js/test-ingest-costing-yields.mjs \
  tests/js/test-ingest-costing-yield-math.mjs \
  tests/js/test-sandbox-costing.mjs \
  tests/js/test-vendor-prices-history-on-upsert.mjs 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 5: If steps 1-4 all pass, no commit needed for this task.** The DB state change from running the live ingest is data, not code. If any incidental fix was needed during verification, commit it now as a follow-up:

```bash
# only if a fix was needed during real-data run:
git add <fixed-files>
git commit -m "fix(costing): <one-line fix description from real-data run>"
```

---

## Self-review summary

**Spec coverage:**
- Module + signature → Task 1
- Detection (flag + auto-detect) → Task 2
- Topological sort + cycle detection → Tasks 3 + 4
- Vendor leaf pricing → Task 5
- Sub-recipe pricing with unit conversion → Task 6
- NEEDS_DENSITY handling → covered in Task 6 (return reason) and Task 7 (flag write)
- Ingest wiring → Task 8
- Live recompute wiring → Task 9
- computeCostVariance sub-recipe fallback → Task 10
- Real-data sanity check → Task 11

**Deviations from spec (called out in the spec-deviation block above):**
- Cycles: handled via `result.cycles` + console.warn + skip-rollup. No DB column added (spec assumed a nonexistent `recipe_costs.exclusion_reason`).
- `cost_proxy_sub_recipe` ingredient_maps status: orthogonal — the rollup uses BOM `sub_recipe` flag and recipe_id name match, not ingredient_maps. Existing cost_proxy entries continue to behave as today (they live in `ingredient_maps` and don't drive rollup).

**No placeholders, no TBDs, all file paths absolute or repo-relative.**

