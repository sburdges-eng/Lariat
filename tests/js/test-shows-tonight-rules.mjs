#!/usr/bin/env node
// Pure-rule tests for lib/showsTonight.ts.
// Run: node --experimental-strip-types --test tests/js/test-shows-tonight-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const m = await import('../../lib/showsTonight.ts');
const {
  resolveTonightShow,
  findPreviousShow,
  summarizeBoxOffice,
  parseStatusJson,
  pickShowTime,
  parseRunOfShow,
  computeAttendance,
  pickEffectiveCapacity,
} = m;

const baseShow = {
  id: 1,
  location_id: 'default',
  band_name: 'Test Band',
  show_date: '2026-05-11',
  price: 20,
  door_tix: '7pm',
  status_json: '{}',
};

describe('resolveTonightShow', () => {
  it('returns the row whose date matches today', () => {
    const rows = [
      { ...baseShow, id: 1, show_date: '2026-05-10', band_name: 'Yesterday' },
      { ...baseShow, id: 2, show_date: '2026-05-11', band_name: 'Tonight' },
      { ...baseShow, id: 3, show_date: '2026-05-12', band_name: 'Tomorrow' },
    ];
    assert.equal(resolveTonightShow(rows, '2026-05-11').band_name, 'Tonight');
  });

  it('returns null when no row matches', () => {
    const rows = [{ ...baseShow, show_date: '2026-05-10' }];
    assert.equal(resolveTonightShow(rows, '2026-05-11'), null);
  });

  it('returns null on empty/missing input', () => {
    assert.equal(resolveTonightShow([], '2026-05-11'), null);
    assert.equal(resolveTonightShow(undefined, '2026-05-11'), null);
  });
});

describe('findPreviousShow', () => {
  it('returns the most recent show before tonightDate', () => {
    const rows = [
      { ...baseShow, id: 1, show_date: '2026-05-08', band_name: 'A' },
      { ...baseShow, id: 2, show_date: '2026-05-09', band_name: 'B' },
      { ...baseShow, id: 3, show_date: '2026-05-11', band_name: 'Tonight' },
    ];
    assert.equal(findPreviousShow(rows, '2026-05-11').band_name, 'B');
  });

  it('with no tonightDate, returns the most recent past show in the list', () => {
    const rows = [
      { ...baseShow, id: 1, show_date: '2026-05-08', band_name: 'A' },
      { ...baseShow, id: 2, show_date: '2026-05-09', band_name: 'B' },
    ];
    assert.equal(findPreviousShow(rows, null).band_name, 'B');
  });

  it('returns null when nothing precedes', () => {
    const rows = [{ ...baseShow, show_date: '2026-05-12' }];
    assert.equal(findPreviousShow(rows, '2026-05-11'), null);
  });

  it('does NOT return tonight itself (strict less-than)', () => {
    const rows = [
      { ...baseShow, id: 1, show_date: '2026-05-11', band_name: 'Tonight' },
      { ...baseShow, id: 2, show_date: '2026-05-10', band_name: 'Yesterday' },
    ];
    assert.equal(findPreviousShow(rows, '2026-05-11').band_name, 'Yesterday');
  });
});

