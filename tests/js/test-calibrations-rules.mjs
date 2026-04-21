#!/usr/bin/env node
// Rule-module tests for lib/calibrations.ts.
//
// Covers pure decisions: boilingPointF altitude math, per-method
// validateCalibrationReading ±2°F tolerance, classifyProbes status
// (ok / due_soon / overdue / failed / unknown) + frequency overrides,
// and the calibrationWarningFor helper the temp-log route calls.
//
// Route-integration tests (temp DB + Request/Response) live in
// test-calibrations-api.mjs.
//
// Run: node --test tests/js/test-calibrations-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOILING_POINT_FT_PER_F,
  CALIBRATION_METHODS,
  DEFAULT_FREQUENCY_DAYS,
  DUE_SOON_WINDOW_DAYS,
  LARIAT_ELEVATION_FT,
  SEA_LEVEL_BOIL_F,
  TOLERANCE_F,
  boilingPointF,
  calibrationWarningFor,
  classifyProbes,
  expectedReadingF,
  isCalibrationMethod,
  validateCalibrationReading,
} from '../../lib/calibrations.ts';

// ── Constants ────────────────────────────────────────────────────

describe('constants match the §4-502.11 spec', () => {
  it('TOLERANCE_F is 2°F', () => {
    assert.strictEqual(TOLERANCE_F, 2);
  });

  it('LARIAT_ELEVATION_FT is 7800', () => {
    assert.strictEqual(LARIAT_ELEVATION_FT, 7800);
  });

  it('SEA_LEVEL_BOIL_F is 212', () => {
    assert.strictEqual(SEA_LEVEL_BOIL_F, 212);
  });

  it('BOILING_POINT_FT_PER_F is 550 (1°F drop per 550 ft)', () => {
    assert.strictEqual(BOILING_POINT_FT_PER_F, 550);
  });

  it('DEFAULT_FREQUENCY_DAYS is 30', () => {
    assert.strictEqual(DEFAULT_FREQUENCY_DAYS, 30);
  });

  it('DUE_SOON_WINDOW_DAYS is 7', () => {
    assert.strictEqual(DUE_SOON_WINDOW_DAYS, 7);
  });

  it('CALIBRATION_METHODS exposes ice_point + boiling_point', () => {
    assert.strictEqual(CALIBRATION_METHODS.ICE_POINT, 'ice_point');
    assert.strictEqual(CALIBRATION_METHODS.BOILING_POINT, 'boiling_point');
  });

  it('isCalibrationMethod accepts the two spec methods and rejects others', () => {
    assert.ok(isCalibrationMethod('ice_point'));
    assert.ok(isCalibrationMethod('boiling_point'));
    assert.ok(!isCalibrationMethod('reference_probe'));
    assert.ok(!isCalibrationMethod('slurry'));
    assert.ok(!isCalibrationMethod(null));
    assert.ok(!isCalibrationMethod(undefined));
  });
});

// ── boilingPointF ────────────────────────────────────────────────

describe('boilingPointF — altitude correction', () => {
  it('212°F at sea level exactly', () => {
    assert.strictEqual(boilingPointF(0), 212);
  });

  it('≈197.8°F at 7800 ft (Lariat) within 0.1°F', () => {
    // 212 - 7800/550 = 212 - 14.1818... = 197.8181...
    const v = boilingPointF(7800);
    assert.ok(Math.abs(v - 197.8) < 0.1, `expected ~197.8, got ${v}`);
  });

  it('≈211°F at ~550 ft (1°F drop), within 0.01', () => {
    const v = boilingPointF(550);
    assert.ok(Math.abs(v - 211) < 0.01, `expected ~211, got ${v}`);
  });

  it('211°F at 550 ft, 210°F at 1100 ft (linear scaling)', () => {
    const a = boilingPointF(550);
    const b = boilingPointF(1100);
    assert.ok(Math.abs(b - 210) < 0.01, `expected 210 at 1100 ft, got ${b}`);
    assert.ok(Math.abs((a - b) - 1) < 1e-6);
  });

  it('returns 212°F for non-finite or negative elevation (safe fallback)', () => {
    assert.strictEqual(boilingPointF(Number.NaN), 212);
    assert.strictEqual(boilingPointF(-100), 212);
  });

  it('expectedReadingF for ice_point is always 32 regardless of altitude', () => {
    assert.strictEqual(expectedReadingF('ice_point', 0), 32);
    assert.strictEqual(expectedReadingF('ice_point', 7800), 32);
    assert.strictEqual(expectedReadingF('ice_point', 29032), 32); // Everest
  });

  it('expectedReadingF for boiling_point uses the altitude correction', () => {
    assert.strictEqual(expectedReadingF('boiling_point', 0), 212);
    const v = expectedReadingF('boiling_point', 7800);
    assert.ok(Math.abs(v - 197.8) < 0.1);
  });
});

