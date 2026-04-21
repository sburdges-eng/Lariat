#!/usr/bin/env node
// Tests for lib/tempLog — temp-point registry + pure validation/classification.
// Run: node --test tests/js/test-temp-log.mjs
//
// Why this file lives under tests/js/ instead of tests/ directly:
// JS test specs are grouped under tests/js/ and Python specs under
// tests/python/. The package.json `test:temp-log` script already
// references this nested path, so moving the file would break that.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TempPoints,
  getTempPoint,
  validateTempReading,
  classifyReading,
  normalizeCorrectiveAction,
  entryFromReading,
} from '../../lib/tempLog.ts';

// ── Registry ───────────────────────────────────────────────────────

describe('TempPoints registry', () => {
  it('has 8-16 points (high-value cold/hot/cook set)', () => {
    // Upper bound bumped from 12 → 16 in Bundle F to accommodate the
    // added cook_pork / cook_beef_steak / cook_eggs protein points.
    assert.ok(TempPoints.length >= 8, `expected >= 8 points, got ${TempPoints.length}`);
    assert.ok(TempPoints.length <= 16, `expected <= 16 points, got ${TempPoints.length}`);
  });

  it('every point is grounded in a CCP (CCP-n id)', () => {
    for (const p of TempPoints) {
      assert.match(p.ccp_id, /^CCP-\d+$/, `bad ccp_id on ${p.id}: ${p.ccp_id}`);
    }
  });

  it('every point has a bound (min or max not both null)', () => {
    for (const p of TempPoints) {
      assert.ok(
        p.required_min_f !== null || p.required_max_f !== null,
        `point ${p.id} has no bounds at all`,
      );
    }
  });

  it('ids are unique and snake_case', () => {
    const ids = TempPoints.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate point ids');
    for (const id of ids) {
      assert.match(id, /^[a-z][a-z0-9_]*$/, `id not snake_case: ${id}`);
    }
  });

  it('getTempPoint returns the point by id', () => {
    const first = TempPoints[0];
    assert.deepStrictEqual(getTempPoint(first.id), first);
  });

  it('getTempPoint returns undefined for unknown id', () => {
    assert.strictEqual(getTempPoint('does_not_exist'), undefined);
  });

  it('walk-in cooler point matches CCP-2 (≤ 41°F)', () => {
    const p = getTempPoint('walk_in_cooler');
    assert.ok(p, 'walk_in_cooler must exist');
    assert.strictEqual(p.ccp_id, 'CCP-2');
    assert.strictEqual(p.required_max_f, 41);
    assert.strictEqual(p.required_min_f, null);
  });

  it('poultry cook point matches CCP-4 (≥ 165°F)', () => {
    const p = getTempPoint('cook_poultry');
    assert.ok(p, 'cook_poultry must exist');
    assert.strictEqual(p.ccp_id, 'CCP-4');
    assert.strictEqual(p.required_min_f, 165);
    assert.strictEqual(p.required_max_f, null);
  });
});

// ── validateTempReading ────────────────────────────────────────────

const COLD_HOLD = {
  id: 'walk_in_cooler',
  label: 'Walk-in cooler',
  ccp_id: 'CCP-2',
  required_min_f: null,
  required_max_f: 41,
};

const COOK_POULTRY = {
  id: 'cook_poultry',
  label: 'Cook — poultry',
  ccp_id: 'CCP-4',
  required_min_f: 165,
  required_max_f: null,
};