describe('summarizeBoxOffice', () => {
  const line = (overrides) => ({
    id: 1,
    show_id: 1,
    location_id: 'default',
    source: 'walkup',
    ticket_class: null,
    qty: 1,
    face_price: 0,
    fees: 0,
    external_ref: null,
    scanned_at: null,
    notes: null,
    ...overrides,
  });

  it('returns zero buckets for an empty input', () => {
    const s = summarizeBoxOffice([]);
    assert.equal(s.total_qty, 0);
    assert.equal(s.scanned_qty, 0);
    assert.equal(s.total_revenue, 0);
    assert.equal(s.by_source.dice.qty, 0);
    assert.equal(s.by_source.walkup.qty, 0);
  });

  it('sums qty × face + fees per source', () => {
    const s = summarizeBoxOffice([
      line({ source: 'dice', qty: 50, face_price: 20, fees: 100 }),
      line({ source: 'walkup', qty: 10, face_price: 25 }),
      line({ source: 'comp', qty: 4, face_price: 0 }),
    ]);
    assert.equal(s.total_qty, 64);
    assert.equal(s.by_source.dice.qty, 50);
    assert.equal(s.by_source.dice.revenue, 50 * 20 + 100);
    assert.equal(s.by_source.walkup.revenue, 250);
    assert.equal(s.by_source.comp.revenue, 0);
    assert.equal(s.total_revenue, 50 * 20 + 100 + 10 * 25 + 0);
  });

  it('counts scanned_qty only when scanned_at is non-null', () => {
    const s = summarizeBoxOffice([
      line({ source: 'dice', qty: 30, scanned_at: '2026-05-11T20:14:00Z' }),
      line({ source: 'dice', qty: 20, scanned_at: null }),
      line({ source: 'walkup', qty: 5, scanned_at: '2026-05-11T21:01:00Z' }),
    ]);
    assert.equal(s.total_qty, 55);
    assert.equal(s.scanned_qty, 35);
  });

  it('rounds revenue to cents', () => {
    const s = summarizeBoxOffice([line({ source: 'dice', qty: 1, face_price: 19.999, fees: 0.001 })]);
    assert.equal(s.total_revenue, 20.0);
  });

  it('ignores unknown source values silently (schema check enforces upstream)', () => {
    const s = summarizeBoxOffice([line({ source: 'bogus', qty: 99 })]);
    assert.equal(s.total_qty, 0);
  });
});

describe('parseStatusJson', () => {
  it('returns parsed object on valid JSON', () => {
    assert.deepEqual(parseStatusJson('{"doors":"7pm"}'), { doors: '7pm' });
  });
  it('returns empty object on null/undefined/empty', () => {
    assert.deepEqual(parseStatusJson(null), {});
    assert.deepEqual(parseStatusJson(undefined), {});
    assert.deepEqual(parseStatusJson(''), {});
  });
  it('returns empty object on malformed JSON', () => {
    assert.deepEqual(parseStatusJson('{not json'), {});
  });
  it('returns empty object when JSON is not a plain object (array, primitive)', () => {
    assert.deepEqual(parseStatusJson('[1,2,3]'), {});
    assert.deepEqual(parseStatusJson('"a string"'), {});
  });
});

describe('pickShowTime', () => {
  it('returns the named field when present and a non-empty string', () => {
    assert.equal(pickShowTime({ doors: '7pm' }, 'doors'), '7pm');
    assert.equal(pickShowTime({ set1: '8:30pm' }, 'set1'), '8:30pm');
  });
  it('falls back from doors to door_time', () => {
    assert.equal(pickShowTime({ door_time: '6:30pm' }, 'doors'), '6:30pm');
  });
  it('returns null when the field is missing, blank, or wrong type', () => {
    assert.equal(pickShowTime({}, 'set1'), null);
    assert.equal(pickShowTime({ set1: '  ' }, 'set1'), null);
    assert.equal(pickShowTime({ set1: 42 }, 'set1'), null);
  });
});

describe('parseRunOfShow', () => {
  it('returns [] on null/empty input', () => {
    assert.deepEqual(parseRunOfShow(null), []);
    assert.deepEqual(parseRunOfShow(''), []);
  });

  it('returns [] on malformed JSON', () => {
    assert.deepEqual(parseRunOfShow('{not json'), []);
  });

  it('returns [] when the JSON is not an array', () => {
    assert.deepEqual(parseRunOfShow('{"foo":"bar"}'), []);
  });

  it('parses a list of {time, label} objects', () => {
    const raw = JSON.stringify([
      { time: '7:00pm', label: 'Doors' },
      { time: '8:30pm', label: 'Set 1' },
    ]);
    const out = parseRunOfShow(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0].label, 'Doors');
    assert.equal(out[1].time, '8:30pm');
  });

  it('accepts {at, text} aliases', () => {
    const raw = JSON.stringify([{ at: '9:45pm', text: 'Set 2' }]);
    assert.deepEqual(parseRunOfShow(raw), [{ time: '9:45pm', label: 'Set 2' }]);
  });

  it('accepts flat string entries (time: null)', () => {
    const raw = JSON.stringify(['Lights down', 'Walk-on']);
    const out = parseRunOfShow(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0].time, null);
    assert.equal(out[0].label, 'Lights down');
  });

  it('skips entries with no label / non-objects', () => {
    const raw = JSON.stringify([{ time: '7pm' }, 42, null, { label: 'OK' }]);
    const out = parseRunOfShow(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'OK');
  });
});

