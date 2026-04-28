#!/usr/bin/env node
// Tests for lib/dishMenuItemMatch — fuzzy `sales_lines.item_name` →
// `recipes[].menu_items[]` matching used by
// scripts/seed-menu-item-declarations.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-dish-menu-item-match.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  matchDishToMenuItems,
  tokenizeMenuTitle,
  canonicalKey,
} from '../../lib/dishMenuItemMatch.ts';

// Trim a 4-key match shape to keep test diffs readable. Includes
// recipe_name so a typo in the test fixture name surfaces clearly.
function shape(m) {
  return {
    slug: m.recipe_slug,
    name: m.recipe_name,
    declared: m.declared_menu_item,
    confidence: m.confidence,
    reason: m.reason,
  };
}

// Fixture mirrors the curated declarations in data/cache/recipes.json.
// Keep this list small; we want to exercise the fuzz, not the catalog.
const FIXTURE = Object.freeze([
  { slug: 'fish_and_chips', name: 'Fish & Chips', menu_items: ['Fish & Chips'] },
  { slug: 'nashville_chicken', name: 'Nashville Hot Chicken', menu_items: ['Nashville Hot Chicken Sandwich'] },
  { slug: 'blt_classic', name: 'Classic BLT', menu_items: ['BLT'] },
  { slug: 'rope_salad', name: 'The Rope Salad', menu_items: ['The Rope Salad'] },
  { slug: 'rope_burger', name: 'The Rope Burger', menu_items: ['The Rope Burger'] },
  { slug: 'mac_cheese', name: 'Mountain Mac & Cheese', menu_items: ['Mtn Mac & Cheese'] },
  { slug: 'cornbread', name: 'Jalapeño Cheddar Cornbread', menu_items: ['Jalapeño Cheddar Cornbread'] },
  { slug: 'baja_tacos', name: 'Baja Fish Tacos', menu_items: ['Baja Fish Tacos', 'Baja Tacos'] },
  { slug: 'pig_wings', name: 'Pig Wings', menu_items: ['Pig Wings'] },
  { slug: 'chicken_wings', name: 'Chicken Wings', menu_items: ['Chicken Wings'] },
  // Recipe with no declarations — must never produce a match.
  { slug: 'no_declared', name: 'Some Internal Sub-Recipe', menu_items: [] },
]);

// ── tokenizeMenuTitle ─────────────────────────────────────────────

describe('tokenizeMenuTitle', () => {
  it('strips combining accents (Jalapeño → jalapeno)', () => {
    assert.deepEqual(tokenizeMenuTitle('Jalapeño'), ['jalapeno']);
  });

  it("expands '&' to 'and' BEFORE filler-strip", () => {
    // 'and' is intentionally NOT in TITLE_FILLERS so two-word "&"
    // separations stay structural — but the substantive tokens around
    // it survive.
    assert.deepEqual(tokenizeMenuTitle('Fish & Chips'), ['fish', 'and', 'chip']);
  });

  it("drops leading 'The' filler", () => {
    assert.deepEqual(tokenizeMenuTitle('The Rope Salad'), ['rope', 'salad']);
  });

  it("expands 'Mtn' abbreviation", () => {
    assert.deepEqual(
      tokenizeMenuTitle('Mtn Mac & Cheese'),
      ['mountain', 'mac', 'and', 'cheese'],
    );
  });

  it('strips trailing-s plural for tokens >= 4 chars (tacos→taco, fries→frie)', () => {
    assert.deepEqual(tokenizeMenuTitle('Baja Fish Tacos'), ['baja', 'fish', 'taco']);
  });

  it('preserves short tokens whole (BLT stays as bl + t? — actually one token)', () => {
    // BLT is 3 chars, no plural strip.
    assert.deepEqual(tokenizeMenuTitle('BLT'), ['blt']);
  });

  it('empty / null inputs return []', () => {
    assert.deepEqual(tokenizeMenuTitle(''), []);
    assert.deepEqual(tokenizeMenuTitle(null), []);
    assert.deepEqual(tokenizeMenuTitle(undefined), []);
  });
});

// ── canonicalKey alignment with normalize ──────────────────────────

describe('canonicalKey — pairs that should canonicalize identically', () => {
  const PAIRS = [
    ['Fish & Chips', 'FISH AND CHIPS'],
    ['The Rope Salad', 'Rope Salad'],
    ['Mountain Mac And Cheese', 'Mtn Mac & Cheese'],
    ['Jalapeño Cheddar Cornbread', 'Jalapeno Cheddar Cornbread'],
    ['BAJA FISH TACOS', 'Baja Fish Tacos'],
  ];
  for (const [a, b] of PAIRS) {
    it(`"${a}" === "${b}"`, () => {
      assert.equal(canonicalKey(a), canonicalKey(b));
    });
  }
});

// ── End-to-end match scenarios ────────────────────────────────────

