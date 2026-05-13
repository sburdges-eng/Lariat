#!/usr/bin/env node
// Pure-rule tests for lib/splTelemetry.ts.
// Run: node --experimental-strip-types --test tests/js/test-spl-telemetry-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const m = await import('../../lib/splTelemetry.ts');
const { summarizeSpl, sparklinePath, splThresholdStatus } = m;

const reading = (db_value, taken_at = '2026-05-13T20:00:00Z') => ({ db_value, taken_at });

describe('summarizeSpl', () => {
  it('returns zeroed summary on empty input', () => {
    const s = summarizeSpl([], 100);
    assert.equal(s.count, 0);
    assert.equal(s.latest, null);
    assert.equal(s.peak, null);
    assert.equal(s.avg_last_n, null);
    assert.equal(s.over_limit_count, 0);
    assert.equal(s.since, null);
    assert.equal(s.limit_db, 100);
  });

  it('handles null/undefined input', () => {
    assert.equal(summarizeSpl(null, null).count, 0);
    assert.equal(summarizeSpl(undefined, undefined).count, 0);
  });

  it('rolls up count, latest, peak, avg, over-limit', () => {
    const s = summarizeSpl(
      [reading(90, 't1'), reading(102, 't2'), reading(95, 't3'), reading(110, 't4')],
      100,
    );
    assert.equal(s.count, 4);
    assert.equal(s.latest, 110);
    assert.equal(s.peak, 110);
    assert.equal(s.avg_last_n, 99.3); // (90+102+95+110)/4 = 99.25 -> 99.3
    assert.equal(s.over_limit_count, 2); // 102 and 110
    assert.equal(s.since, 't1');
  });

  it('over_limit_count is 0 when limit is null/invalid', () => {
    const s = summarizeSpl([reading(120), reading(130)], null);
    assert.equal(s.over_limit_count, 0);
    assert.equal(s.limit_db, null);
  });

  it('drops malformed entries silently', () => {
    const s = summarizeSpl(
      [reading(90), { taken_at: 'x' }, { db_value: 'not-a-number' }, reading(100)],
      null,
    );
    assert.equal(s.count, 2);
    assert.equal(s.latest, 100);
  });
});

describe('sparklinePath', () => {
  it('returns empty d + sentinel peakIdx on empty input', () => {
    const p = sparklinePath([], 100);
    assert.equal(p.d, '');
    assert.equal(p.peakIdx, -1);
    assert.equal(p.thresholdY, null);
  });

  it('builds an M…L path for multiple readings', () => {
    const p = sparklinePath([reading(80), reading(90), reading(100)], null, { width: 100, height: 40, padding: 0 });
    // 3 readings → "M..,..L..,..L..,.."
    assert.match(p.d, /^M[\d.]+,[\d.]+L[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
    assert.equal(p.peakIdx, 2);
  });

  it('handles a single reading without dividing by zero', () => {
    const p = sparklinePath([reading(95)], 100, { width: 160, height: 40, padding: 2 });
    // Single point lays mid-canvas, peak idx 0
    assert.equal(p.peakIdx, 0);
    assert.match(p.d, /^M[\d.]+,[\d.]+$/);
  });

  it('handles all-equal readings by synthesizing a 4 dB window', () => {
    const p = sparklinePath([reading(100), reading(100), reading(100)], 100, { width: 100, height: 40, padding: 0 });
    // Should not throw; threshold line should land within yMin..yMax
    assert.equal(p.peakIdx, 0);
    assert.equal(p.yMax - p.yMin, 4);
    assert.notEqual(p.thresholdY, null);
  });

  it('returns thresholdY null when limit is outside the y-range', () => {
    // Data all 80–90 ⇒ yMin ~78, yMax ~92; limit 200 is outside.
    const p = sparklinePath([reading(80), reading(85), reading(90)], 200);
    assert.equal(p.thresholdY, null);
  });

  it('reports peakIdx at the max position', () => {
    const p = sparklinePath([reading(80), reading(120), reading(95)], null);
    assert.equal(p.peakIdx, 1);
  });
});

describe('splThresholdStatus', () => {
  it('returns unset when value is not finite', () => {
    assert.equal(splThresholdStatus(null, 100), 'unset');
    assert.equal(splThresholdStatus('hi', 100), 'unset');
  });

  it('returns green when no/zero limit', () => {
    assert.equal(splThresholdStatus(120, null), 'green');
    assert.equal(splThresholdStatus(120, 0), 'green');
  });

  it('returns green below 90% of limit', () => {
    assert.equal(splThresholdStatus(89.999, 100), 'green');
  });

  it('returns amber inside 90–100% band', () => {
    assert.equal(splThresholdStatus(90, 100), 'amber');
    assert.equal(splThresholdStatus(99.9, 100), 'amber');
    assert.equal(splThresholdStatus(100, 100), 'amber');
  });

  it('returns red above limit', () => {
    assert.equal(splThresholdStatus(100.1, 100), 'red');
    assert.equal(splThresholdStatus(150, 100), 'red');
  });
});
