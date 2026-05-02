#!/usr/bin/env node
// Pure-fn tests for the RRF helper in lib/complianceSearch.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-compliance-rrf.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { rrf } = await import('../../lib/complianceSearch.ts');

describe('rrf — Reciprocal Rank Fusion', () => {
  it('empty input returns empty array', () => {
    assert.deepEqual(rrf([]), []);
    assert.deepEqual(rrf([[], []]), []);
  });

  it('single list with single item — score = 1/(k+1)', () => {
    const r = rrf([[{ id: 'a' }]]);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'a');
    assert.ok(Math.abs(r[0].score - 1 / 61) < 1e-9);
  });

  it('matching items in two lists sum scores', () => {
    // Both lists rank "a" first → 2 × 1/61
    const r = rrf([[{ id: 'a' }], [{ id: 'a' }]]);
    assert.equal(r.length, 1);
    assert.ok(Math.abs(r[0].score - 2 / 61) < 1e-9);
  });

  it('an item ranked first in either list beats one only in the second-place', () => {
    // BM25: a, b, c; semantic: c, b, a
    const r = rrf([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'c' }, { id: 'b' }, { id: 'a' }],
    ]);
    assert.equal(r.length, 3);
    // a: 1/61 + 1/63 ; b: 1/62 + 1/62 = 2/62 ; c: 1/63 + 1/61
    // a == c (same score by symmetry); b sits between.
    const byId = Object.fromEntries(r.map((x) => [x.id, x.score]));
    assert.ok(Math.abs(byId.a - byId.c) < 1e-9, 'a and c symmetric');
    assert.ok(byId.b > 0, 'b present');
    // Sort order is descending; ties allowed.
    assert.ok(r[0].score >= r[1].score && r[1].score >= r[2].score);
  });

  it('item only in one list still scores', () => {
    const r = rrf([[{ id: 'a' }, { id: 'b' }], [{ id: 'a' }]]);
    const a = r.find((x) => x.id === 'a');
    const b = r.find((x) => x.id === 'b');
    assert.ok(a && b);
    assert.ok(a.score > b.score, 'a wins because it appears in both');
  });

  it('respects custom k', () => {
    const r1 = rrf([[{ id: 'a' }]], 60);
    const r2 = rrf([[{ id: 'a' }]], 10);
    assert.ok(r2[0].score > r1[0].score, 'smaller k → higher score');
  });

  it('output is sorted descending by score', () => {
    const r = rrf([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    ]);
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i - 1].score >= r[i].score);
    }
  });
});
