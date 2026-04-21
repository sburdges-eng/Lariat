#!/usr/bin/env node
// Deterministic recipe calculator — the authoritative path for any
// kitchen-assistant numeric action. Verifies that:
//   1. scaleRecipe returns exact leaf totals for a known recipe.
//   2. A bad slug surfaces a CalculatorError with a useful code.
//   3. A bad multiplier is rejected synchronously.
//   4. expandForBEO multiplies by guestCount and returns per-recipe expansions.
//
// Run: node --experimental-strip-types --test tests/js/test-recipe-calculator.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CalculatorError,
  expandForBEO,
  formatLeafRowsAsTasks,
  scaleRecipe,
} from '../../lib/recipeCalculator.ts';

// pork_chop_marinade yields 1 gal with these fixed leaves (from normalized CSV):
const PORK_CHOP_LEAVES_1X = new Map([
  ['adobo seasoning|cup', 0.25],
  ['chopped garlic|cup', 0.25],
  ['cilantro|bunch', 1],
  ['cumin|cup', 0.25],
  ['garlic powder|cup', 0.25],
  ['lime juice|cup', 2],
  ['orange juice|cup', 2],
  ['pepper|cup', 0.25],
]);

describe('recipeCalculator', () => {
  it('scales a recipe to the exact leaf totals', async () => {
    const result = await scaleRecipe('pork_chop_marinade', 2);
    assert.equal(result.recipeSlug, 'pork_chop_marinade');
    assert.equal(result.targetUnit, 'gal');
    assert.equal(result.scaleFactor, 2);
    for (const leaf of result.leafRows) {
      const key = `${leaf.ingredient}|${leaf.unit}`;
      const base = PORK_CHOP_LEAVES_1X.get(key);
      assert.ok(base !== undefined, `unexpected leaf ${key}`);
      assert.ok(Math.abs(leaf.qty - base * 2) < 1e-9, `${key}: ${leaf.qty} vs ${base * 2}`);
    }
    assert.equal(result.leafRows.length, PORK_CHOP_LEAVES_1X.size);
  });

  it('rejects bad multipliers synchronously', async () => {
    await assert.rejects(() => scaleRecipe('pork_chop_marinade', 0), (e) => e instanceof CalculatorError && e.code === 'bad_multiplier');
    await assert.rejects(() => scaleRecipe('pork_chop_marinade', -3), (e) => e instanceof CalculatorError && e.code === 'bad_multiplier');
    await assert.rejects(() => scaleRecipe('pork_chop_marinade', Number.NaN), (e) => e instanceof CalculatorError && e.code === 'bad_multiplier');
  });

  it('surfaces unknown recipe as a CalculatorError', async () => {
    await assert.rejects(
      () => scaleRecipe('recipe_that_does_not_exist_anywhere', 1),
      (e) => e instanceof CalculatorError && e.message.toLowerCase().includes('unknown')
    );
  });

  it('expandForBEO scales each recipe by guest count × portions', async () => {
    const results = await expandForBEO(
      [{ slug: 'pork_chop_marinade', portionsPerGuest: 0.5 }],
      4 // 4 guests × 0.5 portions = 2 gal total
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].scaleFactor, 2);
    assert.equal(results[0].targetQty, 2);
  });

  it('formatLeafRowsAsTasks renders human task strings', () => {
    const tasks = formatLeafRowsAsTasks([
      { ingredient: 'orange juice', qty: 4, unit: 'cup' },
      { ingredient: 'cilantro', qty: 1, unit: 'bunch' },
    ]);
    assert.deepEqual(tasks, ['4 cup orange juice', '1 bunch cilantro']);
  });
});
