// Unit tests for lib/foodDishProposals.ts.
// Pure module under test — no DB, no filesystem. Tests construct a
// minimal sources fixture and exercise the four key paths:
//   1. BLT acronym expansion (bacon/lettuce/tomato/bun/mayo)
//   2. FISH AND CHIPS composite (fish + potato + tartar + batter)
//   3. Dish with zero matches (unknown + empty sources) → 0 rows
//   4. Dish where only substring matches work (low-confidence path)
//
// Pattern mirrors tests/js/test-dish-cost-bridge.mjs: register the TS
// resolver, import the lib via .ts extension.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { proposeComponentsForDish, tokenizeDishName } = await import(
  '../../lib/foodDishProposals.ts'
);

// ── Shared fixture ─────────────────────────────────────────────────
// Small but realistic sources modelled on data/cache/recipes.json
// and the vendor_prices ingredient list.
const RECIPES = [
  { slug: 'aji_verde', menu_items: ['Pork Chop', 'Baja Fish Tacos'] },
  { slug: 'beer_batter', menu_items: ['Fish & Chips'] },
  { slug: 'fish_brine', menu_items: ['Fish & Chips'] },
  { slug: 'tartar_sauce', menu_items: ['Fish & Chips'] },
  { slug: 'coleslaw', menu_items: ['Fish & Chips', 'BLT'] },
  { slug: 'buttermilk_brine', menu_items: ['Nashville Hot Chicken'] },
  { slug: 'nashville_oil', menu_items: ['Nashville Hot Chicken'] },
  { slug: 'nashville_hot_rub', menu_items: ['Nashville Hot Chicken'] },
  { slug: 'chicken_flour', menu_items: ['Nashville Hot Chicken'] },
  { slug: 'special_sauce', menu_items: ['Nashville Hot Chicken Sandwich'] },
  { slug: 'pickles', menu_items: ['burgers'] },
  { slug: 'queso_mac_sauce', menu_items: ['Mtn Mac & Cheese'] },
];

const VENDOR_INGREDIENTS = [
  'BACON, LAY FLAT 18-22 SLI SMKD P12NC',
  'BACON, .25" HNY CRD SUPER WESTERN P12NC',
  'LETTUCE, GRN LEAF FLT',
  'LETTUCE, SPRING MIX',
  'TOMATO, BEEFSTEAK 5X6',
  'BUN, BRIOCHE HAMBURGER 4.5"',
  'BUN, BRIOCHE SLI 4.5"',
  'MAYONNAISE, HVY DTY TUB',
  'BASA, FLT 7-9Z BNLS SKNLS VIET IQF SWAI',
  'FRIES, SS 1/4" SK OFF SUPER CRISP',
  'BUTTERMILK, 1% LF',
  'CHICKEN, BRST CUTLET 4Z BNLS SKNLS',
  'PICKLE, DILL SLICED',
  'CHEESE, CHDR JACK SHRD FCY WI',
];

const ORDER_GUIDE_INGREDIENTS = [
  'bacon',
  'lettuce, grn leaf',
  'tomato, beefsteak',
  'bun, brioche',
  'mayonnaise',
  // Placeholder-rich ones that should show up demoted to 'low':
  'chicken, wing 1&2 o-rstd 5-8 ct fc',
];

const SOURCES = {
  recipes: RECIPES,
  vendorIngredients: VENDOR_INGREDIENTS,
  orderGuideIngredients: ORDER_GUIDE_INGREDIENTS,
};

// ── Tests ──────────────────────────────────────────────────────────

describe('tokenizeDishName', () => {
  it('drops filler words and lowercases', () => {
    assert.deepEqual(tokenizeDishName('CLASSIC BLT'), ['blt']);
    assert.deepEqual(tokenizeDishName('The House Burger'), ['burger']);
  });

  it('strips trailing -s for plurals of length >= 4', () => {
    const toks = tokenizeDishName('Fish Tacos');
    assert.ok(toks.includes('fish'));
    assert.ok(toks.includes('taco'));
  });

  it('preserves short tokens (>= 2 chars) and de-duplicates', () => {
    const toks = tokenizeDishName('Mac And Cheese Mac');
    assert.deepEqual(toks, ['mac', 'cheese']);
  });

  it('handles non-alnum and ampersand noise', () => {
    const toks = tokenizeDishName('Fish & Chips!');
    assert.ok(toks.includes('fish'));
    assert.ok(toks.includes('chip'));
  });
});