// ── validateCalibrationReading ───────────────────────────────────

describe('validateCalibrationReading — ice_point', () => {
  it('32°F exact is pass (deviation 0)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 32 });
    assert.strictEqual(v.status, 'pass');
    assert.strictEqual(v.expected_f, 32);
    assert.strictEqual(v.deviation_f, 0);
    assert.strictEqual(v.tolerance_f, 2);
    assert.match(v.citation, /§4-502\.11/);
    assert.strictEqual(v.reason, null);
  });

  it('33°F is pass (within +2)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 33 });
    assert.strictEqual(v.status, 'pass');
    assert.strictEqual(v.deviation_f, 1);
  });

  it('30°F is pass (within -2)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 30 });
    assert.strictEqual(v.status, 'pass');
  });

  it('34°F is pass at exactly +2 (inclusive tolerance)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 34 });
    assert.strictEqual(v.status, 'pass');
  });

  it('37°F is fail (5°F off target)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 37 });
    assert.strictEqual(v.status, 'fail');
    assert.strictEqual(v.deviation_f, 5);
    assert.match(v.reason, /off the 32.0°F target/);
  });

  it('29.5°F is fail (-2.5 > tolerance)', () => {
    const v = validateCalibrationReading({ method: 'ice_point', reading_f: 29.5 });
    assert.strictEqual(v.status, 'fail');
  });

  it('elevation override is irrelevant for ice_point — still 32°F target', () => {
    const v = validateCalibrationReading({
      method: 'ice_point',
      reading_f: 32,
      elevation_ft: 29032,
    });
    assert.strictEqual(v.status, 'pass');
    assert.strictEqual(v.expected_f, 32);
  });
});

describe('validateCalibrationReading — boiling_point', () => {
  it('212°F at sea level is pass', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 212,
      elevation_ft: 0,
    });
    assert.strictEqual(v.status, 'pass');
  });

  it('197.8°F at 7800 ft is pass (spot-on Lariat target)', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 197.8,
      elevation_ft: 7800,
    });
    assert.strictEqual(v.status, 'pass');
  });

  it('199°F at 7800 ft is pass (within +2 of 197.8)', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 199,
      elevation_ft: 7800,
    });
    assert.strictEqual(v.status, 'pass');
  });

  it('197°F at 7800 ft is pass (within -2 of 197.8)', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 197,
      elevation_ft: 7800,
    });
    assert.strictEqual(v.status, 'pass');
  });

  it('212°F at Lariat elevation is a FAIL (water does not boil at 212 there)', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 212,
      elevation_ft: 7800,
    });
    assert.strictEqual(v.status, 'fail');
    assert.ok(Math.abs(v.deviation_f - 14.18) < 0.1, `deviation ${v.deviation_f}`);
  });

  it('default elevation_ft is Lariat (7800 ft) — 197.8°F is pass without passing elevation', () => {
    const v = validateCalibrationReading({ method: 'boiling_point', reading_f: 198 });
    assert.strictEqual(v.status, 'pass');
  });

  it('195°F at 7800 ft is a fail (2.8°F off target)', () => {
    const v = validateCalibrationReading({
      method: 'boiling_point',
      reading_f: 195,
      elevation_ft: 7800,
    });
    assert.strictEqual(v.status, 'fail');
  });
});

