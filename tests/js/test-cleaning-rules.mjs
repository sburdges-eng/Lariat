#!/usr/bin/env node
// Rule-module tests for lib/cleaning.ts.
//
// Covers the pure-decision shape paired with POST /api/cleaning:
// required-field guards, type checks, range bounds, and the FDA/CO
// citation constants the rule module is supposed to be the single
// source of truth for. The route-integration tests live under
// test-cleaning-schedule-api.mjs (the schedule sibling) — this file
// is rule-only.
//
// Run: node --test tests/js/test-cleaning-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLEANING_CITATION,
  CLEANING_FREQUENCY_CITATION,
  NOTES_MAX_LEN,
  AREA_MAX_LEN,
  TASK_MAX_LEN,
  validateCleaningLog,
} from '../../lib/cleaning.ts';

// ── Citations and constants ───────────────────────────────────────

describe('cleaning rule constants — single source of truth', () => {
  it('CLEANING_CITATION points to FDA §4-602.11 (food-contact surfaces)', () => {
    assert.match(CLEANING_CITATION, /§4-602\.11/);
  });

  it('CLEANING_FREQUENCY_CITATION points to FDA §4-602.13 (non-food-contact surfaces)', () => {
    assert.match(CLEANING_FREQUENCY_CITATION, /§4-602\.13/);
  });

  it('field length bounds are positive integers', () => {
    assert.ok(Number.isInteger(NOTES_MAX_LEN) && NOTES_MAX_LEN > 0);
    assert.ok(Number.isInteger(AREA_MAX_LEN) && AREA_MAX_LEN > 0);
    assert.ok(Number.isInteger(TASK_MAX_LEN) && TASK_MAX_LEN > 0);
  });
});

// ── Body-shape guards (null-object guard, post-PR-19 pattern) ─────

describe('validateCleaningLog — body shape', () => {
  it('rejects null body', () => {
    const r = validateCleaningLog(null);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /object/);
  });

  it('rejects undefined body', () => {
    const r = validateCleaningLog(undefined);
    assert.strictEqual(r.ok, false);
  });

  it('rejects array body', () => {
    const r = validateCleaningLog([]);
    assert.strictEqual(r.ok, false);
  });

  it('rejects scalar body', () => {
    assert.strictEqual(validateCleaningLog('hello').ok, false);
    assert.strictEqual(validateCleaningLog(42).ok, false);
    assert.strictEqual(validateCleaningLog(true).ok, false);
  });
});

// ── Required: item or task ────────────────────────────────────────

