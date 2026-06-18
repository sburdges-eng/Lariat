#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { cascadedFromEightySix } = await import('../../lib/subRecipeGraph.ts');

/** @type {import('../../lib/data.ts').Recipe[]} */
const recipes = [
  {
    slug: 'lobster_bisque',
    name: 'Lobster Bisque',
    ingredients: [{ item: 'lobster stock', qty: 1, unit: 'qt' }],
    sub_recipes: [],
  },
  {
    slug: 'surf_turf',
    name: 'Surf & Turf',
    ingredients: [],
    sub_recipes: ['lobster_bisque'],
  },
  {
    slug: 'marinara',
    name: 'Marinara',
    ingredients: [{ item: 'roma tomatoes', qty: 2, unit: 'lb' }],
    sub_recipes: [],
  },
  {
    slug: 'pasta_plate',
    name: 'Pasta Plate',
    ingredients: [],
    sub_recipes: ['marinara'],
  },
];

describe('cascadedFromEightySix', () => {
  it('walks sub-recipe parents for an exact recipe 86', () => {
    const cascaded = cascadedFromEightySix(['Lobster Bisque'], recipes);
    assert.deepEqual(
      cascaded.map((r) => r.slug).sort(),
      ['surf_turf'],
    );
    assert.equal(cascaded[0]?.via, 'Lobster Bisque');
  });

  it('cascades when an 86 matches a recipe ingredient', () => {
    const cascaded = cascadedFromEightySix(['tomatoes'], recipes);
    assert.deepEqual(
      cascaded.map((r) => r.slug).sort(),
      ['marinara', 'pasta_plate'],
    );
  });

  it('keeps ingredient-matched roots on the cascade board', () => {
    const cascaded = cascadedFromEightySix(['tomatoes'], recipes);
    const marinara = cascaded.find((r) => r.slug === 'marinara');
    assert.ok(marinara);
    assert.equal(marinara.root_slug, 'marinara');
  });
});
