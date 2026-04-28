#!/usr/bin/env node
// Tests for lib/datapackSearch — read-only client for the data pack
// indexes built by the Python pipeline at scripts/datapack/.
// Run: node --test tests/js/test-datapack-search.mjs
//
// The data pack lives off-tree (on the SSD via the data/lariat-data
// symlink) and may be absent on CI / dev machines where the drive
// isn't mounted. Each test gracefully skips with `t.skip()` when
// `available()` returns false instead of failing the suite, so this
// file never goes red on a machine that just hasn't built the pack.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  available,
  dataRoot,
  fts,
  escapeFtsPhrase,
  stats,
  getUsdaFood,
  usdaNutrientsFor,
  getOffProduct,
  getFdaSection,
  getWikibooksPage,
} from '../../lib/datapackSearch.ts';

const skipMsg = 'data pack not mounted';

describe('lib/datapackSearch — availability', () => {
  it('available() and dataRoot() agree', () => {
    if (!available()) return;
    assert.ok(dataRoot(), 'dataRoot should resolve when available');
  });
});

describe('lib/datapackSearch — escapeFtsPhrase', () => {
  it('wraps input in quotes', () => {
    assert.equal(escapeFtsPhrase('hello world'), '"hello world"');
  });
  it('strips embedded double quotes (FTS5 has no in-phrase escape)', () => {
    assert.equal(escapeFtsPhrase('he said "hi"'), '"he said hi"');
  });
});

describe('lib/datapackSearch — stats', { skip: !available() && skipMsg }, () => {
  it('reports row counts for every indexed table', () => {
    const s = stats();
    assert.ok(s);
    // Spot-check that the Big Tables aren't empty — tightly coupled
    // to current row counts would be brittle, so we only assert
    // ranges that hold across reasonable rebuilds.
    assert.ok(s.sqlite.usda_foods > 1_000_000);
    assert.ok(s.sqlite.usda_nutrients > 10_000_000);
    assert.ok(s.sqlite.off_products > 1_000_000);
    assert.ok(s.sqlite.fda_food_code_sections > 500);
    // FTS row counts mirror SQLite for the indexed tables.
    assert.ok(s.fts.usda_foods_fts === s.sqlite.usda_foods);
    assert.ok(s.fts.fda_food_code_sections_fts === s.sqlite.fda_food_code_sections);
  });
});

describe('lib/datapackSearch — fts (lexical)', { skip: !available() && skipMsg }, () => {
  it('returns hits for a USDA query', () => {
    const hits = fts(escapeFtsPhrase('scrambled eggs'), { source: 'usda', limit: 3 });
    assert.ok(hits.length > 0, 'should find scrambled-egg foods');
    assert.equal(hits[0].source, 'usda');
    assert.match((hits[0].title ?? '').toLowerCase(), /(scrambled|egg)/);
    // BM25 returns negative — lower-magnitude scores rank first
    // because of the ORDER BY score ASC.
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1].score <= hits[i].score, 'sorted by ascending bm25');
    }
  });

  it('returns hits across all sources for a popular brand', () => {
    const hits = fts(escapeFtsPhrase('nutella'), { source: 'all', limit: 6 });
    assert.ok(hits.length >= 4, 'nutella should hit multiple corpora');
    const sources = new Set(hits.map((h) => h.source));
    // We don't pin the exact set (corpora coverage shifts with
    // rebuilds), but at least USDA and OFF should both fire.
    assert.ok(sources.has('usda'));
    assert.ok(sources.has('off'));
  });

  it('returns FDA Food Code sections for safety queries', () => {
    const hits = fts(escapeFtsPhrase('thawing'), { source: 'fda', limit: 5 });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].source, 'fda');
    // Section IDs come back in the subtitle column.
    assert.ok(hits.some((h) => h.subtitle && /^\d-\d+\.\d+$/.test(h.subtitle)));
  });

  it('returns [] for empty / whitespace queries', () => {
    assert.deepEqual(fts('', { source: 'all' }), []);
    assert.deepEqual(fts('   ', { source: 'usda' }), []);
  });

  it('clamps limit into [1, 200]', () => {
    const big = fts(escapeFtsPhrase('eggs'), { source: 'usda', limit: 500 });
    assert.ok(big.length <= 200);
    const small = fts(escapeFtsPhrase('eggs'), { source: 'usda', limit: 0 });
    assert.ok(small.length <= 1);
  });
});

describe('lib/datapackSearch — direct lookups', { skip: !available() && skipMsg }, () => {
  it('getUsdaFood(171688) returns the apples row', () => {
    const f = getUsdaFood(171688);
    assert.ok(f);
    assert.match((f.description ?? '').toLowerCase(), /apple/);
    assert.equal(f.fdc_id, 171688);
  });

  it('usdaNutrientsFor(171688) returns multiple nutrients', () => {
    const ns = usdaNutrientsFor(171688);
    assert.ok(ns.length > 5, 'apples row has many nutrients');
    for (const n of ns) {
      assert.equal(typeof n.nutrient_id, 'number');
    }
  });

  it('getOffProduct(known nutella GTIN) returns the brand row', () => {
    const p = getOffProduct('3017620422003');
    assert.ok(p);
    assert.equal(p.code, '3017620422003');
    assert.match((p.brands ?? '').toLowerCase(), /nutella/);
  });

  it('getFdaSection({section_id:"3-501.13"}) returns the Thawing section', () => {
    const sec = getFdaSection({ section_id: '3-501.13' });
    assert.ok(sec);
    assert.equal(sec.section_id, '3-501.13');
    assert.match((sec.title ?? '').toLowerCase(), /thaw/);
    assert.ok(sec.body && sec.body.length > 0);
  });

  it('getWikibooksPage({title:"Cookbook:Nutella"}) returns the page', () => {
    const p = getWikibooksPage({ title: 'Cookbook:Nutella' });
    assert.ok(p);
    assert.equal(p.title, 'Cookbook:Nutella');
  });

  it('returns null for unknown ids', () => {
    assert.equal(getUsdaFood(-1), null);
    assert.equal(getOffProduct('this-is-not-a-gtin'), null);
    assert.equal(getFdaSection({ section_id: 'no-such-section' }), null);
  });
});
