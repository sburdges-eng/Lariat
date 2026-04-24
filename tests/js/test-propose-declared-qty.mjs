// Tests for scripts/propose-declared-qty.mjs.
//
// Drives the pure helpers directly — no spawn, no DB. The script is
// file-in / file-out with no side effects aside from writing the CSV
// at the end, so unit-testing the tier selection + row builder is
// sufficient to cover behavior.
//
// One fixture per tier (1..4) plus a Tier-3-eligible dish so the count
// heuristic path actually fires. If the script ever gains a tier, add
// a fixture here and a case below.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'propose-declared-qty.mjs');

// Dynamic import so the script's top-level CLI guard (the isMain block)
// sees argv[1] != the script path and skips execution. The module's
// exported helpers are what we test.
const mod = await import(`file://${SCRIPT}`);
const {
  inferQtyForRecipe,
  buildProposalRows,
  normalizeDishName,
  TARGET_DISHES,
} = mod;

describe('normalizeDishName', () => {
  it('lowercases and collapses punctuation', () => {
    assert.equal(normalizeDishName('BAJA FISH TACOS'), 'baja fish tacos');
    assert.equal(normalizeDishName('Baja Fish Tacos (cabbage topping)'), 'baja fish tacos cabbage topping');
    assert.equal(normalizeDishName('  Quesa-Birria  Tacos  '), 'quesa birria tacos');
  });

  it('returns empty string for nullish input', () => {
    assert.equal(normalizeDishName(null), '');
    assert.equal(normalizeDishName(undefined), '');
    assert.equal(normalizeDishName(''), '');
  });
});

describe('inferQtyForRecipe — tier selection', () => {
  // ── Tier 1: explicit per-serving field ─────────────────────────
  it('Tier 1 — uses recipe.per_serving_qty when present', () => {
    const recipe = {
      slug: 'tier1_recipe',
      yield_qty: 100,
      yield_unit: 'qt',
      menu_items: ['Some Dish', 'Other Dish'],
      per_serving_qty: { qty: 0.5, unit: 'cup' },
    };
    const r = inferQtyForRecipe(recipe, 'some dish', 'Some Dish');
    assert.equal(r.confidence, 'high');
    assert.equal(r.qty, 0.5);
    assert.equal(r.unit, 'cup');
    assert.match(r.notes, /explicit recipe\.per_serving_qty/);
  });

  it('Tier 1 — accepts portion_size and per_serving aliases', () => {
    const r1 = inferQtyForRecipe(
      { slug: 'x', portion_size: { qty: 2, unit: 'oz' } },
      'x',
      'X',
    );
    assert.equal(r1.confidence, 'high');
    assert.equal(r1.qty, 2);

    const r2 = inferQtyForRecipe(
      { slug: 'x', per_serving: { qty: 3, unit: 'tbsp' } },
      'x',
      'X',
    );
    assert.equal(r2.confidence, 'high');
    assert.equal(r2.qty, 3);
  });

  // ── Tier 2: yield_qty / menu_items.length ──────────────────────
  it('Tier 2 — divides yield by menu_items count with medium confidence', () => {
    const recipe = {
      slug: 'tier2_recipe',
      yield_qty: 4,
      yield_unit: 'qt',
      menu_items: ['Fish & Chips', 'Baja Fish Tacos'],
    };
    const r = inferQtyForRecipe(recipe, 'baja fish tacos', 'BAJA FISH TACOS');
    assert.equal(r.confidence, 'medium');
    assert.equal(r.qty, 2); // 4 / 2
    assert.equal(r.unit, 'qt');
    assert.match(r.notes, /inferred: yield_qty \/ menu_items\.length/);
    assert.match(r.notes, /4 qt \/ 2/);
  });

  it('Tier 2 — single menu item yields the full batch (qty = yield_qty)', () => {
    const recipe = {
      slug: 'solo',
      yield_qty: 10,
      yield_unit: 'qt',
      menu_items: ['Chipotle Aioli Dish'],
    };
    const r = inferQtyForRecipe(recipe, 'chipotle aioli dish', 'Chipotle Aioli Dish');
    assert.equal(r.confidence, 'medium');
    assert.equal(r.qty, 10);
  });

  it('Tier 2 — skipped when menu_items is empty (falls through)', () => {
    const recipe = {
      slug: 'orphan',
      yield_qty: 4,
      yield_unit: 'qt',
      menu_items: [],
    };
    // No target dish match in COUNT_HEURISTICS for "orphan", so Tier 4.
    const r = inferQtyForRecipe(recipe, 'orphan', 'Orphan');
    assert.equal(r.confidence, 'blank');
  });

  it('Tier 2 — skipped when menu_items exceeds 6 (too promiscuous to trust)', () => {
    const recipe = {
      slug: 'omni_sauce',
      yield_qty: 10,
      yield_unit: 'qt',
      menu_items: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    };
    const r = inferQtyForRecipe(recipe, 'a', 'A');
    assert.equal(r.confidence, 'blank');
  });

  // ── Tier 3: count heuristic for known dish names ───────────────
  it('Tier 3 — tacos get 2 per serving when recipe has no usable yield', () => {
    const recipe = {
      slug: 'taco_shell',
      // no yield_qty / yield_unit → Tier 2 skipped
      menu_items: ['Baja Fish Tacos'],
    };
    const r = inferQtyForRecipe(recipe, 'baja fish tacos', 'BAJA FISH TACOS');
    assert.equal(r.confidence, 'low');
    assert.equal(r.qty, 2);
    assert.equal(r.unit, 'ea');
    assert.match(r.notes, /heuristic: 2 tacos per serving/);
  });

  it('Tier 3 — wings get 6 per serving when yield_unit is count-dim', () => {
    const recipe = {
      slug: 'wing_portion',
      yield_qty: 48,
      yield_unit: 'ea', // count → Tier 2 bails, Tier 3 takes over
      menu_items: ['Chicken Wings'],
    };
    const r = inferQtyForRecipe(recipe, 'chicken wings', 'Chicken Wings');
    assert.equal(r.confidence, 'low');
    assert.equal(r.qty, 6);
    assert.equal(r.unit, 'ea');
  });

  // ── Tier 4: blank when nothing matches ─────────────────────────
  it('Tier 4 — blank when no tier fires', () => {
    const recipe = {
      slug: 'mystery',
      // no explicit field, no yield, no matching heuristic dish name
      menu_items: ['Unknown Dish'],
    };
    const r = inferQtyForRecipe(recipe, 'unknown dish', 'Unknown Dish');
    assert.equal(r.confidence, 'blank');
    assert.equal(r.qty, '');
    assert.equal(r.unit, '');
    assert.match(r.notes, /could not infer/);
  });
});

