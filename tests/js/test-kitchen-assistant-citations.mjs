#!/usr/bin/env node
// Tests for app/kitchen-assistant/citationHelpers.js — pure helpers
// for the data-pack citation drill-in inside KitchenAssistantClient.
// They mirror the unit-formatting / NUTRIENT_PRIORITY logic from
// lib/kitchenAssistantContext.ts (the spec calls for duplication, not
// shared infrastructure), so this suite pins the duplicate's behaviour
// and guards against drift.
//
// Run: node --experimental-strip-types --test tests/js/test-kitchen-assistant-citations.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Resolver hook lets the constant-drift guard at the bottom import the
// .ts canonical copy from `lib/kitchenAssistantContext.ts` alongside the
// .js helpers. Without it, Node's ESM resolver wouldn't find the .ts.
register(new URL('./resolver.mjs', import.meta.url));

import {
  FDA_BODY_EXCERPT_CHARS,
  NUTRIENT_PRIORITY,
  PRIORITY_DISPLAY,
  excerptBody,
  formatFdaCitation,
  formatUnit,
  formatUsdaCitation,
  pickPriorityNutrients,
} from '../../app/kitchen-assistant/citationHelpers.js';

const libCtx = await import('../../lib/kitchenAssistantContext.ts');

// ── excerptBody ─────────────────────────────────────────────────

describe('excerptBody', () => {
  it('returns empty string for null / undefined / empty', () => {
    assert.equal(excerptBody(null), '');
    assert.equal(excerptBody(undefined), '');
    assert.equal(excerptBody(''), '');
  });

  it('passes short bodies through unchanged', () => {
    const body = 'Section 3-501.13: Thaw food safely.';
    assert.equal(excerptBody(body), body);
  });

  it('truncates long bodies to <= FDA_BODY_EXCERPT_CHARS chars', () => {
    const body = 'x'.repeat(2000);
    const out = excerptBody(body);
    assert.equal(out.length, FDA_BODY_EXCERPT_CHARS);
    assert.equal(out.endsWith('…'), true);
  });

  it('honours an explicit max', () => {
    const out = excerptBody('hello world', 5);
    assert.equal(out.length, 5);
    assert.equal(out, 'hell…');
  });

  it('coerces non-string input to string', () => {
    assert.equal(excerptBody(123), '123');
  });
});

// ── formatUnit ──────────────────────────────────────────────────

describe('formatUnit — lowercase / canonical mapping', () => {
  it('maps KCAL to kcal (NOT KCAL)', () => {
    assert.equal(formatUnit('KCAL'), 'kcal');
  });

  it('maps G to g, MG to mg, UG to µg', () => {
    assert.equal(formatUnit('G'), 'g');
    assert.equal(formatUnit('MG'), 'mg');
    assert.equal(formatUnit('UG'), 'µg');
  });

  it('keeps IU and kJ as-is (already correct casing)', () => {
    assert.equal(formatUnit('IU'), 'IU');
    assert.equal(formatUnit('kJ'), 'kJ');
  });

  it('returns empty for null / undefined / non-string', () => {
    assert.equal(formatUnit(null), '');
    assert.equal(formatUnit(undefined), '');
    assert.equal(formatUnit(42), '');
  });

  it('passes unknown unit names through unchanged', () => {
    assert.equal(formatUnit('PCT_DV'), 'PCT_DV');
  });
});

// ── pickPriorityNutrients ───────────────────────────────────────

const SAMPLE_NUTRIENTS = [
  { nutrient_id: 1008, nutrient_name: 'Energy', amount: 109, unit_name: 'KCAL' },
  { nutrient_id: 1003, nutrient_name: 'Protein', amount: 11.1, unit_name: 'G' },
  { nutrient_id: 1005, nutrient_name: 'Carbohydrate, by difference', amount: 4.2, unit_name: 'G' },
  { nutrient_id: 1004, nutrient_name: 'Total lipid (fat)', amount: 6.5, unit_name: 'G' },
  { nutrient_id: 1093, nutrient_name: 'Sodium, Na', amount: 124, unit_name: 'MG' },
  { nutrient_id: 2000, nutrient_name: 'Sugars, total including NLEA', amount: 0.5, unit_name: 'G' },
  // Noise — should be filtered out (not in priority).
  { nutrient_id: 9999, nutrient_name: 'Vitamin C', amount: 0.0, unit_name: 'MG' },
];

