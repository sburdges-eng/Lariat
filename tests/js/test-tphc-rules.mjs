#!/usr/bin/env node
// Tests for lib/tphc — Time as Public Health Control (FDA §3-501.19).
// Run: node --test tests/js/test-tphc-rules.mjs
//
// Hot food: 4 hours without temp control.
// Cold food: 6 hours without temp control.
// Cutoff is computed once at start and never rewritten.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TPHC_HOT_HOURS,
  TPHC_COLD_HOURS,
  TPHC_WARNING_MINUTES,
  TPHC_KINDS,
  TPHC_DISCARD_REASONS,
  computeCutoffAt,
  hoursFor,
  isTphcKind,
  isTphcDiscardReason,
  validateTphcCreate,
  scanActiveTphc,
} from '../../lib/tphc.ts';

describe('TPHC constants', () => {
  it('hot = 4 hours (§3-501.19 (B))', () => {
    assert.strictEqual(TPHC_HOT_HOURS, 4);
  });

  it('cold = 6 hours (§3-501.19 (A))', () => {
    assert.strictEqual(TPHC_COLD_HOURS, 6);
  });

  it('warning band defaults to 30 minutes', () => {
    assert.strictEqual(TPHC_WARNING_MINUTES, 30);
  });

  it('kinds cover hot + cold paths', () => {
    assert.deepStrictEqual(Array.from(TPHC_KINDS), ['hot_time_only', 'cold_time_only']);
  });

  it('discard reasons pin a fixed enum', () => {
    assert.deepStrictEqual(
      Array.from(TPHC_DISCARD_REASONS),
      ['reached_cutoff', 'consumed', 'quality', 'contamination'],
    );
  });
});

describe('hoursFor', () => {
  it('hot → 4', () => assert.strictEqual(hoursFor('hot_time_only'), 4));
  it('cold → 6', () => assert.strictEqual(hoursFor('cold_time_only'), 6));
  it('unknown kind throws', () => {
    assert.throws(() => hoursFor(/** @type any */('warm_time_only')));
  });
});

describe('computeCutoffAt', () => {
  it('hot food adds exactly 4 hours', () => {
    assert.strictEqual(
      computeCutoffAt('2026-04-24T12:00:00Z', 'hot_time_only'),
      '2026-04-24T16:00:00.000Z',
    );
  });

  it('cold food adds exactly 6 hours', () => {
    assert.strictEqual(
      computeCutoffAt('2026-04-24T10:00:00Z', 'cold_time_only'),
      '2026-04-24T16:00:00.000Z',
    );
  });

  it('rolls across midnight without DST drift', () => {
    // 2026-03-08 is US spring-forward. Compute in UTC so 4h stays 4h
    // regardless of wall-clock.
    assert.strictEqual(
      computeCutoffAt('2026-03-08T08:30:00Z', 'hot_time_only'),
      '2026-03-08T12:30:00.000Z',
    );
  });

  it('rejects bad timestamp', () => {
    assert.throws(() => computeCutoffAt('not-a-time', 'hot_time_only'));
  });

  it('rejects date-only input (needs time component)', () => {
    assert.throws(() => computeCutoffAt('2026-04-24', 'hot_time_only'));
  });
});

