#!/usr/bin/env node
// Tests for app/allergen-lookup/allergenLookupHelpers — pure helpers
// extracted from AllergenLookupClient.jsx so the GTIN-detection,
// tag-cleaning, and URL-building logic can be exercised without
// rendering React or spinning up Next.js.
//
// Run: node --test tests/js/test-allergen-lookup-helpers.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLookupUrl,
  cleanAllergenTag,
  isGtinQuery,
  offProductUrl,
  parseAllergenTags,
  stripGtinNoise,
} from '../../app/allergen-lookup/allergenLookupHelpers.js';

// ── isGtinQuery ─────────────────────────────────────────────────

describe('isGtinQuery — positives', () => {
  it('matches an EAN-13 (13 digits)', () => {
    assert.equal(isGtinQuery('3017620422003'), true);
  });

  it('matches a UPC-A (12 digits)', () => {
    assert.equal(isGtinQuery('012345678905'), true);
  });

  it('matches an EAN-8 (8 digits, the lower bound)', () => {
    assert.equal(isGtinQuery('12345678'), true);
  });

  it('matches an ITF-14 (14 digits, the upper bound)', () => {
    assert.equal(isGtinQuery('12345678901234'), true);
  });

  it('strips embedded whitespace before checking', () => {
    assert.equal(isGtinQuery('3017 6204 22003'), true);
  });

  it('strips hyphens before checking (some printers use them)', () => {
    assert.equal(isGtinQuery('3017-6204-22003'), true);
  });

  it('strips leading/trailing whitespace', () => {
    assert.equal(isGtinQuery('  3017620422003  '), true);
  });
});

describe('isGtinQuery — negatives', () => {
  it('rejects 7 digits (below GTIN range)', () => {
    assert.equal(isGtinQuery('1234567'), false);
  });

  it('rejects 15 digits (above GTIN range)', () => {
    assert.equal(isGtinQuery('123456789012345'), false);
  });

  it('rejects an empty string', () => {
    assert.equal(isGtinQuery(''), false);
  });

  it('rejects whitespace-only', () => {
    assert.equal(isGtinQuery('     '), false);
  });

  it('rejects letters mixed in', () => {
    assert.equal(isGtinQuery('30176204X2003'), false);
  });

  it('rejects a normal product name', () => {
    assert.equal(isGtinQuery('nutella'), false);
  });

  it('rejects multi-word brand searches', () => {
    assert.equal(isGtinQuery('kraft mac and cheese'), false);
  });

  it('rejects null / undefined / non-string', () => {
    assert.equal(isGtinQuery(null), false);
    assert.equal(isGtinQuery(undefined), false);
    assert.equal(isGtinQuery(12345678), false);
  });
});

describe('stripGtinNoise', () => {
  it('removes hyphens and whitespace', () => {
    assert.equal(stripGtinNoise(' 12-34 5678 '), '12345678');
  });

  it('returns empty string for non-string input', () => {
    assert.equal(stripGtinNoise(null), '');
    assert.equal(stripGtinNoise(undefined), '');
  });
});

// ── cleanAllergenTag ────────────────────────────────────────────

describe('cleanAllergenTag', () => {
  it('strips the en: language prefix', () => {
    assert.equal(cleanAllergenTag('en:peanuts'), 'peanuts');
  });

  it('strips a fr: language prefix', () => {
    assert.equal(cleanAllergenTag('fr:gluten'), 'gluten');
  });

  it('strips a 3-letter language prefix', () => {
    assert.equal(cleanAllergenTag('eng:milk'), 'milk');
  });

  it('replaces underscores with spaces', () => {
    assert.equal(cleanAllergenTag('en:milk_and_dairy'), 'milk and dairy');
  });

  it('lowercases the result', () => {
    assert.equal(cleanAllergenTag('EN:Peanuts'), 'peanuts');
  });

  it('trims surrounding whitespace before processing', () => {
    assert.equal(cleanAllergenTag('  en:eggs  '), 'eggs');
  });

  it('passes through a tag with no prefix', () => {
    assert.equal(cleanAllergenTag('peanuts'), 'peanuts');
  });

  it('does not strip a colon that is not a language prefix', () => {
    // "something:weird" — 9 letters before colon is not a lang code.
    assert.equal(cleanAllergenTag('something:weird'), 'something:weird');
  });

  it('does not strip when the prefix has digits', () => {
    assert.equal(cleanAllergenTag('e1:peanuts'), 'e1:peanuts');
  });

  it('handles empty and non-string input safely', () => {
    assert.equal(cleanAllergenTag(''), '');
    assert.equal(cleanAllergenTag(null), '');
    assert.equal(cleanAllergenTag(undefined), '');
    assert.equal(cleanAllergenTag(42), '');
  });
});

