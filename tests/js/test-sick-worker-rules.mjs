#!/usr/bin/env node
// Tests for lib/sickWorker — FDA §2-201.11 exclusion/restriction math.
// Run: node --test tests/js/test-sick-worker-rules.mjs
//
// The rule encoded: certain symptoms REQUIRE exclusion, others REQUIRE
// restriction, and any Big-6 diagnosis forces exclusion. The PIC may
// raise severity (exclude when only restriction is required) but may
// NEVER lower it. This is the "FDA floor" check.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYMPTOMS,
  DIAGNOSES,
  requiredActionFor,
  normalizeSymptoms,
  normalizeDiagnosis,
  validateSickReport,
} from '../../lib/sickWorker.ts';

// ── requiredActionFor — the canonical rule table ───────────────────

describe('requiredActionFor', () => {
  it('vomiting → excluded', () => {
    assert.strictEqual(requiredActionFor(['vomiting'], null), 'excluded');
  });
  it('diarrhea → excluded', () => {
    assert.strictEqual(requiredActionFor(['diarrhea'], null), 'excluded');
  });
  it('jaundice → excluded', () => {
    assert.strictEqual(requiredActionFor(['jaundice'], null), 'excluded');
  });
  it('sore throat + fever → restricted', () => {
    assert.strictEqual(requiredActionFor(['sore_throat_with_fever'], null), 'restricted');
  });
  it('infected lesion → restricted (PIC may exclude)', () => {
    assert.strictEqual(requiredActionFor(['infected_lesion'], null), 'restricted');
  });
  it('any Big-6 diagnosis → excluded', () => {
    for (const d of DIAGNOSES) {
      assert.strictEqual(requiredActionFor([], d), 'excluded', `diagnosis ${d}`);
    }
  });
  it('no symptoms, no diagnosis → none', () => {
    assert.strictEqual(requiredActionFor([], null), 'none');
  });
  it('mixed severities — strictest wins', () => {
    assert.strictEqual(
      requiredActionFor(['infected_lesion', 'vomiting'], null),
      'excluded',
    );
  });
  it('diagnosis overrides lighter symptoms', () => {
    assert.strictEqual(
      requiredActionFor(['infected_lesion'], 'norovirus'),
      'excluded',
    );
  });
});

// ── normalizeSymptoms ──────────────────────────────────────────────

describe('normalizeSymptoms', () => {
  it('accepts an array of valid keys', () => {
    assert.deepStrictEqual(
      normalizeSymptoms(['vomiting', 'diarrhea']),
      ['vomiting', 'diarrhea'],
    );
  });

  it('accepts a comma-separated string', () => {
    assert.deepStrictEqual(
      normalizeSymptoms('vomiting, diarrhea'),
      ['vomiting', 'diarrhea'],
    );
  });

  it('trims and filters empty slots from comma-separated input', () => {
    assert.deepStrictEqual(
      normalizeSymptoms('  vomiting  ,  , diarrhea '),
      ['vomiting', 'diarrhea'],
    );
  });

  it('dedupes while preserving first-seen order', () => {
    assert.deepStrictEqual(
      normalizeSymptoms(['diarrhea', 'vomiting', 'diarrhea']),
      ['diarrhea', 'vomiting'],
    );
  });

  it('rejects unknown symptom', () => {
    assert.strictEqual(normalizeSymptoms(['headache']), null);
  });

  it('rejects non-array, non-string input', () => {
    assert.strictEqual(normalizeSymptoms(42), null);
    assert.strictEqual(normalizeSymptoms(null), null);
    assert.strictEqual(normalizeSymptoms({}), null);
  });

  it('empty array is valid (no symptoms)', () => {
    assert.deepStrictEqual(normalizeSymptoms([]), []);
  });
});

// ── normalizeDiagnosis ─────────────────────────────────────────────

