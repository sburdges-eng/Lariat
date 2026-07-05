#!/usr/bin/env node
// Unit tests for scripts/rebuild-cache.mjs::inferAllergens — the ingredient
// phrase-matcher that infers Big 9 allergens when a recipe has no explicit
// allergen_matrix.csv row. containsIngredientPhrase requires a real word
// boundary on both sides of the matched key so a short key can't false-
// positive inside a longer word (e.g. "reggiano" must not match "egg").
// That boundary check was also silently rejecting plain English plurals:
// a singular dictionary key ("noodle", "bun", "cheese") failed to match the
// plural ingredient name recipes actually use ("noodles", "buns",
// "cheeses"), because the character immediately after the match ("s") is
// alphanumeric and so never satisfied the boundary — dropping a real
// allergen (wheat/wheat/milk) to a false [].
//
// Run: node --experimental-strip-types --test tests/js/test-rebuild-cache-allergens.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferAllergens } from '../../scripts/rebuild-cache.mjs';

describe('inferAllergens — plural ingredient names', () => {
  it('matches a plain "-s" plural of a dictionary key', () => {
    assert.deepEqual(inferAllergens('ziti noodles'), ['wheat']);
    assert.deepEqual(inferAllergens('ditalini noodles'), ['wheat']);
    assert.deepEqual(inferAllergens('bao buns (sysco)'), ['wheat']);
  });

  it('matches an "-es" plural of a key ending in a bare consonant/vowel', () => {
    assert.deepEqual(inferAllergens('assorted cheeses (vendor whole-buy)'), ['milk']);
  });

  it('still matches the exact singular form', () => {
    assert.deepEqual(inferAllergens('a noodle bowl'), ['wheat']);
    assert.deepEqual(inferAllergens('brioche bun'), ['wheat']);
  });
});

describe('inferAllergens — existing safety guarantees still hold', () => {
  it('does not false-positive a short key inside an unrelated longer word', () => {
    // "reggiano" contains "egg" as a raw substring but has no egg allergen.
    assert.deepEqual(inferAllergens('parmesan reggiano'), ['milk']);
  });

  it('returns [] for an ingredient with no known allergen', () => {
    assert.deepEqual(inferAllergens('pepper'), []);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    assert.deepEqual(inferAllergens('  ZITI NOODLES  '), ['wheat']);
  });

  it('dedupes when multiple keys match the same ingredient phrase', () => {
    assert.deepEqual(inferAllergens('soy sauce'), ['wheat', 'soybeans']);
  });
});