describe('buildProposalRows — end-to-end', () => {
  it('emits one row per (target dish, matching recipe) with stable order', () => {
    const recipes = [
      // One sub-recipe for BAJA FISH TACOS (Tier 2)
      {
        slug: 'chipotle_aioli',
        name: 'Chipotle Aioli',
        yield_qty: 10,
        yield_unit: 'qt',
        menu_items: ['Baja Fish Tacos'],
      },
      // One for Quesa Birria Tacos (Tier 2)
      {
        slug: 'birria',
        name: 'Birria',
        yield_qty: 16,
        yield_unit: 'qt',
        menu_items: ['Quesa Birria Tacos'],
      },
      // Unrelated recipe — must NOT produce rows
      {
        slug: 'unrelated',
        name: 'Unrelated',
        yield_qty: 5,
        yield_unit: 'lb',
        menu_items: ['Some Other Dish'],
      },
      // Ambiguous menu_item text that should still match via substring norm
      {
        slug: 'mexi_relish',
        name: 'Mexi Relish',
        yield_qty: 6,
        yield_unit: 'qt',
        menu_items: ['Baja Fish Tacos (cabbage topping)'],
      },
    ];

    const rows = buildProposalRows(recipes);
    // Order: by TARGET_DISHES declaration order, then by recipe_slug asc.
    const labels = rows.map((r) => `${r.dish_name}|${r.recipe_slug}`);
    assert.deepEqual(labels, [
      'BAJA FISH TACOS|chipotle_aioli',
      'BAJA FISH TACOS|mexi_relish',
      'Quesa Birria Tacos|birria',
    ]);

    // Every row carries component_type='recipe' and blank vendor_ingredient.
    for (const r of rows) {
      assert.equal(r.component_type, 'recipe');
      assert.equal(r.vendor_ingredient, '');
      assert.equal(r.confidence, 'medium'); // all Tier 2 here
    }

    // chipotle_aioli alone serves one menu item → qty = yield_qty = 10
    const aioli = rows.find((r) => r.recipe_slug === 'chipotle_aioli');
    assert.equal(aioli.qty_per_serving, '10');
    assert.equal(aioli.unit, 'qt');
  });

  it('produces no rows when recipes have no target-dish matches', () => {
    const recipes = [
      { slug: 'x', yield_qty: 1, yield_unit: 'qt', menu_items: ['Nothing Interesting'] },
    ];
    assert.deepEqual(buildProposalRows(recipes), []);
  });

  it('covers all 6 target dishes — sanity check on TARGET_DISHES list', () => {
    // Guards against a future PR accidentally dropping a dish.
    const norms = TARGET_DISHES.map((t) => t.norm);
    assert.ok(norms.includes('baja fish tacos'));
    assert.ok(norms.includes('quesa birria tacos'));
    assert.ok(norms.includes('chicken wings'));
    assert.ok(norms.includes('the trio'));
    assert.ok(norms.includes('cobb salad'));
    assert.ok(norms.includes('pig wings'));
    assert.equal(TARGET_DISHES.length, 6);
  });
});
