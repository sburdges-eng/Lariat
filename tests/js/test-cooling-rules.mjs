#!/usr/bin/env node
// Tests for lib/cooling — two-stage cooling classifier (FDA §3-501.14).
// Run: node --test tests/js/test-cooling-rules.mjs
//
// The rule encoded: TCS food cooled from 135°F must reach 70°F in 2h
// (stage 1), then 41°F in 4h more (stage 2 — 6h total). A reading that
// closes a stage is either in_progress (next stage open) or breach (if
// the clock already blew). These tests pin down the edge cases so the
// classifier does not drift.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGE1_CEILING_F,
  STAGE2_CEILING_F,
  STAGE1_MAX_MINUTES,
  STAGE2_MAX_MINUTES,
  validateCoolingStart,
  classifyCoolingStage,
  scanOpenBatches,
} from '../../lib/cooling.ts';

// ── validateCoolingStart ───────────────────────────────────────────

describe('validateCoolingStart', () => {
  it('accepts a clean start with reading', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: 180,
    });
    assert.deepStrictEqual(r, { ok: true });
  });

  it('accepts a start with no reading (cook probes at stage 1)', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: null,
    });
    assert.deepStrictEqual(r, { ok: true });
  });

  it('accepts an undefined reading', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: undefined,
    });
    assert.deepStrictEqual(r, { ok: true });
  });

  it('rejects empty item name', () => {
    const r = validateCoolingStart({
      item: '',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: 180,
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /item/i);
  });

  it('rejects whitespace-only item', () => {
    const r = validateCoolingStart({
      item: '   ',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: 180,
    });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-string item', () => {
    const r = validateCoolingStart({
      item: 42,
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: 180,
    });
    assert.strictEqual(r.ok, false);
  });

  it('rejects malformed started_at', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: 'not a date',
      start_reading_f: 180,
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /ISO/i);
  });

  it('rejects started_at off the charts', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '',
      start_reading_f: 180,
    });
    assert.strictEqual(r.ok, false);
  });

  it('rejects absurd start reading', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: 9999,
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /probe|charts/i);
  });

  it('rejects NaN start reading', () => {
    const r = validateCoolingStart({
      item: 'Chili',
      started_at: '2026-04-20T14:00:00Z',
      start_reading_f: Number.NaN,
    });
    assert.strictEqual(r.ok, false);
  });
});

// ── classifyCoolingStage ───────────────────────────────────────────

const openStage1 = {
  started_at: '2026-04-20T14:00:00Z',
  stage1_at: null,
  stage1_reading_f: null,
  stage2_at: null,
  status: 'in_progress',
};
const openStage2 = {
  started_at: '2026-04-20T14:00:00Z',
  stage1_at: '2026-04-20T15:30:00Z',    // stage 1 closed at +90min
  stage1_reading_f: 68,
  stage2_at: null,
  status: 'in_progress',
};

describe('classifyCoolingStage — stage 1 in progress', () => {
  it('in range and within 2h closes stage 1 (in_progress waiting for stage 2)', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: STAGE1_CEILING_F - 2, // 68
      at: '2026-04-20T15:00:00Z',      // +60min
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.stage, 1);
    assert.strictEqual(r.status, 'in_progress');
    assert.strictEqual(r.breach_reason, null);
    assert.strictEqual(r.minutes_elapsed, 60);
  });

  it('edge: reading exactly at 70°F inclusive closes stage 1', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: STAGE1_CEILING_F, // 70
      at: '2026-04-20T15:00:00Z',
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.stage, 1);
    assert.strictEqual(r.status, 'in_progress');
  });

  it('70.5°F is NOT close enough — still too warm', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 70.5,
      at: '2026-04-20T15:00:00Z',
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'in_progress');
    assert.strictEqual(r.breach_reason, null);
  });

  it('still warm past 2h is a breach (stage1_over_2h)', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 90,
      at: '2026-04-20T16:30:00Z',   // +150min — past 2h
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'breach');
    assert.strictEqual(r.breach_reason, 'stage1_over_2h');
  });

  it('cold but late is ALSO a breach — closing stage 1 past 2h still breaches', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 65,
      at: '2026-04-20T16:30:00Z',   // +150min
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'breach');
    assert.strictEqual(r.breach_reason, 'stage1_over_2h');
  });

  it('edge: exactly at 120min is NOT yet a breach', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 70,
      at: '2026-04-20T16:00:00Z', // +120min exactly
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.minutes_elapsed, STAGE1_MAX_MINUTES);
    assert.strictEqual(r.status, 'in_progress');
    assert.strictEqual(r.breach_reason, null);
  });

  it('121min is over — breach', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 70,
      at: '2026-04-20T16:01:00Z', // +121min
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'breach');
    assert.strictEqual(r.breach_reason, 'stage1_over_2h');
  });

  it('negative elapsed (reading before start) is a validation error', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 65,
      at: '2026-04-20T13:00:00Z',  // before started_at
    });
    assert.strictEqual(r.ok, false);
  });

  it('bad reading rejected as validation error, not breach', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: Number.NaN,
      at: '2026-04-20T15:00:00Z',
    });
    assert.strictEqual(r.ok, false);
  });

  it('non-ISO timestamp rejected', () => {
    const r = classifyCoolingStage({
      row: openStage1,
      reading_f: 65,
      at: 'yesterday',
    });
    assert.strictEqual(r.ok, false);
  });
});

