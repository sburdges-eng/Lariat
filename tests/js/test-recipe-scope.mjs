#!/usr/bin/env node
// Run: node --experimental-strip-types --test tests/js/test-recipe-scope.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCateringRecipe,
  recipeMatchesScope,
} from '../../lib/recipeScope.ts';

test('isCateringRecipe flags BEO menu items and event packages', () => {
  assert.equal(
    isCateringRecipe({ menu_items: ['Mac Balls (BEO)'], category: 'appetizer' }),
    true,
  );
  assert.equal(
    isCateringRecipe({ menu_items: ['Nashville Hot Chicken'], category: 'prep' }),
    false,
  );
  assert.equal(
    isCateringRecipe({ menu_items: [], category: 'buffet' }),
    true,
  );
  assert.equal(
    isCateringRecipe({ menu_items: [], category: 'dinner' }),
    true,
  );
});

test('recipeMatchesScope defaults line book view to non-catering', () => {
  const line = { menu_items: ['Fish & Chips'], category: 'prep' };
  const catering = { menu_items: ['Gazpacho (BEO)'], category: 'soup' };

  assert.equal(recipeMatchesScope(line, 'book'), true);
  assert.equal(recipeMatchesScope(catering, 'book'), false);
  assert.equal(recipeMatchesScope(catering, 'catering'), true);
  assert.equal(recipeMatchesScope(line, 'all'), true);
  assert.equal(recipeMatchesScope(catering, 'all'), true);
});