// ── parseAllergenTags ───────────────────────────────────────────

describe('parseAllergenTags', () => {
  it('parses a JSON array of strings', () => {
    assert.deepEqual(
      parseAllergenTags('["en:peanuts","en:milk"]'),
      ['en:peanuts', 'en:milk']
    );
  });

  it('returns [] for null / empty / non-string', () => {
    assert.deepEqual(parseAllergenTags(null), []);
    assert.deepEqual(parseAllergenTags(''), []);
    assert.deepEqual(parseAllergenTags(undefined), []);
    assert.deepEqual(parseAllergenTags(42), []);
  });

  it('returns [] for malformed JSON', () => {
    assert.deepEqual(parseAllergenTags('not json'), []);
    assert.deepEqual(parseAllergenTags('{"not":"array"}'), []);
  });

  it('filters out empty / non-string entries', () => {
    assert.deepEqual(
      parseAllergenTags('["en:peanuts","",null,42,"en:milk"]'),
      ['en:peanuts', 'en:milk']
    );
  });
});

// ── buildLookupUrl ──────────────────────────────────────────────

describe('buildLookupUrl — search path', () => {
  it('builds the FTS URL for a normal query', () => {
    const url = buildLookupUrl('nutella');
    assert.equal(
      url,
      '/api/datapack/search?op=search&source=off&q=nutella&limit=20'
    );
  });

  it('respects a custom limit', () => {
    const url = buildLookupUrl('nutella', { limit: 5 });
    assert.equal(
      url,
      '/api/datapack/search?op=search&source=off&q=nutella&limit=5'
    );
  });

  it('trims leading/trailing whitespace from the query', () => {
    const url = buildLookupUrl('  nutella  ');
    assert.equal(
      url,
      '/api/datapack/search?op=search&source=off&q=nutella&limit=20'
    );
  });

  it('url-encodes special characters in the query', () => {
    const url = buildLookupUrl('mac & cheese');
    assert.ok(url);
    const parsed = new URL(url, 'http://example.com');
    assert.equal(parsed.searchParams.get('q'), 'mac & cheese');
    assert.equal(parsed.searchParams.get('source'), 'off');
    assert.equal(parsed.searchParams.get('op'), 'search');
  });

  it('returns null for blank input', () => {
    assert.equal(buildLookupUrl(''), null);
    assert.equal(buildLookupUrl('   '), null);
    assert.equal(buildLookupUrl(null), null);
    assert.equal(buildLookupUrl(undefined), null);
  });
});

describe('buildLookupUrl — direct-GTIN path', () => {
  it('routes a 13-digit query to op=off_product', () => {
    const url = buildLookupUrl('3017620422003');
    assert.equal(
      url,
      '/api/datapack/search?op=off_product&code=3017620422003'
    );
  });

  it('routes an 8-digit query to op=off_product', () => {
    const url = buildLookupUrl('12345678');
    assert.equal(url, '/api/datapack/search?op=off_product&code=12345678');
  });

  it('strips whitespace + hyphens before sending the code', () => {
    const url = buildLookupUrl(' 3017-6204-22003 ');
    assert.equal(
      url,
      '/api/datapack/search?op=off_product&code=3017620422003'
    );
  });

  it('does NOT route a 7-digit query as a GTIN', () => {
    const url = buildLookupUrl('1234567');
    assert.equal(
      url,
      '/api/datapack/search?op=search&source=off&q=1234567&limit=20'
    );
  });

  it('does NOT route a 15-digit query as a GTIN', () => {
    const url = buildLookupUrl('123456789012345');
    assert.ok(url.includes('op=search'));
    assert.ok(!url.includes('op=off_product'));
  });
});

// ── offProductUrl ───────────────────────────────────────────────

describe('offProductUrl', () => {
  it('builds the per-product drill-in URL', () => {
    assert.equal(
      offProductUrl('3017620422003'),
      '/api/datapack/search?op=off_product&code=3017620422003'
    );
  });

  it('coerces non-string codes to string', () => {
    assert.equal(
      offProductUrl(12345678),
      '/api/datapack/search?op=off_product&code=12345678'
    );
  });

  it('returns null for null / undefined input', () => {
    assert.equal(offProductUrl(null), null);
    assert.equal(offProductUrl(undefined), null);
  });
});
