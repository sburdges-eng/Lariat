#!/usr/bin/env node
// Tests for lib/sanitizer — concentration band validation (F4 / FDA §4-703.11).
// Run: node --test tests/js/test-sanitizer-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHEMISTRIES,
  bandFor,
  validateSanitizerCheck,
  classifySanitizer,
  DEFAULT_POINTS,
} from '../../lib/sanitizer.ts';

// ── bandFor ────────────────────────────────────────────────────────

describe('bandFor', () => {
  it('chlorine at ≥75°F is 50-100 ppm', () => {
    const b = bandFor('chlorine', 75);
    assert.deepStrictEqual(b, { min_ppm: 50, max_ppm: 100, label: 'chlorine @≥75°F' });
  });

  it('chlorine at exactly 75°F uses the hot band', () => {
    assert.strictEqual(bandFor('chlorine', 75).min_ppm, 50);
  });

  it('chlorine below 75°F is 75-100 ppm', () => {
    const b = bandFor('chlorine', 70);
    assert.deepStrictEqual(b, { min_ppm: 75, max_ppm: 100, label: 'chlorine @<75°F' });
  });

  it('chlorine with null water temp defaults to the cold (stricter) band', () => {
    const b = bandFor('chlorine', null);
    assert.strictEqual(b.min_ppm, 75);
  });

  it('chlorine at 74.9°F uses the cold band', () => {
    assert.strictEqual(bandFor('chlorine', 74.9).min_ppm, 75);
  });

  it('quat returns 150-400 ppm regardless of temperature', () => {
    const hot = bandFor('quat', 120);
    const cold = bandFor('quat', 40);
    const nullt = bandFor('quat', null);
    assert.deepStrictEqual(hot, { min_ppm: 150, max_ppm: 400, label: 'quaternary ammonia' });
    assert.deepStrictEqual(cold, hot);
    assert.deepStrictEqual(nullt, hot);
  });

  it('iodine returns 12.5-25 ppm', () => {
    const b = bandFor('iodine', null);
    assert.deepStrictEqual(b, { min_ppm: 12.5, max_ppm: 25, label: 'iodine' });
  });

  it('"other" returns null — we record but do not classify', () => {
    assert.strictEqual(bandFor('other', 100), null);
  });

  it('CHEMISTRIES set is exactly the four we support', () => {
    assert.deepStrictEqual(
      [...CHEMISTRIES].sort(),
      ['chlorine', 'iodine', 'other', 'quat'],
    );
  });
});

// ── validateSanitizerCheck ─────────────────────────────────────────

