#!/usr/bin/env node
// Tests for lib/specialsValidators — pure validators with no DB or HTTP.
// Run: node --experimental-strip-types --test tests/js/test-specials-saved-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const v = await import('../../lib/specialsValidators.ts');

describe('validateName', () => {
  it('accepts a 1-char name', () => {
    assert.deepEqual(v.validateName('A'), { ok: true, value: 'A' });
  });
  it('accepts a 200-char name', () => {
    assert.equal(v.validateName('x'.repeat(200)).ok, true);
  });
  it('trims whitespace', () => {
    assert.deepEqual(v.validateName('  Pork Belly App  '), { ok: true, value: 'Pork Belly App' });
  });
  it('rejects empty string', () => {
    assert.equal(v.validateName('').ok, false);
  });
  it('rejects whitespace-only', () => {
    assert.equal(v.validateName('   ').ok, false);
  });
  it('rejects 201-char', () => {
    assert.equal(v.validateName('x'.repeat(201)).ok, false);
  });
  it('rejects non-string', () => {
    assert.equal(v.validateName(null).ok, false);
    assert.equal(v.validateName(undefined).ok, false);
    assert.equal(v.validateName(123).ok, false);
  });
});

describe('validateSlug', () => {
  it('accepts lowercase-hyphen', () => {
    assert.deepEqual(v.validateSlug('pork-belly-app'), { ok: true, value: 'pork-belly-app' });
  });
  it('accepts digits', () => {
    assert.equal(v.validateSlug('beef-100').ok, true);
  });
  it('rejects uppercase', () => {
    assert.equal(v.validateSlug('Pork-Belly').ok, false);
  });
  it('rejects spaces', () => {
    assert.equal(v.validateSlug('pork belly').ok, false);
  });
  it('rejects underscores', () => {
    assert.equal(v.validateSlug('pork_belly').ok, false);
  });
  it('rejects empty', () => {
    assert.equal(v.validateSlug('').ok, false);
  });
  it('rejects > 80 chars', () => {
    assert.equal(v.validateSlug('a'.repeat(81)).ok, false);
  });
  it('accepts 80 chars', () => {
    assert.equal(v.validateSlug('a'.repeat(80)).ok, true);
  });
});

describe('validateYieldQty', () => {
  it('accepts a positive number', () => {
    assert.deepEqual(v.validateYieldQty(12), { ok: true, value: 12 });
  });
  it('accepts a fractional positive', () => {
    assert.equal(v.validateYieldQty(0.001).ok, true);
  });
  it('rejects zero', () => {
    assert.equal(v.validateYieldQty(0).ok, false);
  });
  it('rejects negative', () => {
    assert.equal(v.validateYieldQty(-1).ok, false);
  });
  it('rejects NaN', () => {
    assert.equal(v.validateYieldQty(NaN).ok, false);
  });
  it('rejects Infinity', () => {
    assert.equal(v.validateYieldQty(Infinity).ok, false);
  });
  it('rejects strings', () => {
    assert.equal(v.validateYieldQty('12').ok, false);
  });
});

describe('validateYieldUnit', () => {
  it('accepts a 1-char unit', () => {
    assert.deepEqual(v.validateYieldUnit('g'), { ok: true, value: 'g' });
  });
  it('trims whitespace', () => {
    assert.deepEqual(v.validateYieldUnit('  portions  '), { ok: true, value: 'portions' });
  });
  it('rejects empty', () => {
    assert.equal(v.validateYieldUnit('').ok, false);
    assert.equal(v.validateYieldUnit('   ').ok, false);
  });
  it('rejects > 32 chars', () => {
    assert.equal(v.validateYieldUnit('x'.repeat(33)).ok, false);
  });
});

describe('validatePatchKeys', () => {
  it('accepts name only', () => {
    assert.deepEqual(v.validatePatchKeys({ name: 'X' }), { ok: true, rejected: [] });
  });
  it('accepts scratch_notes only', () => {
    assert.deepEqual(v.validatePatchKeys({ scratch_notes: 'X' }), { ok: true, rejected: [] });
  });
  it('accepts both', () => {
    assert.equal(v.validatePatchKeys({ name: 'X', scratch_notes: 'Y' }).ok, true);
  });
  it('rejects unknown keys', () => {
    const r = v.validatePatchKeys({ name: 'X', ai_answer: 'Z', cost_total: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.rejected.sort(), ['ai_answer', 'cost_total']);
  });
  it('rejects empty body', () => {
    assert.equal(v.validatePatchKeys({}).ok, false);
  });
});

describe('clipText', () => {
  it('returns the string unchanged when shorter than max', () => {
    assert.equal(v.clipText('hello', 100), 'hello');
  });
  it('clips to exactly max chars when longer', () => {
    assert.equal(v.clipText('x'.repeat(50), 10).length, 10);
    assert.equal(v.clipText('x'.repeat(50), 10), 'x'.repeat(10));
  });
  it('returns empty string for non-string input', () => {
    assert.equal(v.clipText(null, 10), '');
    assert.equal(v.clipText(undefined, 10), '');
    assert.equal(v.clipText(42, 10), '');
  });
  it('returns empty string for empty input', () => {
    assert.equal(v.clipText('', 10), '');
  });
  it('handles boundary: exactly max chars unchanged', () => {
    assert.equal(v.clipText('x'.repeat(10), 10).length, 10);
  });
});

describe('SCRATCH_NOTES_MAX / PANTRY_TEXT_MAX / PROMPT_TEXT_MAX', () => {
  it('exports operator-generous caps for user-editable text fields', () => {
    assert.equal(typeof v.SCRATCH_NOTES_MAX, 'number');
    assert.equal(typeof v.PANTRY_TEXT_MAX, 'number');
    assert.equal(typeof v.PROMPT_TEXT_MAX, 'number');
    assert.ok(v.SCRATCH_NOTES_MAX >= 1000);
    assert.ok(v.PANTRY_TEXT_MAX >= 1000);
    assert.ok(v.PROMPT_TEXT_MAX >= 500);
  });
});

describe('coerceJsonField', () => {
  it('accepts an object', () => {
    assert.deepEqual(v.coerceJsonField({ a: 1 }), { ok: true, value: '{"a":1}' });
  });
  it('accepts an array', () => {
    assert.deepEqual(v.coerceJsonField([{ a: 1 }]), { ok: true, value: '[{"a":1}]' });
  });
  it('accepts a valid JSON string', () => {
    assert.deepEqual(v.coerceJsonField('{"a":1}'), { ok: true, value: '{"a":1}' });
  });
  it('rejects a non-JSON string', () => {
    assert.equal(v.coerceJsonField('not json').ok, false);
  });
  it('treats null/undefined as no-op', () => {
    assert.deepEqual(v.coerceJsonField(null), { ok: true, value: null });
    assert.deepEqual(v.coerceJsonField(undefined), { ok: true, value: null });
  });
});
