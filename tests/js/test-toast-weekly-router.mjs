#!/usr/bin/env node
// Unit tests for scripts/toast_weekly/router.mjs — the pure file-classifier
// + grouper used by the Toast weekly-ingest orchestrator. No I/O.
//
// Run: npm run test:toast-weekly-router

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classify, group } from '../../scripts/toast_weekly/router.mjs';

describe('classify', () => {
  it('recognizes the three sales timeseries CSV prefixes', () => {
    assert.equal(classify('sales-by-date-2026-04-20-2026-04-26.csv').kind, 'timeseries');
    assert.equal(classify('sales-by-day-anything.csv').kind, 'timeseries');
    assert.equal(classify('sales-by-time-x.csv').kind, 'timeseries');
  });

  it('is case-insensitive on the .csv suffix only', () => {
    // Toast Web sometimes emits .CSV from older browsers.
    assert.equal(classify('sales-by-date-foo.CSV').kind, 'timeseries');
    // The prefix is intentionally case-sensitive — Toast emits lowercase.
    assert.equal(classify('Sales-By-Date-foo.csv').kind, 'unknown');
  });

  it('parses SalesSummary period from filename', () => {
    const c = classify('SalesSummary_2026-04-20_2026-04-26.zip');
    assert.equal(c.kind, 'sales_summary');
    assert.equal(c.periodStart, '2026-04-20');
    assert.equal(c.periodEnd, '2026-04-26');
  });

  it('parses LaborBreakDown period from filename', () => {
    const c = classify('LaborBreakDown_2026-04-20_2026-04-26.zip');
    assert.equal(c.kind, 'labor');
    assert.equal(c.periodStart, '2026-04-20');
    assert.equal(c.periodEnd, '2026-04-26');
  });

  it('strips a directory prefix before classifying', () => {
    assert.equal(
      classify('/Users/x/Downloads/SalesSummary_2026-04-20_2026-04-26.zip').kind,
      'sales_summary'
    );
    assert.equal(
      classify('foo/bar/sales-by-date-x.csv').kind,
      'timeseries'
    );
  });

  it('returns unknown for unrecognized files', () => {
    assert.equal(classify('random.txt').kind, 'unknown');
    assert.equal(classify('SalesSummary_2026.zip').kind, 'unknown'); // no end date
    assert.equal(classify('LaborBreakDown.zip').kind, 'unknown');    // no dates
    assert.equal(classify('').kind, 'unknown');
    assert.equal(classify(null).kind, 'unknown');
    assert.equal(classify(undefined).kind, 'unknown');
  });

  it('does not match a SalesSummary that uses a date format other than YYYY-MM-DD', () => {
    assert.equal(classify('SalesSummary_4-20-2026_4-26-2026.zip').kind, 'unknown');
    assert.equal(classify('SalesSummary_20260420_20260426.zip').kind, 'unknown');
  });
});

describe('group', () => {
  it('partitions a mixed batch into the right buckets', () => {
    const g = group([
      'sales-by-date-2026-04-26.csv',
      'sales-by-day-2026-04-26.csv',
      'sales-by-time-2026-04-26.csv',
      'SalesSummary_2026-04-20_2026-04-26.zip',
      'LaborBreakDown_2026-04-20_2026-04-26.zip',
      'random.txt',
    ]);
    assert.equal(g.timeseries.length, 3);
    assert.equal(g.salesSummaryZips.length, 1);
    assert.equal(g.laborZips.length, 1);
    assert.equal(g.unknown.length, 1);
    assert.equal(g.unknown[0], 'random.txt');
  });

  it('handles empty input', () => {
    const g = group([]);
    assert.equal(g.timeseries.length, 0);
    assert.equal(g.salesSummaryZips.length, 0);
    assert.equal(g.laborZips.length, 0);
    assert.equal(g.unknown.length, 0);
  });

  it('handles undefined input gracefully', () => {
    const g = group(undefined);
    assert.equal(g.timeseries.length, 0);
    assert.equal(g.unknown.length, 0);
  });

  it('preserves filename order within each bucket', () => {
    const g = group([
      'SalesSummary_2026-04-13_2026-04-19.zip',
      'SalesSummary_2026-04-20_2026-04-26.zip',
    ]);
    assert.deepEqual(g.salesSummaryZips, [
      'SalesSummary_2026-04-13_2026-04-19.zip',
      'SalesSummary_2026-04-20_2026-04-26.zip',
    ]);
  });
});
