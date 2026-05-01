#!/usr/bin/env node
// Tests for lib/varianceTrend.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-variance-trend.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const trend = await import('../../lib/varianceTrend.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`DELETE FROM accounting_variance;`);
});

function insertVariance(periodStart, periodEnd, theoretical, actual, location = 'default') {
  const variance_amount = actual - theoretical;
  const variance_pct = theoretical > 0 ? (variance_amount / theoretical) * 100 : null;
  db.prepare(
    `INSERT INTO accounting_variance
       (period_start, period_end, theoretical_cogs, actual_cogs,
        variance_amount, variance_pct, snapshot_at, location_id)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(periodStart, periodEnd, theoretical, actual, variance_amount, variance_pct, location);
}

describe('getVarianceTrend', () => {
  it('returns rowsFound: 0 and empty points when table is empty', () => {
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 0);
    assert.equal(t.points.length, 0);
    assert.equal(t.pCurrent, null);
    assert.equal(t.pAverage, null);
  });

  it('returns weeks ordered oldest → newest', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1020);  // 2.0
    insertVariance('2026-04-08', '2026-04-14', 1000, 1050);  // 5.0
    insertVariance('2026-04-15', '2026-04-21', 1000, 1010);  // 1.0
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 3);
    assert.equal(t.points.length, 3);
    assert.equal(t.points[0].periodEnd, '2026-04-07');
    assert.equal(t.points[2].periodEnd, '2026-04-21');
    assert.equal(t.pCurrent, 1.0);
    assert.ok(Math.abs(t.pAverage - (2 + 5 + 1) / 3) < 0.01);
  });

  it('color buckets match T9 thresholds', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1019);  // 1.9 → green
    insertVariance('2026-04-08', '2026-04-14', 1000, 1030);  // 3.0 → yellow
    insertVariance('2026-04-15', '2026-04-21', 1000, 1080);  // 8.0 → red
    const t = trend.getVarianceTrend('default');
    assert.equal(t.points[0].thresholdColor, 'green');
    assert.equal(t.points[1].thresholdColor, 'yellow');
    assert.equal(t.points[2].thresholdColor, 'red');
  });

  it('respects location scoping', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1020, 'default');
    insertVariance('2026-04-01', '2026-04-07', 1000, 1100, 'other');
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 1);
    assert.equal(t.pCurrent, 2.0);
  });

  it('honors a custom window', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1010);
    insertVariance('2026-04-08', '2026-04-14', 1000, 1020);
    insertVariance('2026-04-15', '2026-04-21', 1000, 1030);
    const t = trend.getVarianceTrend('default', 14);
    // Window: 2026-04-21 minus 14 days = 2026-04-07 → period_end >= 2026-04-07.
    assert.ok(t.points.length >= 2);
  });
});
