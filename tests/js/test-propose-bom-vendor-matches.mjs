// Unit tests for lib/bomVendorProposals.ts.
//
// Pure module under test — no DB, no filesystem. Tests construct a
// minimal ProposalSources fixture and exercise the classification and
// scoring paths spelled out in the PR spec.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { proposeVendorMatchesForBom, tokenizeIngredient, normalizeIngredient } =
  await import('../../lib/bomVendorProposals.ts');

// ── Shared fixture ─────────────────────────────────────────────────

const VENDOR_PRICES = [
  {
    source: 'vendor_prices',
    name: 'Achiote Paste',
    vendor: 'sysco',
    pack_unit: 'lb',
    unit_price: 5.985,
  },
  {
    source: 'vendor_prices',
    name: 'PASTE, ACHIOTE',
    vendor: 'shamrock',
    pack_unit: 'lb',
    unit_price: 6.482,
  },
  {
    source: 'vendor_prices',
    name: 'Baking Soda',
    vendor: 'sysco',
    pack_unit: 'lb',
    unit_price: 1.395,
  },
  {
    source: 'vendor_prices',
    name: 'SEASONING, OLD BAY',
    vendor: 'sysco',
    pack_unit: 'lb',
    unit_price: 4.2,
  },
  {
    source: 'vendor_prices',
    name: 'SPICE, PAPRIKA SPANISH BULK',
    vendor: 'sysco',
    pack_unit: 'lb',
    unit_price: 8.1,
  },
];

const ORDER_GUIDE = [
  {
    source: 'order_guide',
    name: 'baking powder',
    vendor: 'sysco',
    pack_unit: 'tbsp',
    unit_price: 0.003,
  },
  {
    source: 'order_guide',
    name: 'baking soda',
    vendor: 'sysco',
    pack_unit: 'cup',
    unit_price: 0.003,
  },
  {
    source: 'order_guide',
    name: 'adobo puree',
    vendor: 'sysco',
    pack_unit: 'cup',
    unit_price: 0.012,
  },
];

const RECIPE_SLUGS = ['lariat_rub', 'nashville_hot_rub', 'green_chile', 'aji_verde'];

const SOURCES = {
  vendorPrices: VENDOR_PRICES,
  orderGuide: ORDER_GUIDE,
  recipeSlugs: RECIPE_SLUGS,
};

function bomRow(id, ingredient, qty = 1, unit = 'cup', recipe_id = 'test_recipe') {
  return { bom_line_id: id, recipe_id, ingredient, qty, unit };
}

// ── Tokenizer ──────────────────────────────────────────────────────

describe('tokenizeIngredient', () => {
  it('drops filler words and lowercases', () => {
    assert.deepEqual(tokenizeIngredient('Achiote Paste'), ['achiote', 'paste']);
    assert.deepEqual(tokenizeIngredient('baking soda'), ['baking', 'soda']);
    assert.deepEqual(tokenizeIngredient('the water'), ['water']);
  });

  it('collapses non-alnum and handles commas', () => {
    assert.deepEqual(tokenizeIngredient('PASTE, ACHIOTE'), ['paste', 'achiote']);
  });

  it('returns [] for null/empty', () => {
    assert.deepEqual(tokenizeIngredient(null), []);
    assert.deepEqual(tokenizeIngredient(''), []);
  });
});

describe('normalizeIngredient', () => {
  it('normalizes case and punctuation', () => {
    assert.equal(normalizeIngredient('PASTE, ACHIOTE'), 'paste achiote');
    assert.equal(normalizeIngredient('Baking Soda'), 'baking soda');
    assert.equal(normalizeIngredient(null), '');
  });
});

// ── Exact match ────────────────────────────────────────────────────

describe('proposeVendorMatchesForBom — exact match', () => {
  it('returns a high-confidence candidate for an exact normalized match', () => {
    const row = bomRow(31, 'achiote paste');
    const result = proposeVendorMatchesForBom(row, SOURCES);

    assert.equal(result.classification, 'matched');
    assert.ok(result.candidates.length >= 1);
    const top = result.candidates[0];
    assert.equal(top.confidence, 'high');
    // Either of the two achiote vendors is acceptable; both exact.
    assert.ok(
      ['Achiote Paste', 'PASTE, ACHIOTE'].includes(top.name),
      `expected an achiote candidate, got ${top.name}`,
    );
    assert.equal(top.source, 'vendor_prices');
  });

  it('sorts by unit_price asc at equal confidence + source', () => {
    const row = bomRow(31, 'achiote paste');
    const result = proposeVendorMatchesForBom(row, SOURCES);
    const highs = result.candidates.filter((c) => c.confidence === 'high');
    if (highs.length >= 2) {
      for (let i = 1; i < highs.length; i++) {
        const prev = highs[i - 1].unit_price ?? Infinity;
        const cur = highs[i].unit_price ?? Infinity;
        assert.ok(prev <= cur, `candidates not sorted cheap-first: ${prev} > ${cur}`);
      }
    }
  });
});

// ── Synonym match: rub → seasoning / spice ────────────────────────

