#!/usr/bin/env node
// Tests for lib/breaks — COMPS #39 §5 meal/rest break evaluator.
// Run: node --test tests/js/test-break-rules.mjs
//
// Pinning down the "major fraction thereof" math — easy to get off-by-one
// on the boundaries (2h, 4h, 6h, 10h). Reading of CDLE COMPS Order #39.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  REST_BREAK_MIN_MINUTES,
  MEAL_BREAK_MIN_MINUTES,
  MEAL_BREAK_THRESHOLD_HOURS,
  requiredRestBreaks,
  requiresMealBreak,
  evaluateShift,
} from '../../lib/breaks.ts';

// ── requiredRestBreaks — the table from COMPS §5.2.1 ───────────────

describe('requiredRestBreaks', () => {
  it('0h → 0 breaks', () => assert.strictEqual(requiredRestBreaks(0), 0));
  it('1.5h → 0 breaks', () => assert.strictEqual(requiredRestBreaks(1.5), 0));
  it('2h (edge) → 1 break (>2h "major fraction" includes 2h exactly)', () => {
    // Math.floor((2 + 2) / 4) = 1 — an even split: we credit the cook.
    assert.strictEqual(requiredRestBreaks(2), 1);
  });
  it('3.5h → 1 break (4h block with major fraction)', () => {
    assert.strictEqual(requiredRestBreaks(3.5), 1);
  });
  it('4h → 1 break', () => assert.strictEqual(requiredRestBreaks(4), 1));
  it('5.9h → 1 break (below major-fraction threshold)', () => {
    assert.strictEqual(requiredRestBreaks(5.9), 1);
  });
  it('6h → 2 breaks (exactly at major-fraction of second block)', () => {
    assert.strictEqual(requiredRestBreaks(6), 2);
  });
  it('8h → 2 breaks', () => assert.strictEqual(requiredRestBreaks(8), 2));
  it('9.9h → 2 breaks', () => assert.strictEqual(requiredRestBreaks(9.9), 2));
  it('10h → 3 breaks (major fraction of third block)', () => {
    assert.strictEqual(requiredRestBreaks(10), 3);
  });
  it('12h → 3 breaks', () => assert.strictEqual(requiredRestBreaks(12), 3));
  it('14h → 4 breaks', () => assert.strictEqual(requiredRestBreaks(14), 4));

  it('negative shift → 0', () => assert.strictEqual(requiredRestBreaks(-3), 0));
  it('NaN → 0', () => assert.strictEqual(requiredRestBreaks(Number.NaN), 0));
  it('Infinity → 0 (ignored)', () => assert.strictEqual(requiredRestBreaks(Infinity), 0));
});

describe('requiresMealBreak', () => {
  it(`shifts >= ${MEAL_BREAK_THRESHOLD_HOURS}h require a meal`, () => {
    assert.strictEqual(requiresMealBreak(5), true);
    assert.strictEqual(requiresMealBreak(8), true);
    assert.strictEqual(requiresMealBreak(12), true);
  });
  it('shifts under 5h do not', () => {
    assert.strictEqual(requiresMealBreak(4.9), false);
    assert.strictEqual(requiresMealBreak(3), false);
    assert.strictEqual(requiresMealBreak(0), false);
  });
  it('edge: exactly 5h requires', () => {
    assert.strictEqual(requiresMealBreak(5), true);
  });
  it('non-finite → false', () => {
    assert.strictEqual(requiresMealBreak(Number.NaN), false);
    assert.strictEqual(requiresMealBreak(Infinity), false);
  });
});

// ── evaluateShift ─────────────────────────────────────────────────

// A long shift that should require 1 meal + 2 rests.
const START = '2026-04-20T10:00:00Z';
const END = '2026-04-20T18:00:00Z';  // 8h