describe('normalizeDiagnosis', () => {
  it('accepts a valid diagnosis key', () => {
    assert.strictEqual(normalizeDiagnosis('norovirus'), 'norovirus');
  });

  it('null/undefined/empty become null', () => {
    assert.strictEqual(normalizeDiagnosis(null), null);
    assert.strictEqual(normalizeDiagnosis(undefined), null);
    assert.strictEqual(normalizeDiagnosis(''), null);
    assert.strictEqual(normalizeDiagnosis('  '), null);
  });

  it('"none" is treated as null', () => {
    assert.strictEqual(normalizeDiagnosis('none'), null);
    assert.strictEqual(normalizeDiagnosis('NONE'), null);
  });

  it('unknown string returns the sentinel "invalid"', () => {
    assert.strictEqual(normalizeDiagnosis('covid'), 'invalid');
  });

  it('non-string non-null returns "invalid"', () => {
    assert.strictEqual(normalizeDiagnosis(42), 'invalid');
    assert.strictEqual(normalizeDiagnosis({}), 'invalid');
  });

  it('SYMPTOMS and DIAGNOSES have no overlap (distinct vocabularies)', () => {
    const sym = new Set(SYMPTOMS);
    for (const d of DIAGNOSES) {
      assert.ok(!sym.has(d), `${d} leaked into SYMPTOMS`);
    }
  });
});

// ── validateSickReport ─────────────────────────────────────────────

describe('validateSickReport', () => {
  const base = {
    cook_id: 'alice',
    symptoms: ['vomiting'],
    diagnosed_illness: null,
    action: 'excluded',
    started_at: '2026-04-20T10:00:00Z',
  };

  it('accepts a clean report at required severity', () => {
    assert.deepStrictEqual(validateSickReport(base), { ok: true });
  });

  it('accepts higher severity than required (PIC judgment call)', () => {
    // restricted symptom, PIC escalates to excluded
    const r = validateSickReport({
      ...base,
      symptoms: ['infected_lesion'],
      action: 'excluded',
    });
    assert.deepStrictEqual(r, { ok: true });
  });

  it('REJECTS lower severity than FDA floor', () => {
    // vomiting requires excluded; PIC cannot downgrade to restricted
    const r = validateSickReport({ ...base, action: 'restricted' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /FDA requires/);
  });

  it('REJECTS "none" on any reportable symptom', () => {
    const r = validateSickReport({ ...base, symptoms: ['diarrhea'], action: 'none' });
    assert.strictEqual(r.ok, false);
  });

  it('REJECTS "monitor" on exclusion-required symptom', () => {
    const r = validateSickReport({ ...base, symptoms: ['jaundice'], action: 'monitor' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects unknown action string', () => {
    const r = validateSickReport({ ...base, action: 'fired' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /action/);
  });

  it('rejects missing cook_id', () => {
    const r = validateSickReport({ ...base, cook_id: '' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /cook_id/);
  });

  it('rejects whitespace-only cook_id', () => {
    const r = validateSickReport({ ...base, cook_id: '   ' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-string cook_id', () => {
    const r = validateSickReport({ ...base, cook_id: 42 });
    assert.strictEqual(r.ok, false);
  });

  it('rejects bad started_at', () => {
    const r = validateSickReport({ ...base, started_at: 'yesterday' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /started_at/);
  });

  it('rejects unknown symptom', () => {
    const r = validateSickReport({ ...base, symptoms: ['cough'] });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /symptom/i);
  });

  it('rejects unknown diagnosis', () => {
    const r = validateSickReport({ ...base, diagnosed_illness: 'flu' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /diagnosis/i);
  });

  it('rejects empty report (no symptoms, no diagnosis)', () => {
    const r = validateSickReport({ ...base, symptoms: [] });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /symptom|diagnosis/i);
  });

  it('accepts diagnosis-only report (no symptoms)', () => {
    const r = validateSickReport({
      ...base,
      symptoms: [],
      diagnosed_illness: 'norovirus',
      action: 'excluded',
    });
    assert.deepStrictEqual(r, { ok: true });
  });

  it('rejects diagnosis-only report at lower-than-excluded action', () => {
    const r = validateSickReport({
      ...base,
      symptoms: [],
      diagnosed_illness: 'shigella',
      action: 'restricted',
    });
    assert.strictEqual(r.ok, false);
  });
});
