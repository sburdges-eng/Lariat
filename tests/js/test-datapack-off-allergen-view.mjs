#!/usr/bin/env node
// Tests for app/datapack-search/offAllergenView — the pure food-safety
// display model for the Open Food Facts drill-in panel. Extracted so the
// render DECISION (contains / declares-none / unknown, plus traces) can be
// exercised under node --test without React.
//
// The bug this pins (rolling-review datapack-search High #1): a null /
// missing / malformed OFF allergen field must NOT render the same as a
// product that declares no allergens, and traces ("may contain") must be
// surfaced rather than dropped.
//
// Run: node --test tests/js/test-datapack-off-allergen-view.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  chipState,
  offAllergenView,
} from '../../app/datapack-search/offAllergenView.js';

describe('chipState', () => {
  it("is 'has' when tags are present", () => {
    assert.equal(chipState({ known: true, tags: ['en:milk'] }), 'has');
  });

  it("is 'none' for a known-but-empty list (declares no allergens)", () => {
    assert.equal(chipState({ known: true, tags: [] }), 'none');
  });

  it("is 'unknown' when the field was absent / malformed", () => {
    assert.equal(chipState({ known: false, tags: [] }), 'unknown');
  });
});

describe('offAllergenView — allergens', () => {
  it('reports declared allergens as has', () => {
    const v = offAllergenView({ allergens_tags_json: '["en:milk","en:soy"]' });
    assert.equal(v.allergens.state, 'has');
    assert.deepEqual(v.allergens.tags, ['en:milk', 'en:soy']);
  });

  it("distinguishes a declared-empty list ('none') from missing data ('unknown')", () => {
    assert.equal(offAllergenView({ allergens_tags_json: '[]' }).allergens.state, 'none');
    assert.equal(offAllergenView({ allergens_tags_json: null }).allergens.state, 'unknown');
    assert.equal(
      offAllergenView({ allergens_tags_json: 'not json' }).allergens.state,
      'unknown',
    );
  });

  it('treats a null/undefined product as unknown, never as safe', () => {
    assert.equal(offAllergenView(null).allergens.state, 'unknown');
    assert.equal(offAllergenView(undefined).allergens.state, 'unknown');
  });
});

describe('offAllergenView — traces', () => {
  it('surfaces trace tags instead of dropping them', () => {
    const v = offAllergenView({
      allergens_tags_json: '[]',
      traces_tags_json: '["en:tree-nuts"]',
    });
    assert.equal(v.traces.state, 'has');
    assert.deepEqual(v.traces.tags, ['en:tree-nuts']);
  });

  it('marks traces unknown when that field is absent', () => {
    const v = offAllergenView({ allergens_tags_json: '["en:milk"]' });
    assert.equal(v.traces.state, 'unknown');
    assert.deepEqual(v.traces.tags, []);
  });
});
