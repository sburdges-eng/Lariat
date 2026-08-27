#!/usr/bin/env node
/**
 * rebuild-cache must not copy a labor CSV's TOTAL row into a detail list.
 *
 * `Labor - By Job Title.csv` and `Labor - By Employee.csv` each end with a
 * rollup row whose first cell is the literal `TOTAL`. It holds the grand
 * total, not a record. `buildLaborSummary()` skipped the header and blank
 * rows but not that one, so the rollup landed in `by_employee` alongside 106
 * real people — two grains in one array.
 *
 * That is not hypothetical. The committed `data/cache/labor_summary.json`
 * carries it today: `{last_name: "TOTAL", job_title: "", total_hours:
 * 21921.016, total_cost: 267996.59}`. Summing that array double-counts every
 * figure in the file, and `renderLaborSummaryBlock` — which sorts by hours
 * and takes the top 10 — ranked it first, telling the kitchen assistant the
 * restaurant's busiest employee worked 21,921 hours.
 *
 * These tests pin the grain: a rollup label is never a record.
 *
 * Run: node --experimental-strip-types --test tests/js/test-rebuild-cache-labor-rollup.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isLaborRollupRow } from '../../scripts/rebuild-cache.mjs';

describe('isLaborRollupRow', () => {
  it('flags the TOTAL row the 7shifts exports end with', () => {
    assert.equal(isLaborRollupRow('TOTAL'), true);
  });

  it('flags it regardless of case or surrounding whitespace', () => {
    for (const label of ['total', 'Total', '  TOTAL  ', 'Totals', 'Grand Total']) {
      assert.equal(isLaborRollupRow(label), true, `${JSON.stringify(label)} is a rollup`);
    }
  });

  it('never flags a real last name', () => {
    for (const name of ['Mccune', 'Pauly', 'Blanton', 'Shaw', 'Vickers', 'Totaro']) {
      assert.equal(isLaborRollupRow(name), false, `${name} is a person`);
    }
  });

  it('never flags a real job title', () => {
    for (const job of ['Cook', 'Bartender', 'Dishwasher', 'General Manager']) {
      assert.equal(isLaborRollupRow(job), false, `${job} is a role`);
    }
  });

  it('is safe on missing cells', () => {
    for (const empty of [undefined, null, '', '   ']) {
      assert.equal(isLaborRollupRow(empty), false);
    }
  });
});
