#!/usr/bin/env node
// Tests for lib/dateMarks — 7-day date marking for RTE TCS food.
// Run: node --test tests/js/test-date-mark-rules.mjs
//
// FDA §3-501.17: food held > 24h at ≤ 41°F must be marked with a
// discard date ≤ 7 days from preparation. Day of prep = day 1, so the
// window is 6 additional days. Pinning down the UTC-safe math here
// keeps the compliance date stable across DST transitions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOLDING_DAYS_AFTER_PREP,
  computeDiscardOn,
  validateDateMarkCreate,
  scanExpiringBatches,
} from '../../lib/dateMarks.ts';

describe('computeDiscardOn', () => {
  it('sets discard exactly 6 days past prep (day 1 = prep day)', () => {
    assert.strictEqual(computeDiscardOn('2026-04-20'), '2026-04-26');
  });

  it('day-8 discard math — Monday prep discards Sunday', () => {
    // 2026-04-20 is a Monday. FDA wants toss first thing Monday Apr 27
    // (day 8), but the `discard_on` is the last legal day = Apr 26 (Sun).
    assert.strictEqual(computeDiscardOn('2026-04-20'), '2026-04-26');
  });

  it('handles month rollover', () => {
    assert.strictEqual(computeDiscardOn('2026-04-28'), '2026-05-04');
  });

  it('handles year rollover', () => {
    assert.strictEqual(computeDiscardOn('2026-12-28'), '2027-01-03');
  });

  it('handles leap day prep (Feb 29 → Mar 6)', () => {
    assert.strictEqual(computeDiscardOn('2024-02-29'), '2024-03-06');
  });

  it('is DST-stable across US spring-forward (prep Sat before, discard Fri after)', () => {
    // US DST 2026 starts 2026-03-08. Prep 2026-03-07 → +6 days = 2026-03-13.
    // A naive local-time addDays could return Mar 12 or Mar 14 depending on
    // host timezone. UTC math guarantees Mar 13.
    assert.strictEqual(computeDiscardOn('2026-03-07'), '2026-03-13');
  });

  it('is DST-stable across US fall-back (prep Sat before, discard Fri after)', () => {
    // US DST 2026 ends 2026-11-01.
    assert.strictEqual(computeDiscardOn('2026-10-31'), '2026-11-06');
  });

  it('throws on malformed date', () => {
    assert.throws(() => computeDiscardOn('04/20/2026'), /Invalid prepared_on/);
  });

  it('throws on invalid calendar date (Feb 30)', () => {
    assert.throws(() => computeDiscardOn('2026-02-30'), /Invalid prepared_on/);
  });

  it('throws on non-string', () => {
    assert.throws(() => computeDiscardOn(20260420), /Invalid prepared_on/);
    assert.throws(() => computeDiscardOn(null), /Invalid prepared_on/);
    assert.throws(() => computeDiscardOn(undefined), /Invalid prepared_on/);
  });

  it('exposes HOLDING_DAYS_AFTER_PREP = 6', () => {
    assert.strictEqual(HOLDING_DAYS_AFTER_PREP, 6);
  });
});

