#!/usr/bin/env node
// Focused regression tests for ingredient allergen inference used by
// scripts/rebuild-cache.mjs.
//
// Run: node --test tests/js/test-rebuild-cache-allergens.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { inferAllergens } from '../../scripts/rebuild-cache.mjs';

const allergenMatrix = JSON.parse(fs.readFileSync('data/cache/allergen_matrix.json', 'utf-8'));
const recipes = JSON.parse(fs.readFileSync('data/cache/recipes.json', 'utf-8'));

function matrixBig9(recipeSlug, ingredient) {
  const row = allergenMatrix[recipeSlug].find((r) => r.ingredient === ingredient);
  assert.ok(row, `${recipeSlug} should include ${ingredient}`);
  return row.big9;
}

function recipeAllergens(recipeSlug) {
  const row = recipes.find((r) => r.slug === recipeSlug);
  assert.ok(row, `${recipeSlug} should exist`);
  return row.allergens;
}

describe('rebuild-cache ingredient allergen inference', () => {
  it('does not tag corn tortillas as wheat', () => {
    assert.deepEqual(inferAllergens('corn tortillas'), []);
  });

  it('still tags flour tortillas as wheat', () => {
    assert.deepEqual(inferAllergens('flour tortillas'), ['wheat']);
  });

  it('tags vanilla wafers as wheat', () => {
    assert.deepEqual(inferAllergens('vanilla wafers'), ['wheat']);
  });

  it('does not tag parmesan reggiano as eggs through the reggiano substring', () => {
    assert.deepEqual(inferAllergens('parmesan reggiano'), ['milk']);
  });

  it('still tags ciabatta loaf as wheat', () => {
    assert.deepEqual(inferAllergens('ciabatta loaf'), ['wheat']);
  });

  it('keeps cached mexican_dinner corn tortillas wheat-free', () => {
    assert.deepEqual(matrixBig9('mexican_dinner', 'corn tortillas'), []);
  });

  it('keeps cached banana_cream_pudding wheat declaration from vanilla wafers', () => {
    assert.deepEqual(matrixBig9('banana_cream_pudding', 'vanilla wafers'), ['wheat']);
    assert.ok(recipeAllergens('banana_cream_pudding').includes('wheat'));
  });
});