describe('classifyCoolingStage — stage 2 in progress', () => {
  it('≤41°F within 4h closes the batch OK', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: STAGE2_CEILING_F,  // 41
      at: '2026-04-20T19:00:00Z',   // stage1_at + 3h30m
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.stage, 2);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.breach_reason, null);
  });

  it('41.1°F does NOT close stage 2 — still in progress', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: 41.1,
      at: '2026-04-20T17:00:00Z',
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'in_progress');
  });

  it('still warm past 4h from stage1 is a stage2_over_4h breach', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: 60,
      at: '2026-04-20T20:00:00Z',   // stage1_at + 4h30m
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'breach');
    assert.strictEqual(r.breach_reason, 'stage2_over_4h');
  });

  it('cold but late is ALSO a breach', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: 38,
      at: '2026-04-20T20:00:00Z',
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.status, 'breach');
    assert.strictEqual(r.breach_reason, 'stage2_over_4h');
  });

  it('edge: exactly at stage1_at + 240min is not yet a breach', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: 41,
      at: '2026-04-20T19:30:00Z',   // stage1_at + 4h exactly
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.ok === true);
    assert.strictEqual(r.minutes_elapsed, STAGE2_MAX_MINUTES);
    assert.strictEqual(r.status, 'ok');
  });

  it('reading before stage1_at rejected', () => {
    const r = classifyCoolingStage({
      row: openStage2,
      reading_f: 40,
      at: '2026-04-20T15:00:00Z',
    });
    assert.strictEqual(r.ok, false);
  });
});

describe('classifyCoolingStage — already-closed rows', () => {
  it('closed batch rejects new readings (ok)', () => {
    const r = classifyCoolingStage({
      row: { ...openStage2, status: 'ok', stage2_at: '2026-04-20T19:00:00Z' },
      reading_f: 40,
      at: '2026-04-20T19:30:00Z',
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.ok === false);
    assert.match(r.reason, /closed/i);
  });

  it('breached batch rejects new readings', () => {
    const r = classifyCoolingStage({
      row: { ...openStage2, status: 'breach', stage2_at: null },
      reading_f: 40,
      at: '2026-04-20T19:30:00Z',
    });
    assert.strictEqual(r.ok, false);
  });

  it('discarded batch rejects new readings', () => {
    const r = classifyCoolingStage({
      row: { ...openStage2, status: 'discarded' },
      reading_f: 40,
      at: '2026-04-20T19:30:00Z',
    });
    assert.strictEqual(r.ok, false);
  });
});

// ── scanOpenBatches ─────────────────────────────────────────────────

describe('scanOpenBatches', () => {
  const now = Date.parse('2026-04-20T16:00:00Z');

  it('stage-1 batch started 1h ago has 60min remaining', () => {
    const rows = [
      {
        id: 1,
        item: 'Chili',
        started_at: '2026-04-20T15:00:00Z',
        stage1_at: null,
        status: 'in_progress',
      },
    ];
    const out = scanOpenBatches(rows, now);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].stage, 1);
    assert.strictEqual(out[0].minutes_remaining, 60);
    assert.strictEqual(out[0].breached, false);
  });

  it('stage-1 batch past 2h is breached', () => {
    const rows = [
      {
        id: 2,
        item: 'Chili',
        started_at: '2026-04-20T13:30:00Z',   // 2.5h ago
        stage1_at: null,
        status: 'in_progress',
      },
    ];
    const out = scanOpenBatches(rows, now);
    assert.strictEqual(out[0].breached, true);
    assert.ok(out[0].minutes_remaining < 0);
  });

  it('stage-2 batch with recent stage1 shows stage-2 budget', () => {
    const rows = [
      {
        id: 3,
        item: 'Chili',
        started_at: '2026-04-20T13:00:00Z',
        stage1_at: '2026-04-20T14:00:00Z',    // stage 1 closed 2h ago
        status: 'in_progress',
      },
    ];
    const out = scanOpenBatches(rows, now);
    assert.strictEqual(out[0].stage, 2);
    assert.strictEqual(out[0].minutes_remaining, STAGE2_MAX_MINUTES - 120);
    assert.strictEqual(out[0].breached, false);
  });

  it('skips rows not in_progress', () => {
    const rows = [
      { id: 1, item: 'Chili', started_at: '2026-04-20T15:00:00Z', stage1_at: null, status: 'ok' },
      { id: 2, item: 'Rice', started_at: '2026-04-20T15:00:00Z', stage1_at: null, status: 'breach' },
      { id: 3, item: 'Beans', started_at: '2026-04-20T15:00:00Z', stage1_at: null, status: 'discarded' },
    ];
    const out = scanOpenBatches(rows, now);
    assert.strictEqual(out.length, 0);
  });

  it('skips rows with unparseable started_at', () => {
    const rows = [
      { id: 1, item: 'Chili', started_at: 'junk', stage1_at: null, status: 'in_progress' },
    ];
    const out = scanOpenBatches(rows, now);
    assert.strictEqual(out.length, 0);
  });

  it('returns empty on empty input', () => {
    assert.deepStrictEqual(scanOpenBatches([], now), []);
  });
});
