#!/usr/bin/env node
// Enforces byte-exact parity between scripts/lib/ingredient_key.py and
// lib/ingredientKey.ts. Regenerate the fixture with:
//   python3 scripts/lib/generate_ingredient_key_fixture.py
//
// Run: node --test tests/js/test-ingredient-key-parity.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'ingredient_key_parity.json',
);

describe('ingredientKey parity with Python normalizer', () => {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const pairs = JSON.parse(raw);

  it('fixture has at least 20 rows', () => {
    assert.ok(pairs.length >= 20, `fixture too small: ${pairs.length}`);
  });

  for (const { input, expected } of pairs) {
    it(`normalize(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(normalizeIngredientKey(input), expected);
    });
  }
});