describe('evaluateShift — 8h shift', () => {
  it('no breaks taken → owes 1 meal + 2 rests', () => {
    const r = evaluateShift(START, END, []);
    assert.strictEqual(r.shift_hours, 8);
    assert.strictEqual(r.required_meal_breaks, 1);
    assert.strictEqual(r.required_rest_breaks, 2);
    assert.strictEqual(r.meal_breaks_owed, 1);
    assert.strictEqual(r.rest_breaks_owed, 2);
  });

  it('1 proper meal + 2 proper rests → nothing owed', () => {
    const r = evaluateShift(START, END, [
      { kind: 'meal', started_at: '2026-04-20T13:00:00Z', ended_at: '2026-04-20T13:30:00Z', duration_min: 30, waived: 0 },
      { kind: 'rest', started_at: '2026-04-20T11:30:00Z', ended_at: '2026-04-20T11:40:00Z', duration_min: 10, waived: 0 },
      { kind: 'rest', started_at: '2026-04-20T15:30:00Z', ended_at: '2026-04-20T15:40:00Z', duration_min: 10, waived: 0 },
    ]);
    assert.strictEqual(r.meal_breaks_owed, 0);
    assert.strictEqual(r.rest_breaks_owed, 0);
    assert.strictEqual(r.short_meal_breaks, 0);
    assert.strictEqual(r.short_rest_breaks, 0);
  });

  it('waived meal does NOT count as taken, but waived_meal increments', () => {
    const r = evaluateShift(START, END, [
      { kind: 'meal', started_at: '2026-04-20T13:00:00Z', ended_at: null, duration_min: null, waived: 1 },
    ]);
    assert.strictEqual(r.waived_meal_breaks, 1);
    assert.strictEqual(r.actual_meal_breaks, 0);
    // waived pays through — no 30min owed
    assert.strictEqual(r.meal_breaks_owed, 0);
  });

  it('short meal counts against compliance — owes pay', () => {
    const r = evaluateShift(START, END, [
      { kind: 'meal', started_at: '2026-04-20T13:00:00Z', ended_at: '2026-04-20T13:20:00Z', duration_min: 20, waived: 0 },
      { kind: 'rest', started_at: '2026-04-20T11:30:00Z', ended_at: '2026-04-20T11:40:00Z', duration_min: 10, waived: 0 },
      { kind: 'rest', started_at: '2026-04-20T15:30:00Z', ended_at: '2026-04-20T15:40:00Z', duration_min: 10, waived: 0 },
    ]);
    assert.strictEqual(r.short_meal_breaks, 1);
    assert.strictEqual(r.actual_meal_breaks, 0);
    assert.strictEqual(r.meal_breaks_owed, 1);   // treated as not-taken
    assert.ok(r.warnings.some((w) => /meal break.*under 30/.test(w)));
  });

  it('short rest surfaces warning', () => {
    const r = evaluateShift(START, END, [
      { kind: 'rest', started_at: '2026-04-20T11:30:00Z', ended_at: '2026-04-20T11:35:00Z', duration_min: 5, waived: 0 },
    ]);
    assert.strictEqual(r.short_rest_breaks, 1);
    assert.ok(r.warnings.some((w) => /rest break.*under 10/.test(w)));
  });

  it('duration computed from timestamps when duration_min is null', () => {
    const r = evaluateShift(START, END, [
      { kind: 'meal', started_at: '2026-04-20T13:00:00Z', ended_at: '2026-04-20T13:35:00Z', duration_min: null, waived: 0 },
    ]);
    assert.strictEqual(r.actual_meal_breaks, 1);
    assert.strictEqual(r.short_meal_breaks, 0);
  });

  it('open break (no end, no duration) adds a warning', () => {
    const r = evaluateShift(START, END, [
      { kind: 'rest', started_at: '2026-04-20T11:30:00Z', ended_at: null, duration_min: null, waived: 0 },
    ]);
    assert.ok(r.warnings.some((w) => /open rest/i.test(w)));
  });

  it('REST_BREAK_MIN_MINUTES constant matches spec (10)', () => {
    assert.strictEqual(REST_BREAK_MIN_MINUTES, 10);
  });

  it('MEAL_BREAK_MIN_MINUTES constant matches spec (30)', () => {
    assert.strictEqual(MEAL_BREAK_MIN_MINUTES, 30);
  });
});

describe('evaluateShift — shorter shifts', () => {
  it('3h shift: 0 meal required, 1 rest required', () => {
    const r = evaluateShift('2026-04-20T10:00:00Z', '2026-04-20T13:00:00Z', []);
    assert.strictEqual(r.shift_hours, 3);
    assert.strictEqual(r.required_meal_breaks, 0);
    assert.strictEqual(r.required_rest_breaks, 1);
    assert.strictEqual(r.meal_breaks_owed, 0);
    assert.strictEqual(r.rest_breaks_owed, 1);
  });

  it('exactly 5h: 1 meal required, 1 rest', () => {
    const r = evaluateShift('2026-04-20T10:00:00Z', '2026-04-20T15:00:00Z', []);
    assert.strictEqual(r.required_meal_breaks, 1);
    assert.strictEqual(r.required_rest_breaks, 1);
  });

  it('invalid timestamps → warning + zeroed counts', () => {
    const r = evaluateShift('not-a-time', '2026-04-20T18:00:00Z', []);
    assert.strictEqual(r.shift_hours, 0);
    assert.strictEqual(r.required_meal_breaks, 0);
    assert.strictEqual(r.required_rest_breaks, 0);
    assert.ok(r.warnings.some((w) => /invalid shift/i.test(w)));
  });

  it('end before start → error-path warning', () => {
    const r = evaluateShift('2026-04-20T18:00:00Z', '2026-04-20T10:00:00Z', []);
    assert.strictEqual(r.shift_hours, 0);
    assert.ok(r.warnings.some((w) => /invalid shift/i.test(w)));
  });

  it('waived meal on sub-5h shift triggers warning', () => {
    const r = evaluateShift('2026-04-20T10:00:00Z', '2026-04-20T13:00:00Z', [
      { kind: 'meal', started_at: '2026-04-20T11:00:00Z', ended_at: null, duration_min: null, waived: 1 },
    ]);
    assert.ok(r.warnings.some((w) => /did not require/i.test(w)));
  });
});

describe('evaluateShift — 12h shift (long day)', () => {
  const start = '2026-04-20T08:00:00Z';
  const end = '2026-04-20T20:00:00Z';

  it('requires 1 meal + 3 rests', () => {
    const r = evaluateShift(start, end, []);
    assert.strictEqual(r.shift_hours, 12);
    assert.strictEqual(r.required_meal_breaks, 1);
    assert.strictEqual(r.required_rest_breaks, 3);
  });

  it('partial compliance owes the gap', () => {
    const r = evaluateShift(start, end, [
      { kind: 'meal', started_at: '2026-04-20T13:00:00Z', ended_at: '2026-04-20T13:35:00Z', duration_min: 35, waived: 0 },
      { kind: 'rest', started_at: '2026-04-20T10:00:00Z', ended_at: '2026-04-20T10:10:00Z', duration_min: 10, waived: 0 },
    ]);
    assert.strictEqual(r.meal_breaks_owed, 0);
    assert.strictEqual(r.rest_breaks_owed, 2);
  });
});
