#!/usr/bin/env node
// Pure-fn tests for lib/abcRanking.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-abc-ranking.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const abc = await import('../../lib/abcRanking.ts');

const linked = (n, qty, cost, price) => ({
  itemName: n,
  qty,
  costPerUnit: cost,
  marginPct: ((price - cost) / price) * 100,
  netSales: price * qty,
});
const unlinked = (n, qty, price) => ({
  itemName: n,
  qty,
  costPerUnit: null,
  marginPct: null,
  netSales: price * qty,
});

describe('rankByContribution', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(abc.rankByContribution([]), []);
  });

  it('marks unlinked rows as unranked, score 0', () => {
    const r = abc.rankByContribution([unlinked('Mystery', 100, 10)]);
    assert.equal(r.length, 1);
    assert.equal(r[0].tier, 'unranked');
    assert.equal(r[0].scoreCents, 0);
  });

  it('top contributor lands in tier A', () => {
    const rows = [
      linked('Star',     500, 2.00, 12.00),
      linked('Mid',      100, 4.00, 10.00),
      linked('Tail',      10, 5.00,  8.00),
    ];
    const r = abc.rankByContribution(rows);
    const star = r.find((x) => x.itemName === 'Star');
    assert.equal(star.tier, 'A');
  });

  it('cumulative pct of last linked row reaches ~100', () => {
    const rows = [
      linked('A1', 100, 2.00, 10.00),
      linked('A2',  80, 3.00, 12.00),
      linked('B1',  20, 4.00,  9.00),
      linked('C1',   2, 5.00,  8.00),
    ];
    const r = abc.rankByContribution(rows);
    const total = r.reduce((s, x) => s + x.scoreCents, 0);
    assert.ok(total > 0);
    const lastLinked = [...r]
      .filter((x) => x.tier !== 'unranked')
      .pop();
    assert.ok(Math.abs(lastLinked.cumulativePct - 100) < 0.5);
  });

  it('respects custom thresholds', () => {
    const rows = [
      linked('Big',  1000, 1.00, 10.00),
      linked('Mid',   100, 1.00, 10.00),
      linked('Tail',   10, 1.00, 10.00),
    ];
    const r = abc.rankByContribution(rows, { aPct: 0.5, bPct: 0.9 });
    const big = r.find((x) => x.itemName === 'Big');
    assert.equal(big.tier, 'A');
  });

  it('handles tiny menus — single linked row goes to A', () => {
    const r = abc.rankByContribution([linked('Solo', 50, 2.00, 10.00)]);
    assert.equal(r[0].tier, 'A');
    assert.equal(r[0].cumulativePct, 100);
  });
});