describe('pickPriorityNutrients', () => {
  it('returns empty for missing / non-array input', () => {
    assert.deepEqual(pickPriorityNutrients(null), []);
    assert.deepEqual(pickPriorityNutrients(undefined), []);
    assert.deepEqual(pickPriorityNutrients('nope'), []);
    assert.deepEqual(pickPriorityNutrients([]), []);
  });

  it('returns priority nutrients in NUTRIENT_PRIORITY order', () => {
    const out = pickPriorityNutrients(SAMPLE_NUTRIENTS);
    assert.equal(out.length, 6);
    // Order matches NUTRIENT_PRIORITY (Energy first, Sugars last).
    assert.equal(out[0].nutrient_name, 'Energy');
    assert.equal(out[1].nutrient_name, 'Protein');
    assert.equal(out[2].nutrient_name, 'Carbohydrate, by difference');
    assert.equal(out[3].nutrient_name, 'Total lipid (fat)');
    assert.equal(out[4].nutrient_name, 'Sodium, Na');
    assert.equal(out[5].nutrient_name, 'Sugars, total including NLEA');
  });

  it('annotates each nutrient with displayName + lowercased displayUnit', () => {
    const out = pickPriorityNutrients(SAMPLE_NUTRIENTS);
    const energy = out.find((n) => n.nutrient_name === 'Energy');
    assert.equal(energy.displayUnit, 'kcal');
    assert.equal(energy.displayName, 'Energy');
  });

  it('renames Total lipid (fat) → Fat (short-name display)', () => {
    const out = pickPriorityNutrients(SAMPLE_NUTRIENTS);
    const fat = out.find((n) => n.nutrient_name === 'Total lipid (fat)');
    assert.equal(fat.displayName, 'Fat');
    assert.equal(fat.displayUnit, 'g');
  });

  it('renames Sodium, Na → Sodium and Sugars, total → Sugars', () => {
    const out = pickPriorityNutrients(SAMPLE_NUTRIENTS);
    const sodium = out.find((n) => n.nutrient_name === 'Sodium, Na');
    assert.equal(sodium.displayName, 'Sodium');
    assert.equal(sodium.displayUnit, 'mg');
    const sugars = out.find((n) =>
      n.nutrient_name.startsWith('Sugars, total')
    );
    assert.equal(sugars.displayName, 'Sugars');
  });

  it('skips priority entries not in the input (graceful)', () => {
    const sparse = [
      { nutrient_id: 1008, nutrient_name: 'Energy', amount: 50, unit_name: 'KCAL' },
    ];
    const out = pickPriorityNutrients(sparse);
    assert.equal(out.length, 1);
    assert.equal(out[0].displayName, 'Energy');
  });

  it('skips entries with null/undefined amount', () => {
    const partial = [
      { nutrient_id: 1008, nutrient_name: 'Energy', amount: null, unit_name: 'KCAL' },
      { nutrient_id: 1003, nutrient_name: 'Protein', amount: 5, unit_name: 'G' },
    ];
    const out = pickPriorityNutrients(partial);
    assert.equal(out.length, 1);
    assert.equal(out[0].nutrient_name, 'Protein');
  });

  it('handles entries missing nutrient_name without throwing', () => {
    const malformed = [
      { nutrient_id: 1008, amount: 50, unit_name: 'KCAL' },
      { nutrient_id: 1003, nutrient_name: null, amount: 5, unit_name: 'G' },
      { nutrient_id: 1005, nutrient_name: 'Energy', amount: 5, unit_name: 'KCAL' },
    ];
    const out = pickPriorityNutrients(malformed);
    assert.equal(out.length, 1);
    assert.equal(out[0].nutrient_name, 'Energy');
  });
});

// ── formatFdaCitation ───────────────────────────────────────────