describe('validateTempReading — in range', () => {
  it('reading in range with no corrective action returns ok', () => {
    const r = validateTempReading(COLD_HOLD, 38, '');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('reading in range ignores corrective action content', () => {
    const r = validateTempReading(COLD_HOLD, 40, 'anything');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('reading exactly at max is ok (inclusive)', () => {
    const r = validateTempReading(COLD_HOLD, 41, '');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('reading exactly at min is ok (inclusive)', () => {
    const r = validateTempReading(COOK_POULTRY, 165, '');
    assert.deepStrictEqual(r, { ok: true });
  });
});

describe('validateTempReading — cold hold (max only)', () => {
  it('above max without corrective action is rejected with kitchen-native reason', () => {
    const r = validateTempReading(COLD_HOLD, 44, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /walk-in cooler/i);
    assert.match(r.reason, /44/);
    assert.match(r.reason, /41/);
    assert.match(r.reason, /note on the fix/i);
  });

  it('above max with whitespace-only corrective action is rejected', () => {
    const r = validateTempReading(COLD_HOLD, 44, '   ');
    assert.strictEqual(r.ok, false);
  });

  it('above max with non-empty corrective action is accepted', () => {
    const r = validateTempReading(COLD_HOLD, 44, 'moved product to reach-in, called tech');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('below-max reading is fine (no min on cold hold)', () => {
    const r = validateTempReading(COLD_HOLD, -20, '');
    assert.deepStrictEqual(r, { ok: true });
  });
});

describe('validateTempReading — cook (min only)', () => {
  it('below min without corrective action is rejected', () => {
    const r = validateTempReading(COOK_POULTRY, 150, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /150/);
    assert.match(r.reason, /165/);
    assert.match(r.reason, /note on the fix/i);
  });

  it('below min with corrective action is accepted', () => {
    const r = validateTempReading(COOK_POULTRY, 150, 'kept on heat until 170');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('well above min is fine (no max on cooking temps)', () => {
    const r = validateTempReading(COOK_POULTRY, 220, '');
    assert.deepStrictEqual(r, { ok: true });
  });
});

describe('validateTempReading — both bounds', () => {
  const HOT_LINE = {
    id: 'hot_line',
    label: 'Hot line',
    ccp_id: 'CCP-7',
    required_min_f: 140,
    required_max_f: 200,
  };

  it('below min rejected without action', () => {
    const r = validateTempReading(HOT_LINE, 130, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /below limit/i);
  });

  it('above max rejected without action', () => {
    const r = validateTempReading(HOT_LINE, 210, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /above limit/i);
  });

  it('in range is ok', () => {
    const r = validateTempReading(HOT_LINE, 160, '');
    assert.deepStrictEqual(r, { ok: true });
  });
});

describe('validateTempReading — bad input (invalid, not out-of-range)', () => {
  it('NaN is rejected with bad-input reason, not compliance reason', () => {
    const r = validateTempReading(COLD_HOLD, Number.NaN, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.doesNotMatch(r.reason, /note on the fix/i);
    assert.match(r.reason, /number/i);
  });

  it('undefined reading is bad input', () => {
    const r = validateTempReading(COLD_HOLD, undefined, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.doesNotMatch(r.reason, /note on the fix/i);
  });

  it('string "42" is bad input — no coercion', () => {
    const r = validateTempReading(COLD_HOLD, '42', '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.doesNotMatch(r.reason, /note on the fix/i);
  });

  it('Infinity is bad input', () => {
    const r = validateTempReading(COLD_HOLD, Infinity, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
  });

  it('reading below -100°F is bad input (probe problem)', () => {
    const r = validateTempReading(COLD_HOLD, -500, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /probe|off the charts/i);
  });

  it('reading above 500°F is bad input', () => {
    const r = validateTempReading(COOK_POULTRY, 999, 'whatever');
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /probe|off the charts/i);
  });

  it('absolute-sanity bound is -100 inclusive', () => {
    // -100 is on the edge; cold hold has no min so -100 should pass.
    const r = validateTempReading(COLD_HOLD, -100, '');
    assert.deepStrictEqual(r, { ok: true });
  });

  it('absolute-sanity bound is 500 inclusive', () => {
    // 500 is on the edge; poultry has no max so 500 should pass.
    const r = validateTempReading(COOK_POULTRY, 500, '');
    assert.deepStrictEqual(r, { ok: true });
  });
});

describe('validateTempReading — out-of-range with non-string corrective action', () => {
  // Reviewer fix 4: non-string corrective_action should be treated the
  // same as empty (needs a note), not coerced and not treated as a
  // bad-input reason.
  it('out of range + numeric corrective action asks for a note', () => {
    const r = validateTempReading(COLD_HOLD, 44, 42);
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /note on the fix/i);
    assert.doesNotMatch(r.reason, /probe|off the charts/i);
    assert.doesNotMatch(r.reason, /must be a number/i);
  });

  it('out of range + null corrective action asks for a note', () => {
    const r = validateTempReading(COOK_POULTRY, 150, null);
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /note on the fix/i);
    assert.doesNotMatch(r.reason, /probe|off the charts/i);
  });

  it('out of range + object corrective action asks for a note', () => {
    const r = validateTempReading(COLD_HOLD, 44, {});
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /note on the fix/i);
  });
});

// ── classifyReading ────────────────────────────────────────────────

describe('classifyReading', () => {
  it('in-range cold hold is ok', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, 38), 'ok');
  });

  it('above max cold hold is out_of_range', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, 45), 'out_of_range');
  });

  it('below min cook poultry is out_of_range', () => {
    assert.strictEqual(classifyReading(COOK_POULTRY, 150), 'out_of_range');
  });

  it('above min cook poultry is ok', () => {
    assert.strictEqual(classifyReading(COOK_POULTRY, 170), 'ok');
  });

  it('NaN is invalid', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, Number.NaN), 'invalid');
  });

  it('string is invalid', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, '38'), 'invalid');
  });

  it('undefined is invalid', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, undefined), 'invalid');
  });

  it('Infinity is invalid', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, Infinity), 'invalid');
  });

  it('reading past absolute sanity bounds is invalid', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, -500), 'invalid');
    assert.strictEqual(classifyReading(COOK_POULTRY, 999), 'invalid');
  });

  it('edge: exactly at max is ok', () => {
    assert.strictEqual(classifyReading(COLD_HOLD, 41), 'ok');
  });

  it('edge: exactly at min is ok', () => {
    assert.strictEqual(classifyReading(COOK_POULTRY, 165), 'ok');
  });
});