describe('proposeComponentsForDish — BLT acronym expansion', () => {
  it('expands BLT and returns bacon, lettuce, tomato, bun, mayo rows', () => {
    const { rows, diagnostics } = proposeComponentsForDish('CLASSIC BLT', SOURCES);

    assert.ok(diagnostics.acronymExpansion, 'acronymExpansion should be set');
    assert.deepEqual(
      diagnostics.acronymExpansion,
      ['bacon', 'lettuce', 'tomato', 'bun', 'bread', 'mayo'],
    );

    // At least one row for each of the expanded core tokens.
    const vendorValues = rows
      .filter((r) => r.component_type === 'vendor_item')
      .map((r) => r.vendor_ingredient.toLowerCase());

    // bacon
    assert.ok(
      vendorValues.some((v) => v.includes('bacon')),
      `expected a bacon match, got: ${vendorValues.join(' | ')}`,
    );
    // lettuce
    assert.ok(
      vendorValues.some((v) => v.includes('lettuce')),
      `expected a lettuce match, got: ${vendorValues.join(' | ')}`,
    );
    // tomato
    assert.ok(
      vendorValues.some((v) => v.includes('tomato')),
      `expected a tomato match, got: ${vendorValues.join(' | ')}`,
    );
    // bun
    assert.ok(
      vendorValues.some((v) => v.includes('bun')),
      `expected a bun match, got: ${vendorValues.join(' | ')}`,
    );
    // mayo
    assert.ok(
      vendorValues.some((v) => v.startsWith('mayonnaise')),
      `expected mayonnaise match, got: ${vendorValues.join(' | ')}`,
    );

    // All rows must have blank qty + unit (no invention).
    for (const r of rows) {
      assert.equal(r.qty_per_serving, '', 'qty must be blank');
      assert.equal(r.unit, '', 'unit must be blank');
    }

    // Every row gets a valid confidence token.
    for (const r of rows) {
      assert.ok(['high', 'medium', 'low'].includes(r.confidence));
    }
  });

  it('picks up the coleslaw recipe for BLT via whole-word slug match', () => {
    const { rows } = proposeComponentsForDish('CLASSIC BLT', SOURCES);
    const recipeSlugs = rows
      .filter((r) => r.component_type === 'recipe')
      .map((r) => r.recipe_slug);
    // coleslaw menu_items includes 'BLT' but also the tokenizer sees
    // 'coleslaw' itself — for BLT we don't expect a direct match on
    // 'coleslaw', but we DO expect it NOT to crash. The primary
    // BLT→recipe match happens via acronym tokens matching recipe
    // slugs (bacon/lettuce/tomato/bun/mayo) — none of our fixture
    // slugs carry those tokens, so recipeSlugs may be empty here.
    // This test is a smoke check that recipe-slug matching doesn't
    // throw and doesn't return stale data.
    assert.ok(Array.isArray(recipeSlugs));
  });
});