describe('formatFdaCitation', () => {
  it('collapses FTS envelope + section follow-up into one citation', () => {
    const hit = {
      source: 'fda',
      id: 412,
      title: 'Reheating for Hot Holding',
      subtitle: '3-403.11',
      extra: 'Ch. 3',
      score: -1.5,
    };
    const sectionRow = {
      rowid: 412,
      section_id: '3-403.11',
      title: 'Reheating for Hot Holding',
      chapter: '3',
      annex: null,
      body: 'Cooked and refrigerated food that is prepared for immediate service may be served at any temperature.',
    };
    const c = formatFdaCitation(hit, sectionRow);
    assert.equal(c.title, 'Reheating for Hot Holding');
    assert.equal(c.sectionId, '3-403.11');
    assert.equal(c.chapter, '3');
    assert.equal(c.annex, '');
    assert.equal(c.rowid, 412);
    assert.equal(c.excerpt, sectionRow.body);
  });

  it('contains both section_id and a body excerpt under ~400 chars', () => {
    const hit = {
      source: 'fda_food_code',
      rowid: 100,
      title: 'Time-Temperature Control for Safety',
      section_id: '3-501.13',
      chapter: '3',
    };
    const sectionRow = {
      rowid: 100,
      section_id: '3-501.13',
      title: 'Time-Temperature Control for Safety',
      chapter: '3',
      body: 'A'.repeat(2000), // very long body
    };
    const c = formatFdaCitation(hit, sectionRow);
    assert.equal(c.sectionId, '3-501.13');
    assert.ok(c.excerpt.length > 0, 'excerpt should be non-empty');
    assert.ok(
      c.excerpt.length <= 400,
      `excerpt should be <= 400 chars (got ${c.excerpt.length})`
    );
    assert.ok(c.excerpt.endsWith('…'), 'excerpt should end with ellipsis');
  });

  it('handles semantic envelope (chapter/annex separate, rowid)', () => {
    const hit = {
      source: 'fda_food_code',
      rowid: 7,
      title: 'Highly Susceptible Populations',
      section_id: '3-801.11',
      annex: 'A',
      score: 0.82,
    };
    const c = formatFdaCitation(hit, null);
    assert.equal(c.sectionId, '3-801.11');
    assert.equal(c.annex, 'A');
    assert.equal(c.rowid, 7);
    assert.equal(c.excerpt, ''); // no follow-up yet
  });

  it('falls back to extra string when chapter/annex are not separate', () => {
    const hit = {
      source: 'fda',
      id: 50,
      title: 'Demonstration of Knowledge',
      subtitle: '2-102.11',
      extra: 'Ch. 2 / Annex 4',
      score: -2,
    };
    const c = formatFdaCitation(hit, null);
    assert.equal(c.chapter, 'Ch. 2 / Annex 4');
  });

  it('handles empty body / null fields gracefully', () => {
    const hit = {};
    const sectionRow = { body: '' };
    const c = formatFdaCitation(hit, sectionRow);
    assert.equal(c.title, '');
    assert.equal(c.sectionId, '');
    assert.equal(c.excerpt, '');
    assert.equal(c.rowid, null);
  });

  it('coerces numeric rowid candidates correctly', () => {
    const hit = { id: '42' };
    const c = formatFdaCitation(hit, null);
    assert.equal(c.rowid, 42);
  });
});

// ── formatUsdaCitation ──────────────────────────────────────────

describe('formatUsdaCitation', () => {
  it('builds a citation from FTS hit + food row + nutrients', () => {
    const hit = {
      source: 'usda',
      id: 173410,
      title: 'Cheese, cheddar',
      subtitle: 'Dairy and Egg Products',
      score: -1.2,
    };
    const foodRow = {
      fdc_id: 173410,
      description: 'Cheese, cheddar',
      food_category: 'Dairy and Egg Products',
      brand_owner: null,
      source_archive: 'sr_legacy_food.csv',
    };
    const c = formatUsdaCitation(hit, foodRow, SAMPLE_NUTRIENTS);
    assert.equal(c.description, 'Cheese, cheddar');
    assert.equal(c.foodCategory, 'Dairy and Egg Products');
    assert.equal(c.fdcId, 173410);
    assert.equal(c.brandOwner, '');
    assert.equal(c.nutrients.length, 6);
    // First should be Energy with kcal (lowercase!), not KCAL.
    assert.equal(c.nutrients[0].displayName, 'Energy');
    assert.equal(c.nutrients[0].displayUnit, 'kcal');
    // Fat should be short-named.
    const fat = c.nutrients.find((n) => n.displayName === 'Fat');
    assert.ok(fat, 'fat present');
    assert.equal(fat.nutrient_name, 'Total lipid (fat)');
  });

  it('handles missing nutrients gracefully (null)', () => {
    const hit = { id: 12, title: 'Egg', subtitle: 'Dairy' };
    const c = formatUsdaCitation(hit, null, null);
    assert.deepEqual(c.nutrients, []);
    assert.equal(c.description, 'Egg');
    assert.equal(c.foodCategory, 'Dairy');
    assert.equal(c.fdcId, 12);
  });

  it('handles missing food row by falling back to hit fields', () => {
    const hit = {
      source: 'usda',
      id: 9999,
      title: 'Apple, raw',
      subtitle: 'Fruits',
    };
    const c = formatUsdaCitation(hit, null, []);
    assert.equal(c.description, 'Apple, raw');
    assert.equal(c.foodCategory, 'Fruits');
    assert.equal(c.fdcId, 9999);
  });

  it('handles semantic envelope (fdc_id field instead of id)', () => {
    const hit = {
      source: 'usda',
      fdc_id: 555,
      description: 'Tomato, raw',
      food_category: 'Vegetables',
    };
    const c = formatUsdaCitation(hit, null, []);
    assert.equal(c.description, 'Tomato, raw');
    assert.equal(c.foodCategory, 'Vegetables');
    assert.equal(c.fdcId, 555);
  });

  it('coerces numeric fdc_id candidates correctly', () => {
    const c = formatUsdaCitation({ fdc_id: '321' }, null, null);
    assert.equal(c.fdcId, 321);
  });

  it('returns empty fields for fully-missing input', () => {
    const c = formatUsdaCitation({}, null, null);
    assert.equal(c.description, '');
    assert.equal(c.foodCategory, '');
    assert.equal(c.fdcId, null);
    assert.deepEqual(c.nutrients, []);
  });
});

