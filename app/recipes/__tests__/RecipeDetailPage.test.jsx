// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

/**
 * Regression test for a real bug found while migrating
 * app/recipes/[slug]/page.jsx off the GH #250 @ts-nocheck baseline.
 *
 * data/cache/recipes.json mixes shapes for `procedure`: most recipes
 * (73/77) store a step-by-step array, but a handful of legacy imports
 * (green_salt, roasted_chicken_leg, roasted_root_veg, breakfast_burrito)
 * store one prose string instead — see app/api/recipes/[slug]/route.js's
 * write-side comment ("recipes.json mixes both shapes"). The page
 * treated `recipe.procedure` as an array unconditionally
 * (`recipe.procedure.length` / `.map`), which threw
 * `TypeError: recipe.procedure.map is not a function` and 500'd the
 * page for every string-shaped recipe.
 *
 * Pattern mirrors app/__tests__/TodayPage.searchParams.test.jsx: call
 * the async Server Component directly with Promise-wrapped params, and
 * mock out its data deps + child components so the test is isolated to
 * page.jsx's own rendering logic.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

const RECIPE_ARRAY_PROCEDURE = {
  slug: 'tacos',
  name: 'Tacos',
  ingredients: [],
  allergens: [],
  procedure: ['Sear the meat.', 'Warm the tortillas.'],
};

const RECIPE_STRING_PROCEDURE = {
  slug: 'green_salt',
  name: 'Green Salt',
  ingredients: [],
  allergens: [],
  // Real shape for 4/77 recipes in data/cache/recipes.json — a single
  // prose string, not an array of steps.
  procedure:
    'Blend herbs, lemon zest and garlic with half the salt; spread and dry under a heat lamp; fold in the remaining salt once dried.',
};

let currentRecipe = RECIPE_ARRAY_PROCEDURE;

jest.mock('../../../lib/data', () => ({
  getRecipeBySlug: (slug) => (slug === currentRecipe.slug ? currentRecipe : null),
}));

jest.mock('../../../lib/db', () => ({
  getDb: () => ({ prepare: () => ({ all: () => [] }) }),
}));

jest.mock('../../../lib/beoPrepHistory', () => ({
  getRecipePrepHistory: () => [],
}));

jest.mock(
  '../[slug]/RecipeScaler.jsx',
  () =>
    function MockRecipeScaler() {
      return React.createElement('div', { 'data-testid': 'recipe-scaler' });
    },
);
jest.mock(
  '../[slug]/PreviouslyPlatedAs.jsx',
  () =>
    function MockPreviouslyPlatedAs() {
      return React.createElement('div', { 'data-testid': 'prep-history' });
    },
);
jest.mock(
  '../[slug]/RecipePhotoStrip.jsx',
  () =>
    function MockRecipePhotoStrip() {
      return React.createElement('div', { 'data-testid': 'photo-strip' });
    },
);

import RecipeDetail from '../[slug]/page.jsx';

describe('RecipeDetail page — recipe.procedure shape', () => {
  afterEach(() => {
    currentRecipe = RECIPE_ARRAY_PROCEDURE;
  });

  test('renders array-shaped procedure as one line per step', async () => {
    currentRecipe = RECIPE_ARRAY_PROCEDURE;
    render(
      await RecipeDetail({
        params: Promise.resolve({ slug: 'tacos' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText('Sear the meat.')).toBeInTheDocument();
    expect(screen.getByText('Warm the tortillas.')).toBeInTheDocument();
  });

  test('does not crash on a string-shaped procedure (legacy recipes.json rows)', async () => {
    currentRecipe = RECIPE_STRING_PROCEDURE;
    render(
      await RecipeDetail({
        params: Promise.resolve({ slug: 'green_salt' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByText(
        'Blend herbs, lemon zest and garlic with half the salt; spread and dry under a heat lamp; fold in the remaining salt once dried.',
      ),
    ).toBeInTheDocument();
  });
});