describe('validateCalibrationReading — bad input', () => {
  it('throws on unknown method', () => {
    assert.throws(
      () => validateCalibrationReading({ method: 'slurry', reading_f: 32 }),
      /unknown calibration method/,
    );
  });

  it('throws on non-numeric reading', () => {
    assert.throws(
      () => validateCalibrationReading({ method: 'ice_point', reading_f: 'cold' }),
      /finite number/,
    );
  });

  it('throws on NaN reading', () => {
    assert.throws(
      () => validateCalibrationReading({ method: 'ice_point', reading_f: Number.NaN }),
      /finite number/,
    );
  });

  it('throws on absurd reading (off the charts)', () => {
    assert.throws(
      () => validateCalibrationReading({ method: 'ice_point', reading_f: 9999 }),
      /off the charts/,
    );
  });
});

// ── classifyProbes ───────────────────────────────────────────────

function isoDaysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * 86400000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

describe('classifyProbes — empty / unknown', () => {
  it('empty rows returns empty array', () => {
    const s = classifyProbes([]);
    assert.deepStrictEqual(s, []);
  });

  it('known_probe_ids with no rows yields one unknown tile per id', () => {
    const s = classifyProbes([], { known_probe_ids: ['probe-1', 'probe-2'] });
    assert.strictEqual(s.length, 2);
    for (const t of s) {
      assert.strictEqual(t.status, 'unknown');
      assert.strictEqual(t.total, 0);
      assert.strictEqual(t.last_calibrated_at, null);
      assert.strictEqual(t.next_due_at, null);
    }
  });
});

describe('classifyProbes — ok / due_soon / overdue / failed', () => {
  const now = new Date('2026-04-21T12:00:00Z');

  it('single recent pass is ok', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(1, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].status, 'ok');
    assert.strictEqual(s[0].last_passed, true);
    assert.strictEqual(s[0].total, 1);
    assert.ok(s[0].next_due_at);
  });

  it('pass 25 days ago with default 30d → due_soon (5 days remaining)', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(25, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'due_soon');
  });

  it('pass 35 days ago → overdue', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(35, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'overdue');
  });

  it('boundary: pass exactly 23 days ago → ok (7-day window opens at 23)', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(22, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'ok');
  });

  it('most recent is a fail → failed, even if earlier rows were pass', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(10, now),
        },
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 38,
          passed: 0,
          calibrated_at: isoDaysAgo(1, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'failed');
    assert.strictEqual(s[0].last_passed, false);
    assert.strictEqual(s[0].total, 2);
  });

  it('a passing cal after a fail flips status back to ok', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 38,
          passed: 0,
          calibrated_at: isoDaysAgo(5, now),
        },
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(1, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'ok');
    assert.strictEqual(s[0].last_passed, true);
  });

  it('per-probe frequency_days override wins over the default', () => {
    // 60-day freq; last pass 35d ago → 25 days remaining → ok (not overdue)
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-fast',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(35, now),
          frequency_days: 60,
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].status, 'ok');
    assert.strictEqual(s[0].frequency_days, 60);
  });

  it('opts.frequency_days default applies when per-probe value is absent', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-1',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(12, now),
        },
      ],
      { now, frequency_days: 14 },
    );
    // 14-day freq, last pass 12d ago → 2d remaining → due_soon
    assert.strictEqual(s[0].status, 'due_soon');
    assert.strictEqual(s[0].frequency_days, 14);
  });

  it('sort order: failed/overdue first, unknown mid, ok last', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'ok-probe',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(1, now),
        },
        {
          thermometer_id: 'failed-probe',
          method: 'ice_point',
          before_reading_f: 38,
          passed: 0,
          calibrated_at: isoDaysAgo(1, now),
        },
        {
          thermometer_id: 'overdue-probe',
          method: 'ice_point',
          before_reading_f: 32,
          passed: 1,
          calibrated_at: isoDaysAgo(60, now),
        },
      ],
      { now, known_probe_ids: ['new-probe'] },
    );
    assert.strictEqual(s[0].thermometer_id, 'failed-probe');
    assert.strictEqual(s[1].thermometer_id, 'overdue-probe');
    assert.strictEqual(s[2].thermometer_id, 'new-probe');
    assert.strictEqual(s[3].thermometer_id, 'ok-probe');
  });

  it('rows with empty thermometer_id are dropped', () => {
    const s = classifyProbes([
      {
        thermometer_id: '',
        method: 'ice_point',
        before_reading_f: 32,
        passed: 1,
        calibrated_at: isoDaysAgo(1, now),
      },
    ]);
    assert.strictEqual(s.length, 0);
  });

  it('reference_probe method is preserved in last_method even though it is not a spec method for the rule module', () => {
    const s = classifyProbes(
      [
        {
          thermometer_id: 'probe-ref',
          method: 'reference_probe',
          before_reading_f: 40,
          passed: 1,
          calibrated_at: isoDaysAgo(1, now),
        },
      ],
      { now },
    );
    assert.strictEqual(s[0].last_method, 'reference_probe');
    assert.strictEqual(s[0].status, 'ok');
  });
});