// ── Constant exports ────────────────────────────────────────────

describe('Constants', () => {
  it('NUTRIENT_PRIORITY mirrors the lib order (Energy first, Sugars last)', () => {
    assert.deepEqual(NUTRIENT_PRIORITY, [
      'Energy',
      'Protein',
      'Carbohydrate',
      'Total lipid (fat)',
      'Sodium, Na',
      'Sugars, total',
    ]);
  });

  it('PRIORITY_DISPLAY contains the three short-name renames', () => {
    assert.equal(PRIORITY_DISPLAY['Total lipid (fat)'], 'Fat');
    assert.equal(PRIORITY_DISPLAY['Sodium, Na'], 'Sodium');
    assert.equal(PRIORITY_DISPLAY['Sugars, total'], 'Sugars');
  });

  it('FDA_BODY_EXCERPT_CHARS is ~400 (within spec)', () => {
    assert.ok(FDA_BODY_EXCERPT_CHARS <= 400);
    assert.ok(FDA_BODY_EXCERPT_CHARS >= 200);
  });
});

// ── Drift guard against lib/kitchenAssistantContext.ts ──────────
//
// citationHelpers.js intentionally duplicates NUTRIENT_PRIORITY,
// PRIORITY_DISPLAY, and the formatUnit mapping from the canonical
// copy in lib/kitchenAssistantContext.ts (the chat-UI client component
// can't cleanly import from `lib/` under its current 'use client'
// shape). Per-file comments warn maintainers to keep the two copies in
// sync; this block is the durable defence — it FAILS the suite if the
// constants drift, so a one-sided edit is caught at test time instead
// of silently changing what the user sees vs. what the LLM saw.

describe('Drift guard — citationHelpers.js mirrors lib/kitchenAssistantContext.ts', () => {
  it('NUTRIENT_PRIORITY matches USDA_NUTRIENT_PRIORITY exactly', () => {
    assert.deepEqual(NUTRIENT_PRIORITY, libCtx.USDA_NUTRIENT_PRIORITY);
  });

  it('PRIORITY_DISPLAY matches the lib copy exactly', () => {
    assert.deepEqual(PRIORITY_DISPLAY, libCtx.PRIORITY_DISPLAY);
  });

  it('formatUnit produces the same output as the lib copy for every known input', () => {
    // Cover every case-arm in the switch + a couple of edge cases.
    const inputs = [
      'KCAL', 'G', 'MG', 'UG', 'IU', 'kJ', 'MG_ATE', 'SP_GR',
      // Pass-through path (unknown unit).
      'PCT_DV',
      // Empty / nullish path.
      '', null, undefined,
    ];
    for (const u of inputs) {
      assert.equal(
        formatUnit(u),
        libCtx.formatUnit(u),
        `formatUnit(${JSON.stringify(u)}) drifted between citationHelpers.js and lib/kitchenAssistantContext.ts`
      );
    }
  });
});
