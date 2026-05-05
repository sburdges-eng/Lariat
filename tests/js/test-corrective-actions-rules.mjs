#!/usr/bin/env node
// Tests for lib/correctiveActions — F13 (FDA 2022 §8-405.11).
// Run: node --experimental-strip-types --test tests/js/test-corrective-actions-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORRECTIVE_ACTION_CITATION,
  mergeCorrectiveActions,
} from '../../lib/correctiveActions.ts';

const TEMP_ROW_1 = {
  id: 11,
  shift_date: '2026-05-05',
  point_id: 'walk_in_cooler',
  corrective_action: 'Adjusted thermostat; reading dropped to 39F in 20m',
  cook_id: 'alice',
  created_at: '2026-05-05T10:00:00.000Z',
};

const TEMP_ROW_2 = {
  id: 12,
  shift_date: '2026-05-05',
  point_id: 'hot_hold',
  corrective_action: 'Re-fired soup to 165F',
  cook_id: 'bob',
  created_at: '2026-05-05T11:30:00.000Z',
};

const LINE_ROW_1 = {
  id: 21,
  shift_date: '2026-05-05',
  station_id: 'fryer',
  item: 'oil quality',
  note: 'Filtered + topped up oil',
  cook_id: 'cara',
  created_at: '2026-05-05T09:30:00.000Z',
};

const LINE_ROW_2 = {
  id: 22,
  shift_date: '2026-05-05',
  station_id: 'cold-line',
  item: 'lettuce par',
  note: 'Pulled from walk-in, re-stocked',
  cook_id: null,
  created_at: '2026-05-05T12:00:00.000Z',
};

describe('mergeCorrectiveActions', () => {
  it('returns [] for empty inputs', () => {
    assert.deepStrictEqual(mergeCorrectiveActions([], []), []);
  });

  it('handles undefined inputs defensively', () => {
    // @ts-expect-error - intentional: caller passes undefined when no rows
    assert.deepStrictEqual(mergeCorrectiveActions(undefined, undefined), []);
  });

  it('one temp_log row only — shape', () => {
    const out = mergeCorrectiveActions([TEMP_ROW_1], []);
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0], {
      source: 'temp_log',
      entry_id: 11,
      shift_date: '2026-05-05',
      station_id: null,
      subject: 'walk_in_cooler',
      note: 'Adjusted thermostat; reading dropped to 39F in 20m',
      cook_id: 'alice',
      created_at: '2026-05-05T10:00:00.000Z',
    });
  });

  it('one line_check row only — subject combines station_id + item', () => {
    const out = mergeCorrectiveActions([], [LINE_ROW_1]);
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0], {
      source: 'line_check',
      entry_id: 21,
      shift_date: '2026-05-05',
      station_id: 'fryer',
      subject: 'fryer: oil quality',
      note: 'Filtered + topped up oil',
      cook_id: 'cara',
      created_at: '2026-05-05T09:30:00.000Z',
    });
  });

  it('mixed sources sort by created_at DESC (newest first)', () => {
    const out = mergeCorrectiveActions(
      [TEMP_ROW_1, TEMP_ROW_2],
      [LINE_ROW_1, LINE_ROW_2],
    );
    assert.strictEqual(out.length, 4);
    // Order should be 12:00 (LINE_2), 11:30 (TEMP_2), 10:00 (TEMP_1), 09:30 (LINE_1)
    assert.strictEqual(out[0].entry_id, 22);
    assert.strictEqual(out[0].source, 'line_check');
    assert.strictEqual(out[1].entry_id, 12);
    assert.strictEqual(out[1].source, 'temp_log');
    assert.strictEqual(out[2].entry_id, 11);
    assert.strictEqual(out[3].entry_id, 21);
  });

  it('null cook_id is preserved as null (not undefined)', () => {
    const out = mergeCorrectiveActions([], [LINE_ROW_2]);
    assert.strictEqual(out[0].cook_id, null);
  });

  it('stable order on equal created_at: temp_log before line_check, then entry_id desc', () => {
    const t = { ...TEMP_ROW_1, created_at: '2026-05-05T10:00:00.000Z' };
    const l = { ...LINE_ROW_1, created_at: '2026-05-05T10:00:00.000Z' };
    const out = mergeCorrectiveActions([t], [l]);
    // Equal timestamps — secondary sort puts 'line_check' (l) AFTER
    // 'temp_log' (t) because 'line_check' < 'temp_log' lexically and
    // we sort with a < b → -1 (a first).
    assert.strictEqual(out[0].source, 'line_check');
    assert.strictEqual(out[1].source, 'temp_log');
  });
});

describe('citation constant', () => {
  it('non-empty and references FDA §8-405.11', () => {
    assert.match(CORRECTIVE_ACTION_CITATION, /8-405\.11/);
  });
});