describe('validateCleaningLog — task identifier', () => {
  it('accepts a body with `item` set', () => {
    const r = validateCleaningLog({ item: 'Walk-in floor', area: 'Walk-in' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts a body with `task` set (alternate name the route also reads)', () => {
    const r = validateCleaningLog({ task: 'Sweep & mop', area: 'Walk-in' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects when both item and task are missing', () => {
    const r = validateCleaningLog({ area: 'Walk-in' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /item|task/);
  });

  it('rejects when item and task are both empty strings', () => {
    const r = validateCleaningLog({ item: '', task: '' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects when item and task are whitespace-only', () => {
    const r = validateCleaningLog({ item: '   ', task: '\t\n' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects when item is a number (no coercion)', () => {
    const r = validateCleaningLog({ item: 42 });
    assert.strictEqual(r.ok, false);
  });

  it('rejects task longer than TASK_MAX_LEN', () => {
    const r = validateCleaningLog({ task: 'x'.repeat(TASK_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /task|length/i);
  });

  it('accepts task at exactly TASK_MAX_LEN (inclusive bound)', () => {
    const r = validateCleaningLog({ task: 'x'.repeat(TASK_MAX_LEN) });
    assert.strictEqual(r.ok, true);
  });
});

// ── area ──────────────────────────────────────────────────────────

describe('validateCleaningLog — area', () => {
  it('accepts a missing area (route falls back to "General")', () => {
    const r = validateCleaningLog({ task: 'Wipe down' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects non-string area', () => {
    const r = validateCleaningLog({ task: 'Wipe down', area: 99 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /area/);
  });

  it('rejects area at AREA_MAX_LEN + 1', () => {
    const r = validateCleaningLog({ task: 'Wipe', area: 'a'.repeat(AREA_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /area|length/i);
  });

  it('accepts area at exactly AREA_MAX_LEN (inclusive)', () => {
    const r = validateCleaningLog({ task: 'Wipe', area: 'a'.repeat(AREA_MAX_LEN) });
    assert.strictEqual(r.ok, true);
  });
});

// ── notes ─────────────────────────────────────────────────────────

describe('validateCleaningLog — notes', () => {
  it('accepts missing notes', () => {
    const r = validateCleaningLog({ task: 'Wipe' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts null notes', () => {
    const r = validateCleaningLog({ task: 'Wipe', notes: null });
    assert.strictEqual(r.ok, true);
  });

  it('accepts an empty string notes (the route strips/clips)', () => {
    const r = validateCleaningLog({ task: 'Wipe', notes: '' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects notes that are not a string', () => {
    const r = validateCleaningLog({ task: 'Wipe', notes: 17 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /notes/);
  });

  it('rejects notes longer than NOTES_MAX_LEN', () => {
    const r = validateCleaningLog({ task: 'Wipe', notes: 'n'.repeat(NOTES_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /notes|length/i);
  });

  it('accepts notes at exactly NOTES_MAX_LEN (inclusive)', () => {
    const r = validateCleaningLog({ task: 'Wipe', notes: 'n'.repeat(NOTES_MAX_LEN) });
    assert.strictEqual(r.ok, true);
  });
});

// ── completed_at / shift_date ─────────────────────────────────────

describe('validateCleaningLog — timestamps', () => {
  it('accepts missing completed_at (route fills with now())', () => {
    const r = validateCleaningLog({ task: 'Wipe' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts an ISO-8601 completed_at', () => {
    const r = validateCleaningLog({ task: 'Wipe', completed_at: '2026-04-29T10:30:00Z' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects a non-string completed_at', () => {
    const r = validateCleaningLog({ task: 'Wipe', completed_at: 123 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /completed_at/);
  });

  it('rejects an unparseable completed_at', () => {
    const r = validateCleaningLog({ task: 'Wipe', completed_at: 'not-a-date' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /completed_at/);
  });

  it('accepts shift_date in YYYY-MM-DD form', () => {
    const r = validateCleaningLog({ task: 'Wipe', shift_date: '2026-04-29' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects shift_date not matching YYYY-MM-DD', () => {
    const r = validateCleaningLog({ task: 'Wipe', shift_date: '04/29/2026' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /shift_date/);
  });
});

// ── cook_id / verified_by_cook_id / schedule_id ───────────────────

describe('validateCleaningLog — actor + schedule references', () => {
  it('accepts missing cook fields (route allows null)', () => {
    const r = validateCleaningLog({ task: 'Wipe' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects non-string cook_id', () => {
    const r = validateCleaningLog({ task: 'Wipe', cook_id: 99 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /cook_id/);
  });

  it('rejects non-string verified_by_cook_id', () => {
    const r = validateCleaningLog({ task: 'Wipe', verified_by_cook_id: { id: 1 } });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /verified_by_cook_id/);
  });

  it('accepts schedule_id as a positive integer', () => {
    const r = validateCleaningLog({ task: 'Wipe', schedule_id: 7 });
    assert.strictEqual(r.ok, true);
  });

  it('accepts schedule_id as a string of digits (route Number()s it)', () => {
    const r = validateCleaningLog({ task: 'Wipe', schedule_id: '7' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects schedule_id zero or negative', () => {
    assert.strictEqual(validateCleaningLog({ task: 'Wipe', schedule_id: 0 }).ok, false);
    assert.strictEqual(validateCleaningLog({ task: 'Wipe', schedule_id: -1 }).ok, false);
  });

  it('rejects schedule_id NaN-producing string', () => {
    const r = validateCleaningLog({ task: 'Wipe', schedule_id: 'abc' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /schedule_id/);
  });
});

// ── Normalized value on success ───────────────────────────────────

describe('validateCleaningLog — normalized value', () => {
  it('returns a normalized snapshot of trimmed strings on ok', () => {
    const r = validateCleaningLog({
      item: '  Walk-in floor  ',
      area: '  Walk-in  ',
      notes: '  done  ',
      task: undefined,
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.value, 'expected r.value on ok');
    assert.strictEqual(r.value.task, 'Walk-in floor');
    assert.strictEqual(r.value.area, 'Walk-in');
    assert.strictEqual(r.value.notes, 'done');
  });

  it('value.task falls back to `task` field when item is absent', () => {
    const r = validateCleaningLog({ task: 'Sweep' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.task, 'Sweep');
  });

  it('value.notes is null when notes is absent', () => {
    const r = validateCleaningLog({ task: 'Sweep' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.notes, null);
  });
});