describe('validateDateMarkCreate', () => {
  it('accepts a clean input', () => {
    assert.deepStrictEqual(
      validateDateMarkCreate({ item: 'Roasted chicken', prepared_on: '2026-04-20' }),
      { ok: true },
    );
  });

  it('rejects empty item', () => {
    const r = validateDateMarkCreate({ item: '', prepared_on: '2026-04-20' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /item/i);
  });

  it('rejects whitespace-only item', () => {
    const r = validateDateMarkCreate({ item: '  ', prepared_on: '2026-04-20' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects missing prepared_on', () => {
    const r = validateDateMarkCreate({ item: 'Stock' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /YYYY-MM-DD/);
  });

  it('rejects malformed prepared_on', () => {
    const r = validateDateMarkCreate({ item: 'Stock', prepared_on: '4/20/26' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects invalid calendar date', () => {
    const r = validateDateMarkCreate({ item: 'Stock', prepared_on: '2026-13-01' });
    assert.strictEqual(r.ok, false);
  });
});

describe('scanExpiringBatches', () => {
  const today = '2026-04-20';

  it('classifies rows by days-until-discard', () => {
    const rows = [
      { id: 1, item: 'Chicken', prepared_on: '2026-04-14', discard_on: '2026-04-20', discarded_at: null },
      { id: 2, item: 'Sauce',   prepared_on: '2026-04-12', discard_on: '2026-04-18', discarded_at: null },
      { id: 3, item: 'Fresh',   prepared_on: '2026-04-19', discard_on: '2026-04-25', discarded_at: null },
    ];
    const out = scanExpiringBatches(rows, today);
    // sorted by days_until_discard asc → expired (-2), due_today (0), ok (5)
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].id, 2);
    assert.strictEqual(out[0].status, 'expired');
    assert.strictEqual(out[0].days_until_discard, -2);
    assert.strictEqual(out[1].id, 1);
    assert.strictEqual(out[1].status, 'due_today');
    assert.strictEqual(out[1].days_until_discard, 0);
    assert.strictEqual(out[2].id, 3);
    assert.strictEqual(out[2].status, 'ok');
    assert.strictEqual(out[2].days_until_discard, 5);
  });

  it('filters out already-discarded rows', () => {
    const rows = [
      { id: 1, item: 'Used up', prepared_on: '2026-04-14', discard_on: '2026-04-20', discarded_at: '2026-04-18T09:00:00Z' },
      { id: 2, item: 'Open',    prepared_on: '2026-04-14', discard_on: '2026-04-20', discarded_at: null },
    ];
    const out = scanExpiringBatches(rows, today);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 2);
  });

  it('skips rows with malformed discard_on silently', () => {
    const rows = [
      { id: 1, item: 'Bad',   prepared_on: '2026-04-14', discard_on: 'nope', discarded_at: null },
      { id: 2, item: 'Good',  prepared_on: '2026-04-14', discard_on: '2026-04-20', discarded_at: null },
    ];
    const out = scanExpiringBatches(rows, today);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 2);
  });

  it('returns empty on empty input', () => {
    assert.deepStrictEqual(scanExpiringBatches([], today), []);
  });

  it('throws on malformed today', () => {
    assert.throws(() => scanExpiringBatches([], 'not-a-date'), /Invalid today/);
  });

  it('sort puts most-past-due first', () => {
    const rows = [
      { id: 1, item: 'Yesterday',    prepared_on: '2026-04-13', discard_on: '2026-04-19', discarded_at: null },
      { id: 2, item: 'Three days ago', prepared_on: '2026-04-11', discard_on: '2026-04-17', discarded_at: null },
      { id: 3, item: 'Two days ago', prepared_on: '2026-04-12', discard_on: '2026-04-18', discarded_at: null },
    ];
    const out = scanExpiringBatches(rows, today);
    assert.deepStrictEqual(
      out.map((r) => r.id),
      [2, 3, 1],
    );
  });

  it('days_until_discard is DST-stable (spring forward in window)', () => {
    // Prep Mar 1, discard Mar 7 (well before DST). today = Mar 10 (after DST).
    // days_until should be -3 regardless of DST.
    const rows = [
      { id: 1, item: 'X', prepared_on: '2026-03-01', discard_on: '2026-03-07', discarded_at: null },
    ];
    const out = scanExpiringBatches(rows, '2026-03-10');
    assert.strictEqual(out[0].days_until_discard, -3);
  });

  it('skips rows where discarded_at is non-null (already-tossed batch should not appear)', () => {
    // Regression pin for the discarded_at skip-path. A flipped filter
    // (`if (r.discarded_at === null) continue`) would silently surface
    // already-tossed batches in the inspector-facing date-mark roll-up.
    const now = '2026-05-09';
    const rows = [
      // Row A: prepared 6 days ago, NOT discarded — should appear (sanity).
      { id: 1, item: 'Diced onions',  prepared_on: '2026-05-03', discard_on: '2026-05-09', discarded_at: null },
      // Row B: prepared 6 days ago, ALREADY DISCARDED — must NOT appear.
      { id: 2, item: 'Pico de gallo', prepared_on: '2026-05-03', discard_on: '2026-05-09', discarded_at: '2026-05-04T15:30:00Z' },
    ];
    const out = scanExpiringBatches(rows, now);
    // Row A appears; Row B is filtered.
    assert.strictEqual(out.length, 1, 'only the non-discarded row should appear');
    assert.strictEqual(out[0].id, 1);
    // Strong guard: assert the discarded row is NOT in output by id, so a
    // future field addition can't mask the regression behind a length match.
    assert.ok(
      !out.some((r) => r.id === 2),
      'discarded row must not appear in output regardless of expiry status',
    );
  });
});