describe('computeAttendance', () => {
  it('returns status:unset and null percents when capacity is null/0/non-numeric', () => {
    for (const cap of [null, undefined, 0, -5, NaN, 'oops']) {
      const a = computeAttendance(50, 100, cap);
      assert.equal(a.status, 'unset', `cap=${cap} should be unset`);
      assert.equal(a.scanned_pct, null);
      assert.equal(a.sold_pct, null);
      assert.equal(a.capacity, null);
      assert.equal(a.scanned_qty, 50);
      assert.equal(a.sold_qty, 100);
    }
  });

  it('status=under when scanned < 50% of capacity', () => {
    const a = computeAttendance(40, 60, 100);
    assert.equal(a.status, 'under');
    assert.equal(a.scanned_pct, 40);
    assert.equal(a.sold_pct, 60);
    assert.equal(a.capacity, 100);
  });

  it('status=near at 50% scanned exactly', () => {
    const a = computeAttendance(50, 80, 100);
    assert.equal(a.status, 'near');
    assert.equal(a.scanned_pct, 50);
  });

  it('status=near at 79% scanned', () => {
    const a = computeAttendance(79, 90, 100);
    assert.equal(a.status, 'near');
  });

  it('status=at at 80% scanned exactly', () => {
    const a = computeAttendance(80, 100, 100);
    assert.equal(a.status, 'at');
    assert.equal(a.scanned_pct, 80);
  });

  it('status=at at 100% scanned (full house)', () => {
    const a = computeAttendance(150, 150, 150);
    assert.equal(a.status, 'at');
    assert.equal(a.scanned_pct, 100);
  });

  it('status=over when scanned > capacity (capacity exceeded)', () => {
    const a = computeAttendance(160, 160, 150);
    assert.equal(a.status, 'over');
    assert.ok(a.scanned_pct > 100);
  });

  it('rounds percent to 0.1% precision', () => {
    const a = computeAttendance(33, 60, 100);
    assert.equal(a.scanned_pct, 33);
    const b = computeAttendance(1, 0, 3);   // 33.3333...
    assert.equal(b.scanned_pct, 33.3);
  });

  it('clamps negative scanned/sold to 0', () => {
    const a = computeAttendance(-10, -5, 100);
    assert.equal(a.scanned_qty, 0);
    assert.equal(a.sold_qty, 0);
    assert.equal(a.status, 'under');
  });

  it('coerces string/null inputs to 0 without throwing', () => {
    const a = computeAttendance(null, undefined, 100);
    assert.equal(a.scanned_qty, 0);
    assert.equal(a.sold_qty, 0);
    assert.equal(a.status, 'under');
  });

  it('floors fractional capacity', () => {
    const a = computeAttendance(50, 50, 99.9);
    assert.equal(a.capacity, 99);
  });
});

describe('pickEffectiveCapacity', () => {
  it('returns the status_json.capacity override when valid', () => {
    assert.equal(pickEffectiveCapacity({ capacity: 180 }, 220), 180);
    assert.equal(pickEffectiveCapacity({ capacity: '180' }, 220), 180);
  });

  it('floors fractional overrides', () => {
    assert.equal(pickEffectiveCapacity({ capacity: 180.7 }, 220), 180);
  });

  it('falls through to venue when override is 0 / negative / non-numeric', () => {
    assert.equal(pickEffectiveCapacity({ capacity: 0 }, 220), 220);
    assert.equal(pickEffectiveCapacity({ capacity: -5 }, 220), 220);
    assert.equal(pickEffectiveCapacity({ capacity: 'soldout' }, 220), 220);
  });

  it('returns venue when status has no capacity key', () => {
    assert.equal(pickEffectiveCapacity({}, 220), 220);
    assert.equal(pickEffectiveCapacity(null, 220), 220);
    assert.equal(pickEffectiveCapacity(undefined, 220), 220);
  });

  it('returns null when neither is set', () => {
    assert.equal(pickEffectiveCapacity({}, null), null);
    assert.equal(pickEffectiveCapacity({ capacity: 0 }, 0), null);
    assert.equal(pickEffectiveCapacity({ capacity: -1 }, undefined), null);
  });
});
