#!/usr/bin/env node
// Tests for scripts/coverage-weekly.mjs — the launchd wrapper around
// scripts/dish-components-coverage.mjs.
//
// Pure helpers only — the orchestrator's main() is integration-flavored
// and exercised in production via the launchd run log.
//
// Run: node --experimental-strip-types --test tests/js/test-coverage-weekly.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { topNSummary, buildSummaryText } = await import(
  '../../scripts/coverage-weekly.mjs'
);

describe('topNSummary', () => {
  it('renders rank, qty, and dish_name in three padded columns', () => {
    const out = topNSummary([
      { dish_name: 'BAJA FISH TACOS', qty_sold: 1234 },
      { dish_name: 'ROPE BURGER', qty_sold: 987 },
      { dish_name: 'NASHVILLE CHICKEN', qty_sold: 410 },
    ], 5);
    // Header line present
    assert.match(out, /top 3 gap dishes by quantity_sold/);
    // Each rank/qty appears in order
    assert.match(out, /1\..*1234.*BAJA FISH TACOS/);
    assert.match(out, /2\..*987.*ROPE BURGER/);
    assert.match(out, /3\..*410.*NASHVILLE CHICKEN/);
  });

  it('truncates to N when more rows are supplied', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      dish_name: `dish-${i}`,
      qty_sold: 100 - i,
    }));
    const out = topNSummary(rows, 3);
    assert.match(out, /top 3 gap dishes/);
    assert.match(out, /dish-0/);
    assert.match(out, /dish-2/);
    assert.doesNotMatch(out, /dish-3/);
  });

  it('returns a "no gap" message on empty input', () => {
    assert.match(topNSummary([]), /no gap dishes/);
    assert.match(topNSummary(null), /no gap dishes/);
    assert.match(topNSummary(undefined), /no gap dishes/);
  });

  it('right-pads quantities so columns align across magnitudes', () => {
    // Mixed-magnitude qty values — all should right-align under the
    // widest. Two-space rank prefix + same-width qty column is the
    // contract.
    const out = topNSummary([
      { dish_name: 'A', qty_sold: 5 },
      { dish_name: 'B', qty_sold: 5000 },
    ], 5);
    const lines = out.split('\n').filter((l) => /^\s*\d+\./.test(l));
    assert.strictEqual(lines.length, 2);
    // Both lines should be the same length up through the dish_name (i.e.
    // the qty column is right-justified to match-width).
    const widths = lines.map((l) => l.indexOf(l.trim().split(/\s+/)[2]));
    assert.strictEqual(widths[0], widths[1], `column shift: ${widths}`);
  });
});

describe('buildSummaryText', () => {
  const sampleReport = {
    rows: [
      { dish_name: 'BAJA FISH TACOS', qty_sold: 100 },
      { dish_name: 'ROPE BURGER', qty_sold: 50 },
    ],
    total_dishes_in_gap: 2,
    total_gap_qty: 150,
    total_qty: 200,
    gap_pct: 75.0,
  };

  it('includes the date, location, gap stats, and CSV path', () => {
    const text = buildSummaryText({
      asOf: '2026-04-27',
      location: 'default',
      report: sampleReport,
      csvPath: 'tmp/report.csv',
    });
    assert.match(text, /coverage — 2026-04-27/);
    assert.match(text, /location: default/);
    assert.match(text, /2 dishes missing dish_components/);
    assert.match(text, /75% of recent sales velocity/);
    assert.match(text, /150\/200 units sold/);
    assert.match(text, /CSV: tmp\/report\.csv/);
    // Embedded top-N section
    assert.match(text, /BAJA FISH TACOS/);
  });

  it('handles a zero-gap report cleanly', () => {
    const text = buildSummaryText({
      asOf: '2026-04-27',
      location: 'default',
      report: {
        rows: [],
        total_dishes_in_gap: 0,
        total_gap_qty: 0,
        total_qty: 200,
        gap_pct: 0,
      },
      csvPath: 'tmp/empty.csv',
    });
    assert.match(text, /0 dishes missing/);
    assert.match(text, /0% of recent sales velocity/);
    assert.match(text, /no gap dishes/);
  });
});