describe('validateSanitizerCheck', () => {
  const base = {
    chemistry: 'chlorine',
    concentration_ppm: 80,
    water_temp_f: 75,
    point_label: 'Dish pit final rinse',
  };

  it('accepts a clean input', () => {
    assert.deepStrictEqual(validateSanitizerCheck(base), { ok: true });
  });

  it('accepts null water_temp_f', () => {
    assert.deepStrictEqual(validateSanitizerCheck({ ...base, water_temp_f: null }), { ok: true });
  });

  it('accepts undefined water_temp_f', () => {
    assert.deepStrictEqual(validateSanitizerCheck({ ...base, water_temp_f: undefined }), { ok: true });
  });

  it('rejects unknown chemistry', () => {
    const r = validateSanitizerCheck({ ...base, chemistry: 'bleach' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /chemistry/);
  });

  it('rejects missing concentration', () => {
    const r = validateSanitizerCheck({ ...base, concentration_ppm: undefined });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /concentration/);
  });

  it('rejects NaN concentration', () => {
    const r = validateSanitizerCheck({ ...base, concentration_ppm: Number.NaN });
    assert.strictEqual(r.ok, false);
  });

  it('rejects stringified concentration — no coercion', () => {
    const r = validateSanitizerCheck({ ...base, concentration_ppm: '80' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects negative concentration', () => {
    const r = validateSanitizerCheck({ ...base, concentration_ppm: -5 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /charts|strip/);
  });

  it('rejects concentration above plausible max', () => {
    const r = validateSanitizerCheck({ ...base, concentration_ppm: 1500 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /charts|strip/);
  });

  it('accepts concentration at 0 (surface not sanitized yet)', () => {
    assert.deepStrictEqual(validateSanitizerCheck({ ...base, concentration_ppm: 0 }), { ok: true });
  });

  it('accepts concentration at exactly 1000', () => {
    assert.deepStrictEqual(validateSanitizerCheck({ ...base, concentration_ppm: 1000 }), { ok: true });
  });

  it('rejects missing point_label', () => {
    const r = validateSanitizerCheck({ ...base, point_label: '' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /point_label/);
  });

  it('rejects whitespace-only point_label', () => {
    const r = validateSanitizerCheck({ ...base, point_label: '   ' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-finite water_temp_f', () => {
    const r = validateSanitizerCheck({ ...base, water_temp_f: Number.POSITIVE_INFINITY });
    assert.strictEqual(r.ok, false);
  });

  it('rejects water_temp_f out of plausible range', () => {
    const r = validateSanitizerCheck({ ...base, water_temp_f: 300 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /water_temp/);
  });
});

// ── classifySanitizer ─────────────────────────────────────────────

describe('classifySanitizer', () => {
  it('chlorine @80ppm, 75°F → ok', () => {
    const r = classifySanitizer('chlorine', 80, 75);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.breach_reason, null);
    assert.strictEqual(r.required_min_ppm, 50);
  });

  it('chlorine @40ppm, 80°F → low', () => {
    const r = classifySanitizer('chlorine', 40, 80);
    assert.strictEqual(r.status, 'low');
    assert.ok(r.breach_reason);
    assert.match(r.breach_reason, /40/);
  });

  it('chlorine @200ppm, 80°F → high', () => {
    const r = classifySanitizer('chlorine', 200, 80);
    assert.strictEqual(r.status, 'high');
    assert.ok(r.breach_reason);
  });

  it('chlorine @60ppm at 70°F (cold band requires 75) → low', () => {
    const r = classifySanitizer('chlorine', 60, 70);
    assert.strictEqual(r.status, 'low');
  });

  it('chlorine @60ppm at 80°F (hot band allows 50) → ok', () => {
    const r = classifySanitizer('chlorine', 60, 80);
    assert.strictEqual(r.status, 'ok');
  });

  it('quat @200ppm → ok', () => {
    assert.strictEqual(classifySanitizer('quat', 200, null).status, 'ok');
  });

  it('quat @100ppm → low', () => {
    assert.strictEqual(classifySanitizer('quat', 100, null).status, 'low');
  });

  it('quat @500ppm → high', () => {
    assert.strictEqual(classifySanitizer('quat', 500, null).status, 'high');
  });

  it('iodine @15ppm → ok', () => {
    assert.strictEqual(classifySanitizer('iodine', 15, null).status, 'ok');
  });

  it('iodine @10ppm → low', () => {
    assert.strictEqual(classifySanitizer('iodine', 10, null).status, 'low');
  });

  it('iodine @30ppm → high', () => {
    assert.strictEqual(classifySanitizer('iodine', 30, null).status, 'high');
  });

  it('other → ok regardless of concentration (no band to judge by)', () => {
    const r = classifySanitizer('other', 0.1, null);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.band, null);
    assert.strictEqual(r.required_min_ppm, null);
    assert.strictEqual(r.required_max_ppm, null);
  });

  it('edge: chlorine @50ppm hot band → ok (inclusive)', () => {
    assert.strictEqual(classifySanitizer('chlorine', 50, 80).status, 'ok');
  });

  it('edge: chlorine @100ppm → ok (inclusive)', () => {
    assert.strictEqual(classifySanitizer('chlorine', 100, 80).status, 'ok');
  });

  it('edge: chlorine @49ppm hot band → low', () => {
    assert.strictEqual(classifySanitizer('chlorine', 49, 80).status, 'low');
  });
});

// ── DEFAULT_POINTS sanity ───────────────────────────────────────────

describe('DEFAULT_POINTS', () => {
  it('every default point has a supported chemistry', () => {
    for (const p of DEFAULT_POINTS) {
      assert.ok(CHEMISTRIES.includes(p.chemistry), `unsupported chemistry on ${p.id}: ${p.chemistry}`);
    }
  });

  it('ids are unique and snake_case', () => {
    const ids = DEFAULT_POINTS.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.match(id, /^[a-z][a-z0-9_]*$/);
    }
  });

  it('at least one dish pit point exists', () => {
    assert.ok(DEFAULT_POINTS.some((p) => p.id.includes('dish')), 'need a dish-pit default');
  });

  it('at least one wiping bucket point exists', () => {
    assert.ok(DEFAULT_POINTS.some((p) => p.id.includes('wiping')), 'need a wiping-bucket default');
  });
});