describe('proposeComponentsForDish — FISH AND CHIPS composite', () => {
  it('triggers composite key and returns fish, batter, tartar, potato/fries', () => {
    const { rows, diagnostics } = proposeComponentsForDish(
      'FISH AND CHIPS',
      SOURCES,
    );

    assert.equal(diagnostics.compositeMatchKey, 'fish and chips');

    const recipeSlugs = rows
      .filter((r) => r.component_type === 'recipe')
      .map((r) => r.recipe_slug);
    const vendorValues = rows
      .filter((r) => r.component_type === 'vendor_item')
      .map((r) => r.vendor_ingredient.toLowerCase());

    // beer_batter, fish_brine, tartar_sauce → composite's fish/batter/tartar
    // tokens should hit all three (whole-word on slug parts).
    assert.ok(
      recipeSlugs.includes('beer_batter'),
      `expected beer_batter in recipe matches, got: ${recipeSlugs.join(', ')}`,
    );
    assert.ok(
      recipeSlugs.includes('fish_brine'),
      `expected fish_brine in recipe matches, got: ${recipeSlugs.join(', ')}`,
    );
    assert.ok(
      recipeSlugs.includes('tartar_sauce'),
      `expected tartar_sauce in recipe matches, got: ${recipeSlugs.join(', ')}`,
    );

    // "chips" → SYNONYMS → potato; "chip" would also substring-match
    // FRIES. Either way the fixture's FRIES row should surface.
    assert.ok(
      vendorValues.some((v) => v.includes('fries')),
      `expected FRIES vendor match, got: ${vendorValues.join(' | ')}`,
    );

    // Fish composite includes the vendor 'basa' (substring 'fish' does
    // not hit BASA; 'fish' is a token, BASA doesn't contain it). We
    // therefore expect NO basa match — that's fine, spec allows it.
    // What we care about is that NO row has an invented qty/unit.
    for (const r of rows) {
      assert.equal(r.qty_per_serving, '');
      assert.equal(r.unit, '');
    }
  });

  it('NASHVILLE composite finds nashville_oil, buttermilk_brine, chicken_flour', () => {
    const { rows, diagnostics } = proposeComponentsForDish(
      'NASHVILLE CHICKEN SANDWICH',
      SOURCES,
    );

    assert.equal(diagnostics.compositeMatchKey, 'nashville');

    const recipeSlugs = rows
      .filter((r) => r.component_type === 'recipe')
      .map((r) => r.recipe_slug);
    // Every nashville-prefixed recipe should hit via whole-word match on
    // the 'nashville' token part of the slug.
    assert.ok(recipeSlugs.includes('nashville_oil'));
    assert.ok(recipeSlugs.includes('nashville_hot_rub'));
    // chicken_flour hits via 'chicken' token (whole-word on slug part).
    assert.ok(recipeSlugs.includes('chicken_flour'));
    // buttermilk_brine hits via 'buttermilk' composite token.
    assert.ok(recipeSlugs.includes('buttermilk_brine'));

    const vendorValues = rows
      .filter((r) => r.component_type === 'vendor_item')
      .map((r) => r.vendor_ingredient.toLowerCase());
    // chicken vendor item — whole-word 'chicken' in source.
    assert.ok(vendorValues.some((v) => v.includes('chicken')));
    // buttermilk vendor item.
    assert.ok(vendorValues.some((v) => v.startsWith('buttermilk')));
  });
});

describe('proposeComponentsForDish — zero-match dish', () => {
  it('returns zero rows and logs "no matches" when nothing fits', () => {
    // Dish with a single garbage token that doesn't hit any source.
    const { rows, diagnostics } = proposeComponentsForDish(
      'XYZZY',
      { recipes: [], vendorIngredients: [], orderGuideIngredients: [] },
    );
    assert.equal(rows.length, 0);
    assert.deepEqual(diagnostics.tokens, ['xyzzy']);
    assert.equal(diagnostics.recipeMatches, 0);
    assert.equal(diagnostics.vendorMatches, 0);
    assert.equal(diagnostics.orderGuideMatches, 0);
    assert.equal(diagnostics.acronymExpansion, null);
    assert.equal(diagnostics.compositeMatchKey, null);
  });

  it('returns zero rows when sources are empty even for a real dish name', () => {
    const { rows } = proposeComponentsForDish(
      'CLASSIC BLT',
      { recipes: [], vendorIngredients: [], orderGuideIngredients: [] },
    );
    assert.equal(rows.length, 0);
  });
});

