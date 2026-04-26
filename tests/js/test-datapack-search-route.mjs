#!/usr/bin/env node
// Unit tests for the GET handler at app/api/datapack/search/route.js.
//
// This test file imports the route handler directly and exercises it
// with synthetic Request objects rather than spinning up a Next.js
// dev server. The handler relies on lib/datapackSearch, which is a
// thin client over the off-tree SQLite + FTS5 indexes; on a machine
// where the data pack isn't mounted, every test gracefully skips
// (the route returns 503 in that case, and we exercise that branch
// once explicitly).
//
// Run: node --experimental-strip-types --test tests/js/test-datapack-search-route.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const route = await import('../../app/api/datapack/search/route.js');
const { GET } = route;

const datapack = await import('../../lib/datapackSearch.ts');
const isAvailable = datapack.available();
const skipMsg = 'data pack not mounted';

function getReq(qs) {
  return new Request(`http://localhost/api/datapack/search${qs}`);
}

// ─────────────────────────────────────────────────────────────────
// 503 branch — exercised regardless of mount state via the test-only
// override on lib/datapackSearch.
// ─────────────────────────────────────────────────────────────────

describe('GET /api/datapack/search — unavailable (503)', () => {
  it('returns 503 with hint when the data pack is not available', async () => {
    datapack._setAvailableOverrideForTest(false);
    try {
      const res = await GET(getReq('?q=eggs'));
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /not mounted/i);
      assert.ok(typeof body.hint === 'string' && body.hint.length > 0);
    } finally {
      datapack._setAvailableOverrideForTest(null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 400 branches — exercised regardless of mount state.
// ─────────────────────────────────────────────────────────────────

describe('GET /api/datapack/search — input validation (400)', { skip: !isAvailable && skipMsg }, () => {
  it('400 when q is missing on default search', async () => {
    const res = await GET(getReq(''));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'q required');
  });

  it('400 when source is unknown', async () => {
    const res = await GET(getReq('?q=eggs&source=bogus'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid source/);
  });

  it('400 when fdc_id is non-numeric', async () => {
    const res = await GET(getReq('?op=usda_food&fdc_id=notanumber'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /fdc_id/);
  });

  it('400 when off_product code is missing', async () => {
    const res = await GET(getReq('?op=off_product'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'code required');
  });

  it('400 when fda_section has neither section_id nor rowid', async () => {
    const res = await GET(getReq('?op=fda_section'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /section_id or rowid/);
  });

  it('400 when wikibooks_page has neither page_id nor title', async () => {
    const res = await GET(getReq('?op=wikibooks_page'));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /page_id or title/);
  });
});

// ─────────────────────────────────────────────────────────────────
// Happy paths — only run when the data pack is mounted.
// ─────────────────────────────────────────────────────────────────

describe('GET /api/datapack/search — search hits', { skip: !isAvailable && skipMsg }, () => {
  it('returns a hits array sorted by ascending bm25 score', async () => {
    const res = await GET(getReq('?q=scrambled%20eggs&source=usda&limit=5'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.source, 'usda');
    assert.ok(Array.isArray(body.hits));
    assert.ok(body.hits.length > 0, 'should find scrambled-egg foods');
    for (let i = 1; i < body.hits.length; i++) {
      assert.ok(body.hits[i - 1].score <= body.hits[i].score, 'sorted by ascending bm25');
    }
    for (const h of body.hits) assert.strictEqual(h.source, 'usda');
  });

  it('respects an explicit limit', async () => {
    const res = await GET(getReq('?q=eggs&source=usda&limit=2'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.hits.length <= 2);
  });

  it('returns hits across multiple sources for source=all', async () => {
    const res = await GET(getReq('?q=nutella&source=all&limit=12'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const sources = new Set(body.hits.map((h) => h.source));
    assert.ok(sources.size >= 2, 'nutella should hit multiple corpora');
  });
});

describe('GET /api/datapack/search — direct lookups', { skip: !isAvailable && skipMsg }, () => {
  it('op=usda_food returns food + nutrients', async () => {
    const res = await GET(getReq('?op=usda_food&fdc_id=171688'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.food);
    assert.strictEqual(body.food.fdc_id, 171688);
    assert.ok(Array.isArray(body.nutrients));
    assert.ok(body.nutrients.length > 0);
  });

  it('op=usda_food returns 404 for unknown id', async () => {
    const res = await GET(getReq('?op=usda_food&fdc_id=-1'));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, 'not found');
  });

  it('op=fda_section returns the row when section_id is given', async () => {
    const res = await GET(getReq('?op=fda_section&section_id=3-501.13'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.section.section_id, '3-501.13');
    assert.ok(body.section.body && body.section.body.length > 0);
  });
});