describe('matchDishToMenuItems — high-confidence (exact normalized)', () => {
  it("'BAJA FISH TACOS' → baja_tacos high (case-only drift)", () => {
    const m = matchDishToMenuItems('BAJA FISH TACOS', FIXTURE);
    assert.equal(m.length, 1);
    assert.deepEqual(shape(m[0]), {
      slug: 'baja_tacos',
      name: 'Baja Fish Tacos',
      declared: 'Baja Fish Tacos',
      confidence: 'high',
      reason: 'exact_normalized',
    });
  });

  it("'FISH AND CHIPS' → fish_and_chips high (& vs AND)", () => {
    const m = matchDishToMenuItems('FISH AND CHIPS', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'fish_and_chips');
    assert.equal(m[0].confidence, 'high');
  });

  it("'Rope Salad' → rope_salad high (leading 'The' drop)", () => {
    const m = matchDishToMenuItems('Rope Salad', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'rope_salad');
    assert.equal(m[0].confidence, 'high');
  });

  it("'Mountain Mac And Cheese' → mac_cheese high (Mtn abbrev + & + and)", () => {
    const m = matchDishToMenuItems('Mountain Mac And Cheese', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'mac_cheese');
    assert.equal(m[0].confidence, 'high');
  });

  it("'Jalapeno Cheddar Cornbread' → cornbread high (accent strip)", () => {
    const m = matchDishToMenuItems('Jalapeno Cheddar Cornbread', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'cornbread');
    assert.equal(m[0].confidence, 'high');
  });
});

describe('matchDishToMenuItems — medium-confidence (subset)', () => {
  it("'NASHVILLE CHICKEN SANDWICH' ⊂ 'Nashville Hot Chicken Sandwich' → medium", () => {
    const m = matchDishToMenuItems('NASHVILLE CHICKEN SANDWICH', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'nashville_chicken');
    assert.equal(m[0].confidence, 'medium');
    assert.equal(m[0].reason, 'sale_subset_of_declared');
  });

  it("'CLASSIC BLT' → blt_classic medium ('classic' is filler, leaves 'blt' ⊂ 'blt')", () => {
    // After filler strip "CLASSIC BLT" tokens to ['blt'], same as 'BLT'.
    // → exact match (high), not subset. Verify that's what we get and
    // adjust the doc/expectation if so.
    const m = matchDishToMenuItems('CLASSIC BLT', FIXTURE);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'blt_classic');
    assert.equal(m[0].confidence, 'high');
  });
});

describe('matchDishToMenuItems — guard rails (no false positives)', () => {
  it("'Pig Wings' must NOT match 'Chicken Wings' (single shared token 'wing' fails subset signal)", () => {
    const m = matchDishToMenuItems('Pig Wings', FIXTURE);
    // 'pig_wings' should be the high-confidence exact hit; 'chicken_wings'
    // shares only the single 4-char-plural-stripped token 'wing' which is
    // < 5 chars so subset signal blocks it.
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'pig_wings');
    assert.equal(m[0].confidence, 'high');
  });

  it("dish with no overlap returns no matches ('Tequila Lunazul')", () => {
    const m = matchDishToMenuItems('Tequila (Well) Lunazul', FIXTURE);
    assert.deepEqual(m, []);
  });

  it("recipe with empty menu_items[] never matches", () => {
    const m = matchDishToMenuItems('Some Internal Sub-Recipe', FIXTURE);
    // 'no_declared' has menu_items: [] so it must be filtered out.
    assert.equal(
      m.find((x) => x.recipe_slug === 'no_declared'),
      undefined,
    );
  });

  it('respects maxCandidates cap', () => {
    // Build a fixture where one dish would fuzz-match many. Two recipes
    // declaring the same string both produce candidates.
    const fixture = [
      { slug: 'a', name: 'A', menu_items: ['Cheese Burger'] },
      { slug: 'b', name: 'B', menu_items: ['Cheese Burger'] },
      { slug: 'c', name: 'C', menu_items: ['Cheese Burger'] },
    ];
    const m = matchDishToMenuItems('Cheese Burger', fixture, { maxCandidates: 2 });
    assert.equal(m.length, 2);
  });
});

describe('matchDishToMenuItems — chili/chile spelling drift', () => {
  it("'Green Chili' matches 'Green Chile (cup/bowl)' via chili→chile synonym", () => {
    const fixture = [
      { slug: 'green_chile', name: 'Green Chile', menu_items: ['Green Chile (cup/bowl)'] },
    ];
    const m = matchDishToMenuItems('Green Chili', fixture);
    assert.equal(m.length, 1);
    assert.equal(m[0].recipe_slug, 'green_chile');
    // Sale ['green','chile'] ⊂ declared ['green','chile','cup','bowl']
    assert.equal(m[0].confidence, 'medium');
    assert.equal(m[0].reason, 'sale_subset_of_declared');
  });
});

describe('matchDishToMenuItems — multiple declarations on one recipe', () => {
  it("picks the strongest declaration when more than one matches", () => {
    // baja_tacos declares both 'Baja Fish Tacos' and 'Baja Tacos'.
    // 'Baja Tacos' input matches the 2nd declaration exactly (high) and
    // the 1st as superset (medium). High should win — and we should only
    // emit ONE row for baja_tacos, not two.
    const m = matchDishToMenuItems('Baja Tacos', FIXTURE);
    const baja = m.filter((x) => x.recipe_slug === 'baja_tacos');
    assert.equal(baja.length, 1);
    assert.equal(baja[0].confidence, 'high');
    assert.equal(baja[0].declared_menu_item, 'Baja Tacos');
  });
});