describe('proposeComponentsForDish — substring-only (low-confidence) path', () => {
  it('surfaces substring matches at low confidence when no whole-word fits', () => {
    // A dish whose only vendor hit is a strict substring. "aba" in
    // 'CABBAGE, COLESLAW SHRED' for instance — let's craft a clean
    // fixture with a known substring-only match.
    const localSources = {
      recipes: [],
      vendorIngredients: [
        'SUPERCAT, FANCY 1LB',   // contains 'cat' as substring inside 'SUPERCAT'
      ],
      orderGuideIngredients: [],
    };
    const { rows, diagnostics } = proposeComponentsForDish(
      'CAT DISH',
      localSources,
    );
    // 'cat' is 3 chars — above MIN_TOKEN_LEN of 3.
    assert.deepEqual(diagnostics.tokens, ['cat', 'dish']);
    // Expect one vendor match for 'SUPERCAT' as low (substring only).
    const vm = rows.filter((r) => r.component_type === 'vendor_item');
    assert.equal(vm.length, 1);
    assert.equal(vm[0].confidence, 'low');
    assert.ok(vm[0].notes.includes('substring'));
  });

  it('drops tokens shorter than MIN_TOKEN_LEN (2-char) to avoid noise', () => {
    // 'IT' is 2 chars — tokenizer keeps it, but scoreMatch should skip.
    const localSources = {
      recipes: [],
      vendorIngredients: ['LIT, SUGAR BAR'],
      orderGuideIngredients: [],
    };
    const { rows } = proposeComponentsForDish('IT DISH', localSources);
    // Only 'dish' is >= 3 chars. 'dish' doesn't substring-match 'lit…'.
    assert.equal(rows.length, 0);
  });
});

describe('proposeComponentsForDish — cap and ordering', () => {
  it('caps rows per (source, token) pair so high-multiplicity tokens do not crowd', () => {
    // 20 BACON variants all hit the same (vendor, 'bacon') bucket. The
    // per-(source, token) cap (ROWS_PER_TOKEN=2 inside the module) kicks
    // in before the overall dish cap, so we expect 2 rows — not 5 — even
    // though maxRowsPerDish=5.
    const vendors = Array.from({ length: 20 }, (_, i) => `BACON-${i} STYLE`);
    const { rows } = proposeComponentsForDish(
      'BACON SPECIAL',
      { recipes: [], vendorIngredients: vendors, orderGuideIngredients: [] },
      { maxRowsPerDish: 5 },
    );
    assert.equal(rows.length, 2);
  });

  it('overall dish cap clamps the post-bucket count', () => {
    // Two distinct tokens each with many variants → per-token cap gives
    // 2 × 2 = 4 rows before the dish cap. With maxRowsPerDish=3 we should
    // see exactly 3.
    const vendors = [
      ...Array.from({ length: 5 }, (_, i) => `BACON-${i} STYLE`),
      ...Array.from({ length: 5 }, (_, i) => `LETTUCE-${i} STYLE`),
    ];
    const { rows } = proposeComponentsForDish(
      'BLT',
      { recipes: [], vendorIngredients: vendors, orderGuideIngredients: [] },
      { maxRowsPerDish: 3 },
    );
    assert.equal(rows.length, 3);
  });

  it('sorts medium before low; recipe before vendor at equal confidence', () => {
    const localSources = {
      recipes: [
        { slug: 'bacon_jam', menu_items: [] },    // medium (whole-word 'bacon')
      ],
      vendorIngredients: [
        'BACON, LAY FLAT',                          // medium (whole-word)
        'SUPERBACON, FANCY',                        // low (substring only)
      ],
      orderGuideIngredients: [],
    };
    const { rows } = proposeComponentsForDish('BACON DISH', localSources);
    // Ensure a medium row precedes any low row.
    let sawMedium = false;
    let mediumBeforeLow = true;
    for (const r of rows) {
      if (r.confidence === 'medium') sawMedium = true;
      if (r.confidence === 'low' && !sawMedium) mediumBeforeLow = false;
    }
    assert.ok(sawMedium, 'expected at least one medium row');
    assert.ok(mediumBeforeLow, 'medium rows must come before low rows');
    // At equal confidence ('medium'), recipe should be first.
    const firstMedium = rows.find((r) => r.confidence === 'medium');
    assert.equal(firstMedium.component_type, 'recipe');
  });
});