// ── calibrationWarningFor ────────────────────────────────────────

describe('calibrationWarningFor — advisory strings', () => {
  it('returns null for an ok probe', () => {
    const msg = calibrationWarningFor({
      thermometer_id: 'probe-1',
      status: 'ok',
      last_calibrated_at: '2026-04-20 10:00:00',
      last_method: 'ice_point',
      last_reading_f: 32,
      last_passed: true,
      next_due_at: '2026-05-20T10:00:00Z',
      frequency_days: 30,
      total: 1,
    });
    assert.strictEqual(msg, null);
  });

  it('returns null for a due_soon probe (board-level signal only)', () => {
    const msg = calibrationWarningFor({
      thermometer_id: 'probe-1',
      status: 'due_soon',
      last_calibrated_at: '2026-03-22 10:00:00',
      last_method: 'ice_point',
      last_reading_f: 32,
      last_passed: true,
      next_due_at: '2026-04-22T10:00:00Z',
      frequency_days: 30,
      total: 1,
    });
    assert.strictEqual(msg, null);
  });

  it('warns on unknown probe (never calibrated)', () => {
    const msg = calibrationWarningFor({
      thermometer_id: 'probe-new',
      status: 'unknown',
      last_calibrated_at: null,
      last_method: null,
      last_reading_f: null,
      last_passed: null,
      next_due_at: null,
      frequency_days: 30,
      total: 0,
    });
    assert.match(msg, /no calibration on record/);
    assert.match(msg, /probe-new/);
  });

  it('warns on failed probe', () => {
    const msg = calibrationWarningFor({
      thermometer_id: 'probe-2',
      status: 'failed',
      last_calibrated_at: '2026-04-20 10:00:00',
      last_method: 'ice_point',
      last_reading_f: 38,
      last_passed: false,
      next_due_at: null,
      frequency_days: 30,
      total: 1,
    });
    assert.match(msg, /failed its last calibration/);
    assert.match(msg, /probe-2/);
  });

  it('warns on overdue probe', () => {
    const msg = calibrationWarningFor({
      thermometer_id: 'probe-3',
      status: 'overdue',
      last_calibrated_at: '2026-02-01 10:00:00',
      last_method: 'boiling_point',
      last_reading_f: 197.5,
      last_passed: true,
      next_due_at: '2026-03-03T10:00:00Z',
      frequency_days: 30,
      total: 1,
    });
    assert.match(msg, /overdue/);
  });

  it('null summary returns null (defensive)', () => {
    assert.strictEqual(calibrationWarningFor(null), null);
    assert.strictEqual(calibrationWarningFor(undefined), null);
  });
});