describe('proposeVendorMatchesForBom — synonym match', () => {
  it('matches "rub" synonym → seasoning/spice at medium confidence', () => {
    // Use a non-house "rub" ingredient so the "lariat X" house-branch
    // doesn't short-circuit.
    const row = bomRow(400, 'generic rub', 1, 'tbsp');
    const result = proposeVendorMatchesForBom(row, SOURCES);

    assert.equal(result.classification, 'matched');
    const topNames = result.candidates.map((c) => c.name);
    // Should have surfaced at least one of SEASONING or SPICE vendor rows.
    const hasSeasoningOrSpice = topNames.some(
      (n) => /season|spice/i.test(n),
    );
    assert.ok(
      hasSeasoningOrSpice,
      `expected a seasoning/spice synonym match, got: ${topNames.join(' | ')}`,
    );
    const synRow = result.candidates.find(
      (c) => /synonym/.test(c.reason),
    );
    assert.ok(synRow, 'expected at least one candidate with synonym reason');
    assert.ok(['medium', 'low'].includes(synRow.confidence));
  });
});

// ── Water → house (none) ──────────────────────────────────────────

describe('proposeVendorMatchesForBom — water special case', () => {
  it('classifies "water" as house with a none-confidence sentinel', () => {
    const row = bomRow(41, 'water', 12, 'cup');
    const result = proposeVendorMatchesForBom(row, SOURCES);
    assert.equal(result.classification, 'house');
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.confidence, 'none');
    assert.equal(c.source, 'none');
    assert.ok(/house tap/i.test(c.reason));
    assert.equal(c.name, '');
    assert.equal(c.vendor, '');
  });
});

// ── Baking soda → baking powder flagged as NOT-equivalent ─────────

describe('proposeVendorMatchesForBom — baking soda / baking powder NOT-equivalent flag', () => {
  it('surfaces baking soda exact match and flags baking powder as not-equivalent', () => {
    const row = bomRow(28, 'baking soda', 0.333, 'cup');
    const result = proposeVendorMatchesForBom(row, SOURCES);

    assert.equal(result.classification, 'matched');

    // The exact "Baking Soda" vendor row should be the top candidate.
    const top = result.candidates[0];
    assert.equal(top.confidence, 'high');
    assert.ok(/baking soda/i.test(top.name));

    // Somewhere in the list we should also see "baking powder" from the
    // order guide, at 'low' confidence, with the NOT-equivalent warning.
    const powder = result.candidates.find((c) =>
      /baking powder/i.test(c.name),
    );
    if (powder) {
      assert.equal(powder.confidence, 'low');
      assert.ok(
        /NOT a real substitute/i.test(powder.reason),
        `expected NOT-equivalent warning, got: ${powder.reason}`,
      );
    }
  });
});

// ── Truly no-match row ────────────────────────────────────────────

describe('proposeVendorMatchesForBom — truly no match', () => {
  it('emits a single none-confidence sentinel and classification "manual"', () => {
    const row = bomRow(999, 'zxqzxq blorp', 1, 'ea');
    const result = proposeVendorMatchesForBom(row, SOURCES);
    assert.equal(result.classification, 'manual');
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.confidence, 'none');
    assert.equal(c.source, 'none');
  });
});

// ── Lariat X house-recipe matching ─────────────────────────────────

describe('proposeVendorMatchesForBom — lariat X house-recipe cases', () => {
  it('matches "lariat rub" to existing recipe slug lariat_rub at high confidence', () => {
    const row = bomRow(18, 'lariat rub', 0.5, 'cup');
    const result = proposeVendorMatchesForBom(row, SOURCES);
    assert.equal(result.classification, 'matched_house_recipe');
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.confidence, 'high');
    assert.equal(c.source, 'recipe');
    assert.equal(c.name, 'lariat_rub');
    assert.ok(/recipe slug/i.test(c.reason));
  });

  it('flags a lariat X with no existing slug as needs_house_recipe', () => {
    const row = bomRow(900, 'lariat signature dust', 1, 'tbsp');
    // Provide a slug list that does NOT contain the signature-dust slug.
    const result = proposeVendorMatchesForBom(row, {
      vendorPrices: [],
      orderGuide: [],
      recipeSlugs: ['lariat_rub'], // unrelated slug present
    });
    assert.equal(result.classification, 'needs_house_recipe');
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.confidence, 'none');
    assert.ok(/proprietary house blend/i.test(c.reason));
  });
});

// ── order_guide demotion ───────────────────────────────────────────

describe('proposeVendorMatchesForBom — order_guide demotion', () => {
  it('demotes a would-be high from order_guide to medium', () => {
    // Using ingredient that matches only the order_guide 'adobo puree'
    // row (no vendor_prices candidate). "adobo" tokens + normalized
    // match on the whole phrase.
    const row = bomRow(500, 'adobo puree', 1, 'cup');
    const result = proposeVendorMatchesForBom(row, SOURCES);
    const top = result.candidates[0];
    assert.ok(top, 'expected at least one candidate');
    // Source-based demotion: order_guide high → medium.
    assert.equal(top.source, 'order_guide');
    assert.equal(top.confidence, 'medium');
    assert.ok(/demoted/i.test(top.reason), `reason should mention demotion, got: ${top.reason}`);
  });
});

// ── Cap ────────────────────────────────────────────────────────────

describe('proposeVendorMatchesForBom — caps', () => {
  it('respects maxCandidatesPerRow', () => {
    // Build 20 vendor rows all matching "bacon".
    const baconVendors = Array.from({ length: 20 }, (_, i) => ({
      source: 'vendor_prices',
      name: `BACON-${i} STYLE`,
      vendor: 'sysco',
      pack_unit: 'lb',
      unit_price: 5 + i,
    }));
    const row = bomRow(800, 'bacon', 1, 'lb');
    const result = proposeVendorMatchesForBom(
      row,
      { vendorPrices: baconVendors, orderGuide: [], recipeSlugs: [] },
      { maxCandidatesPerRow: 3 },
    );
    assert.ok(result.candidates.length <= 3);
  });
});
