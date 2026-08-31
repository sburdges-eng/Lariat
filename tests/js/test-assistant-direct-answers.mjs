import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryDirectRecipeAnswer,
  findRecipe,
  normalizeText,
} from '../../lib/assistantDirectAnswers.ts';

// Real-shaped fixtures — mirrors data/cache/recipes.json entries, including
// the kitchen's three chili spellings living side by side.
const RECIPES = [
  {
    slug: 'green_chilli',
    name: 'Green Chilli',
    station: 'expo',
    yield_qty: 8,
    yield_unit: 'qt',
    menu_items: ['Green Chilli (cup/bowl)'],
    allergens: ['wheat'],
    ingredients: [
      { item: 'pork butt', qty: 10, unit: 'lb' },
      { item: 'water', qty: 5, unit: 'cup' },
      { item: 'tomatillos', qty: 2, unit: '#10 can' },
      { item: 'hatch chile with juice', qty: 2, unit: 'bag' },
      { item: 'yellow onions', qty: 1.75, unit: 'lb' },
    ],
  },
  {
    slug: 'birria',
    name: 'Birria',
    station: 'grill',
    yield_qty: 16,
    yield_unit: 'qt',
    menu_items: ['Quesa Birria Tacos'],
    sub_recipes: ['qb_seasoning'],
    allergens: [],
    ingredients: [
      { item: 'beef cheeks', qty: 20, unit: 'lb' },
      { item: 'qb seasoning', qty: 2, unit: 'cup' },
    ],
  },
  {
    slug: 'cornbread',
    name: 'Jalapeño Cheddar Cornbread',
    station: 'grill',
    yield_qty: 2,
    yield_unit: 'pan',
    menu_items: ['Jalapeño Cheddar Cornbread', 'cornbread croutons'],
    allergens: ['wheat', 'dairy', 'egg'],
    ingredients: [
      { item: 'cornmeal', qty: 4, unit: 'cup' },
      { item: 'jalapeños', qty: 6, unit: 'each' },
    ],
  },
];

test('the water question — the exact live failure — answers with the line', () => {
  const r = tryDirectRecipeAnswer('how many cups of water in the green chilli', RECIPES);
  assert.ok(r, 'expected a direct answer');
  assert.equal(r.answer, 'Green Chilli: water — 5 cup (whole recipe makes 8 qt).');
});

test('chili/chile spellings resolve to the chilli card', () => {
  for (const spelling of ['green chili', 'green chile']) {
    const r = tryDirectRecipeAnswer(`how much water in the ${spelling}`, RECIPES);
    assert.ok(r, `expected answer for "${spelling}"`);
    assert.match(r.answer, /water — 5 cup/);
  }
});

test('menu-item name resolves the recipe ("quesa birria recipe" → Birria card)', () => {
  const r = tryDirectRecipeAnswer('quesa birria recipe', RECIPES);
  assert.ok(r);
  assert.match(r.answer, /^Birria — makes 16 qt · grill/);
  assert.match(r.answer, /beef cheeks — 20 lb/);
  assert.match(r.answer, /Sub-recipes: qb_seasoning/);
});

test('bare recipe mention returns the card', () => {
  const r = tryDirectRecipeAnswer('green chilli', RECIPES);
  assert.ok(r);
  assert.match(r.answer, /^Green Chilli — makes 8 qt · expo/);
  assert.match(r.answer, /• pork butt — 10 lb/);
  assert.match(r.answer, /Tags: wheat/);
});

test('diacritics: "jalapeno cheddar cornbread" matches the ñ name', () => {
  const r = tryDirectRecipeAnswer('whats in the jalapeno cheddar cornbread', RECIPES);
  assert.ok(r);
  assert.match(r.answer, /cornmeal — 4 cup/);
});

test('quantity asked for an absent ingredient answers truthfully, not with a denial template', () => {
  const r = tryDirectRecipeAnswer('how much cream in the green chilli', RECIPES);
  assert.ok(r);
  assert.match(r.answer, /doesn't list cream as an ingredient/);
  assert.match(r.answer, /card/);
});

test('recipe book request lists by station', () => {
  const r = tryDirectRecipeAnswer('recipe book', RECIPES);
  assert.ok(r);
  assert.match(r.answer, /^3 recipes on file:/);
  assert.match(r.answer, /GRILL: Birria, Jalapeño Cheddar Cornbread/);
  assert.match(r.answer, /EXPO: Green Chilli/);
  assert.match(r.answer, /Reference board/);
});

test('allergen-intent questions ALWAYS fall through to the LLM', () => {
  assert.equal(tryDirectRecipeAnswer('is the green chilli gluten free', RECIPES), null);
  assert.equal(tryDirectRecipeAnswer('is the cornbread safe for a dairy allergy', RECIPES), null);
  assert.equal(tryDirectRecipeAnswer('what allergens are in the birria', RECIPES), null);
});

test('no confident recipe match falls through', () => {
  assert.equal(tryDirectRecipeAnswer('how do I fix the fryer', RECIPES), null);
  assert.equal(tryDirectRecipeAnswer('what did we sell yesterday', RECIPES), null);
});

test('operational question mentioning a recipe with leftover intent falls through', () => {
  // "86 the birria today?" style analytics/ops stay with the LLM.
  assert.equal(tryDirectRecipeAnswer('why was birria 86d yesterday', RECIPES), null);
});

test('findRecipe prefers the longest phrase and reports ambiguity as null', () => {
  const m = findRecipe('quesa birria tacos', RECIPES);
  assert.equal(m.recipe.slug, 'birria');
  assert.equal(m.matchedPhrase, 'quesa birria tacos');
});

test('normalizeText folds kitchen spellings', () => {
  assert.equal(normalizeText('Green CHILLI'), 'green chili');
  assert.equal(normalizeText('hatch chile'), 'hatch chili');
  assert.equal(normalizeText('Jalapeño'), 'jalapeno');
});

test('retrieval phrasing falls through to semantic search even with a recipe name', () => {
  assert.equal(
    tryDirectRecipeAnswer('Find that wedding cake recipe with the cherry filling.', RECIPES),
    null,
  );
  assert.equal(tryDirectRecipeAnswer('search for the birria recipe notes', RECIPES), null);
  assert.equal(tryDirectRecipeAnswer('look up green chilli prep from last week', RECIPES), null);
});

test('card intent with heavy extra content falls through', () => {
  assert.equal(
    tryDirectRecipeAnswer('birria recipe changes from the meeting yesterday about brisket', RECIPES),
    null,
  );
});