// ── normalizeCorrectiveAction ──────────────────────────────────────

describe('normalizeCorrectiveAction', () => {
  it('trims a non-empty string and returns it', () => {
    assert.strictEqual(normalizeCorrectiveAction('  moved to reach-in  '), 'moved to reach-in');
  });

  it('whitespace-only string becomes null', () => {
    assert.strictEqual(normalizeCorrectiveAction('   '), null);
  });

  it('empty string becomes null', () => {
    assert.strictEqual(normalizeCorrectiveAction(''), null);
  });

  it('undefined becomes null', () => {
    assert.strictEqual(normalizeCorrectiveAction(undefined), null);
  });

  it('null becomes null', () => {
    assert.strictEqual(normalizeCorrectiveAction(null), null);
  });

  it('number becomes null (no coercion)', () => {
    assert.strictEqual(normalizeCorrectiveAction(42), null);
  });
});

// ── entryFromReading ───────────────────────────────────────────────

describe('entryFromReading', () => {
  it('snapshots required_min_f and required_max_f from the point', () => {
    const point = getTempPoint('walk_in_cooler');
    assert.ok(point, 'walk_in_cooler must exist');
    const entry = entryFromReading({
      point,
      reading_f: 38,
      corrective_action: null,
      shift_date: '2026-04-18',
      cook_id: 'alice',
    });
    assert.strictEqual(entry.required_min_f, point.required_min_f);
    assert.strictEqual(entry.required_max_f, point.required_max_f);
    assert.strictEqual(entry.required_max_f, 41);
    assert.strictEqual(entry.required_min_f, null);
  });

  it('snapshots min bound for cook points too', () => {
    const point = getTempPoint('cook_poultry');
    assert.ok(point, 'cook_poultry must exist');
    const entry = entryFromReading({
      point,
      reading_f: 170,
      corrective_action: null,
      shift_date: '2026-04-18',
      cook_id: 'bob',
    });
    assert.strictEqual(point.required_max_f, entry.required_max_f);
    assert.strictEqual(entry.required_min_f, 165);
    assert.strictEqual(entry.required_max_f, null);
  });

  it('passes through point_id, reading_f, shift_date, cook_id', () => {
    const point = getTempPoint('hot_hold');
    assert.ok(point, 'hot_hold must exist');
    const entry = entryFromReading({
      point,
      reading_f: 155,
      corrective_action: 'topped up hot water',
      shift_date: '2026-04-18',
      cook_id: 'chris',
    });
    assert.strictEqual(entry.point_id, 'hot_hold');
    assert.strictEqual(entry.reading_f, 155);
    assert.strictEqual(entry.shift_date, '2026-04-18');
    assert.strictEqual(entry.cook_id, 'chris');
    assert.strictEqual(entry.corrective_action, 'topped up hot water');
  });

  it('defaults location_id to "default" when not passed', () => {
    const point = getTempPoint('freezer');
    assert.ok(point, 'freezer must exist');
    const entry = entryFromReading({
      point,
      reading_f: -5,
      corrective_action: null,
      shift_date: '2026-04-18',
      cook_id: null,
    });
    assert.strictEqual(entry.location_id, 'default');
  });

  it('honors an explicit location_id', () => {
    const point = getTempPoint('freezer');
    assert.ok(point, 'freezer must exist');
    const entry = entryFromReading({
      point,
      reading_f: -5,
      corrective_action: null,
      shift_date: '2026-04-18',
      cook_id: null,
      location_id: 'downtown',
    });
    assert.strictEqual(entry.location_id, 'downtown');
  });

  it('empty corrective_action string is normalized to null', () => {
    const point = getTempPoint('cook_fish');
    assert.ok(point, 'cook_fish must exist');
    const entry = entryFromReading({
      point,
      reading_f: 150,
      corrective_action: '',
      shift_date: '2026-04-18',
      cook_id: 'dana',
    });
    assert.strictEqual(entry.corrective_action, null);
  });

  it('whitespace-only corrective_action is normalized to null', () => {
    const point = getTempPoint('cook_fish');
    assert.ok(point, 'cook_fish must exist');
    const entry = entryFromReading({
      point,
      reading_f: 150,
      corrective_action: '   ',
      shift_date: '2026-04-18',
      cook_id: 'dana',
    });
    assert.strictEqual(entry.corrective_action, null);
  });

  it('non-null corrective_action is trimmed', () => {
    const point = getTempPoint('cook_fish');
    assert.ok(point, 'cook_fish must exist');
    const entry = entryFromReading({
      point,
      reading_f: 150,
      corrective_action: '  returned to heat  ',
      shift_date: '2026-04-18',
      cook_id: 'dana',
    });
    assert.strictEqual(entry.corrective_action, 'returned to heat');
  });

  it('snapshot does not alias the point object (editing point later does not mutate entry)', () => {
    // Snapshotting is about value, not aliasing; verify the entry carries
    // the numeric values rather than a live reference.
    const point = {
      id: 'walk_in_cooler',
      label: 'Walk-in cooler',
      ccp_id: 'CCP-2',
      required_min_f: null,
      required_max_f: 41,
    };
    const entry = entryFromReading({
      point,
      reading_f: 38,
      corrective_action: null,
      shift_date: '2026-04-18',
      cook_id: 'alice',
    });
    // Mutating the source point must not change the snapshot in the entry.
    point.required_max_f = 9999;
    assert.strictEqual(entry.required_max_f, 41);
  });
});
