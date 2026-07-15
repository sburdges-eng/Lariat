#!/usr/bin/env node
// Tests for app/datapack-search/hitModel.js — the pure hit-normalization /
// routing / grouping helpers extracted from DatapackSearchClient.jsx so the
// render-critical logic runs under node --test without React (rolling-review
// datapack-search Coverage #6), plus the href scheme guard (Low #4).
//
// Run: node --test tests/js/test-datapack-hit-model.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_ORDER,
  groupHits,
  hitKey,
  lookupUrlFor,
  normalizeSemanticHit,
  safeHttpUrl,
} from '../../app/datapack-search/hitModel.js';

// ── hitKey ──────────────────────────────────────────────────────

describe('hitKey', () => {
  it('keys a hit by source:id', () => {
    assert.equal(hitKey({ source: 'usda', id: 123 }), 'usda:123');
    assert.equal(hitKey({ source: 'off', id: '0123' }), 'off:0123');
  });
});

// ── normalizeSemanticHit ────────────────────────────────────────

describe('normalizeSemanticHit', () => {
  it('maps a usda metadata row', () => {
    const h = normalizeSemanticHit({
      source: 'usda',
      score: 0.8,
      fdc_id: 171705,
      description: 'Butter, salted',
      food_category: 'Dairy',
      source_archive: 'sr_legacy',
    });
    assert.deepEqual(h, {
      score: 0.8,
      source: 'usda',
      id: 171705,
      title: 'Butter, salted',
      subtitle: 'Dairy',
      extra: 'sr_legacy',
    });
  });

  it('maps a wikibooks metadata row', () => {
    const h = normalizeSemanticHit({
      source: 'wikibooks',
      score: 0.7,
      page_id: 42,
      title: 'Cookbook:Roux',
      slug: 'roux',
      source_url: 'https://en.wikibooks.org/wiki/Cookbook:Roux',
    });
    assert.equal(h.source, 'wikibooks');
    assert.equal(h.id, 42);
    assert.equal(h.title, 'Cookbook:Roux');
    assert.equal(h.subtitle, 'roux');
  });

  it("collapses fda_food_code to source 'fda' with rowid + section", () => {
    const h = normalizeSemanticHit({
      source: 'fda_food_code',
      score: 0.6,
      rowid: 9,
      title: 'Hands and Arms',
      section_id: '2-301.11',
      chapter: '2',
    });
    assert.equal(h.source, 'fda');
    assert.equal(h.id, 9);
    assert.equal(h.subtitle, '2-301.11');
    assert.equal(h.extra, '2');
  });

  it('falls back safely for an unknown source and non-numeric score', () => {
    const h = normalizeSemanticHit({ source: 'mystery', score: 'NaN?', title: 'x' });
    assert.equal(h.source, 'mystery');
    assert.equal(h.score, 0);
    assert.equal(h.title, 'x');
  });
});

// ── lookupUrlFor ────────────────────────────────────────────────

describe('lookupUrlFor', () => {
  it('routes each source to its drill-in op', () => {
    assert.equal(
      lookupUrlFor({ source: 'usda', id: 5 }),
      '/api/datapack/search?op=usda_food&fdc_id=5',
    );
    assert.equal(
      lookupUrlFor({ source: 'off', id: '0123' }),
      '/api/datapack/search?op=off_product&code=0123',
    );
    assert.equal(
      lookupUrlFor({ source: 'wikibooks', id: 42 }),
      '/api/datapack/search?op=wikibooks_page&page_id=42',
    );
    assert.equal(
      lookupUrlFor({ source: 'fda', id: 9 }),
      '/api/datapack/search?op=fda_section&rowid=9',
    );
  });

  it('returns null for an unknown source', () => {
    assert.equal(lookupUrlFor({ source: 'mystery', id: 1 }), null);
  });
});

// ── groupHits ───────────────────────────────────────────────────

describe('groupHits', () => {
  it('groups by source in GROUP_ORDER and drops empty groups', () => {
    const hits = [
      { source: 'fda', id: 1 },
      { source: 'usda', id: 2 },
      { source: 'fda', id: 3 },
    ];
    const groups = groupHits(hits);
    assert.deepEqual(
      groups.map((g) => g.source),
      ['usda', 'fda'], // GROUP_ORDER: usda before fda; off/wikibooks dropped (empty)
    );
    assert.deepEqual(groups[1].hits.map((h) => h.id), [1, 3]);
  });

  it('appends unknown sources after the known order', () => {
    const groups = groupHits([
      { source: 'mystery', id: 1 },
      { source: 'usda', id: 2 },
    ]);
    assert.deepEqual(groups.map((g) => g.source), ['usda', 'mystery']);
  });

  it('exports the display order used by the dropdown', () => {
    assert.deepEqual(GROUP_ORDER, ['usda', 'off', 'wikibooks', 'fda']);
  });
});

// ── safeHttpUrl (Low #4) ────────────────────────────────────────

describe('safeHttpUrl', () => {
  it('passes http(s) URLs through', () => {
    assert.equal(
      safeHttpUrl('https://en.wikibooks.org/wiki/Cookbook:Roux'),
      'https://en.wikibooks.org/wiki/Cookbook:Roux',
    );
    assert.equal(safeHttpUrl('http://example.com/x'), 'http://example.com/x');
  });

  it('rejects executable / non-web schemes', () => {
    assert.equal(safeHttpUrl('javascript:alert(1)'), null);
    assert.equal(safeHttpUrl('JavaScript:alert(1)'), null);
    assert.equal(safeHttpUrl('data:text/html,<script>1</script>'), null);
    assert.equal(safeHttpUrl('file:///etc/passwd'), null);
  });

  it('rejects relative, blank, and non-string values', () => {
    assert.equal(safeHttpUrl('/wiki/Roux'), null);
    assert.equal(safeHttpUrl(''), null);
    assert.equal(safeHttpUrl(null), null);
    assert.equal(safeHttpUrl(undefined), null);
    assert.equal(safeHttpUrl(42), null);
  });
});