describe('validateTphcCreate', () => {
  const good = {
    item: 'pizza topping',
    started_at: '2026-04-24T12:00:00Z',
    kind: 'hot_time_only',
  };

  it('accepts a well-formed input', () => {
    assert.deepStrictEqual(validateTphcCreate(good), { ok: true });
  });

  it('rejects empty item', () => {
    const r = validateTphcCreate({ ...good, item: '  ' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects missing started_at', () => {
    const r = validateTphcCreate({ ...good, started_at: undefined });
    assert.strictEqual(r.ok, false);
  });

  it('rejects unknown kind', () => {
    const r = validateTphcCreate({ ...good, kind: 'mild_time_only' });
    assert.strictEqual(r.ok, false);
  });
});

describe('type guards', () => {
  it('isTphcKind gates exactly the enum', () => {
    assert.strictEqual(isTphcKind('hot_time_only'), true);
    assert.strictEqual(isTphcKind('cold_time_only'), true);
    assert.strictEqual(isTphcKind('warm_time_only'), false);
    assert.strictEqual(isTphcKind(null), false);
  });

  it('isTphcDiscardReason gates exactly the enum', () => {
    assert.strictEqual(isTphcDiscardReason('reached_cutoff'), true);
    assert.strictEqual(isTphcDiscardReason('lost_track'), false);
  });
});

describe('scanActiveTphc', () => {
  const now = '2026-04-24T14:00:00Z';

  it('marks past-cutoff rows expired', () => {
    const rows = [
      {
        id: 1,
        item: 'pizza topping',
        station_id: null,
        started_at: '2026-04-24T09:00:00Z',
        cutoff_at: '2026-04-24T13:00:00Z',
        discarded_at: null,
      },
    ];
    const s = scanActiveTphc(rows, now);
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].status, 'expired');
    assert.ok(s[0].minutes_until_cutoff < 0);
  });

  it('marks within-warning-band as warning', () => {
    const rows = [
      {
        id: 2,
        item: 'cut tomato',
        station_id: 'salad',
        started_at: '2026-04-24T08:15:00Z',
        // 6h cold → cutoff 14:15; 15 min left at 14:00 now.
        cutoff_at: '2026-04-24T14:15:00Z',
        discarded_at: null,
      },
    ];
    const s = scanActiveTphc(rows, now);
    assert.strictEqual(s[0].status, 'warning');
    assert.strictEqual(s[0].minutes_until_cutoff, 15);
  });

  it('marks comfortable-window as ok', () => {
    const rows = [
      {
        id: 3,
        item: 'stuffed pepper',
        station_id: 'grill',
        started_at: '2026-04-24T13:30:00Z',
        cutoff_at: '2026-04-24T17:30:00Z',
        discarded_at: null,
      },
    ];
    const s = scanActiveTphc(rows, now);
    assert.strictEqual(s[0].status, 'ok');
    assert.strictEqual(s[0].minutes_until_cutoff, 210);
  });

  it('drops discarded rows', () => {
    const rows = [
      {
        id: 4,
        item: 'tossed batch',
        station_id: null,
        started_at: '2026-04-24T10:00:00Z',
        cutoff_at: '2026-04-24T14:00:00Z',
        discarded_at: '2026-04-24T13:45:00Z',
      },
    ];
    assert.strictEqual(scanActiveTphc(rows, now).length, 0);
  });

  it('sorts most-past-due first, then nearest cutoff', () => {
    const rows = [
      { id: 1, item: 'A', station_id: null, started_at: '2026-04-24T13:30:00Z', cutoff_at: '2026-04-24T17:30:00Z', discarded_at: null },
      { id: 2, item: 'B', station_id: null, started_at: '2026-04-24T08:00:00Z', cutoff_at: '2026-04-24T12:00:00Z', discarded_at: null },
      { id: 3, item: 'C', station_id: null, started_at: '2026-04-24T08:15:00Z', cutoff_at: '2026-04-24T14:15:00Z', discarded_at: null },
    ];
    const s = scanActiveTphc(rows, now);
    assert.deepStrictEqual(s.map((r) => r.id), [2, 3, 1]);
  });

  it('rejects malformed now', () => {
    assert.throws(() => scanActiveTphc([], 'not-a-time'));
  });

  it('exactly TPHC_WARNING_MINUTES from cutoff is warning (boundary inclusive)', () => {
    // Pin the lower edge of the warning band: at exactly TPHC_WARNING_MINUTES
    // remaining, status must be 'warning'. A future regression that flipped
    // the comparison from `<=` to `<` would land silently without this test.
    const refMs = new Date(now).getTime();
    const cutoff_at = new Date(refMs + TPHC_WARNING_MINUTES * 60 * 1000).toISOString();
    const rows = [
      {
        id: 10,
        item: 'edge tomato',
        station_id: 'salad',
        started_at: '2026-04-24T08:00:00Z',
        cutoff_at,
        discarded_at: null,
      },
    ];
    const s = scanActiveTphc(rows, now);
    assert.strictEqual(s[0].status, 'warning');
    assert.strictEqual(s[0].minutes_until_cutoff, TPHC_WARNING_MINUTES);
  });

  it('TPHC_WARNING_MINUTES + 1 from cutoff is ok (boundary exclusive on the upper side)', () => {
    // Pin the upper edge: one minute beyond the warning band must be 'ok'.
    const refMs = new Date(now).getTime();
    const cutoff_at = new Date(refMs + (TPHC_WARNING_MINUTES + 1) * 60 * 1000).toISOString();
    const rows = [
      {
        id: 11,
        item: 'edge pepper',
        station_id: 'grill',
        started_at: '2026-04-24T08:00:00Z',
        cutoff_at,
        discarded_at: null,
      },
    ];
    const s = scanActiveTphc(rows, now);
    assert.strictEqual(s[0].status, 'ok');
    assert.strictEqual(s[0].minutes_until_cutoff, TPHC_WARNING_MINUTES + 1);
  });
});
