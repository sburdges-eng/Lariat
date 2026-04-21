#!/usr/bin/env node
// Aggregate-rule tests for lib/tempLog.ts.
//
// The row-level classifier + validator is covered by test-temp-log.mjs.
// This file exercises the day-aggregate `classifyReadings` that drives
// the board tiles: green / yellow / red / gray per CCP plus the reading
// counts used for status lines.
//
// Run: node --test tests/js/test-temp-log-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TempPoints,
  classifyReadings,
  getTempPoint,
} from '../../lib/tempLog.ts';

// ── Helper: build a row shaped like a temp_log table row ───────────

function row(point_id, reading_f, { note, at } = {}) {
  return {
    point_id,
    reading_f,
    corrective_action: note ?? null,
    created_at: at ?? '2026-04-21 12:00:00',
  };
}

// ── Registry sanity — 8+ CCPs covered ──────────────────────────────

describe('TempPoints covers all single-reading CCPs', () => {
  it('has at least 8 points (the eight CCPs the brief calls out)', () => {
    assert.ok(TempPoints.length >= 8, `expected ≥ 8 points, got ${TempPoints.length}`);
  });

  it('covers receiving cold + frozen, cold hold (walk-in + reach-in), freezer, hot hold, reheat, and cook per protein', () => {
    const ids = new Set(TempPoints.map((p) => p.id));
    const required = [
      'receiving_cold',
      'receiving_frozen',
      'walk_in_cooler',
      'reach_in_cooler',
      'freezer',
      'hot_hold',
      'reheat',
      'cook_poultry',
      'cook_ground_beef',
      'cook_fish',
    ];
    for (const id of required) {
      assert.ok(ids.has(id), `missing required point: ${id}`);
    }
  });

  it('receiving_frozen has a practical max_f at or below 10°F', () => {
    const p = getTempPoint('receiving_frozen');
    assert.ok(p);
    assert.ok(
      p.required_max_f !== null && p.required_max_f <= 10,
      `receiving_frozen max should be ≤ 10°F, got ${p.required_max_f}`,
    );
  });

  it('every cook point has a minimum internal temp ≥ 145°F', () => {
    for (const p of TempPoints) {
      if (!p.id.startsWith('cook_')) continue;
      assert.ok(
        p.required_min_f !== null && p.required_min_f >= 145,
        `${p.id} must carry a cook-temp floor ≥ 145°F`,
      );
    }
  });

  it('poultry cook min is 165°F per §3-401.11(A)(3)', () => {
    const p = getTempPoint('cook_poultry');
    assert.strictEqual(p.required_min_f, 165);
  });

  it('ground beef cook min is 155°F per §3-401.11(A)(2)', () => {
    const p = getTempPoint('cook_ground_beef');
    assert.strictEqual(p.required_min_f, 155);
  });

  it('fish cook min is 145°F per §3-401.11(A)(1)', () => {
    const p = getTempPoint('cook_fish');
    assert.strictEqual(p.required_min_f, 145);
  });

  it('reheat min is 165°F per §3-403.11', () => {
    const p = getTempPoint('reheat');
    assert.strictEqual(p.required_min_f, 165);
  });
});

// ── classifyReadings — empty day ───────────────────────────────────

describe('classifyReadings — empty day', () => {
  it('returns one summary row per registry point, all gray', () => {
    const s = classifyReadings([]);
    assert.strictEqual(s.length, TempPoints.length);
    for (const r of s) {
      assert.strictEqual(r.status, 'gray', `${r.point_id} should be gray on empty day`);
      assert.strictEqual(r.total_readings, 0);
      assert.strictEqual(r.ok_count, 0);
      assert.strictEqual(r.corrective_count, 0);
      assert.strictEqual(r.critical_count, 0);
      assert.strictEqual(r.last_reading_f, null);
      assert.strictEqual(r.last_reading_at, null);
    }
  });

  it('returns only readings passed when expectAllPoints is false', () => {
    const s = classifyReadings([], { expectAllPoints: false });
    assert.strictEqual(s.length, 0);
  });
});

// ── classifyReadings — all-OK day ──────────────────────────────────

describe('classifyReadings — everything in spec', () => {
  it('tile is green when all readings are in range', () => {
    const readings = [
      row('walk_in_cooler', 38),
      row('walk_in_cooler', 39, { at: '2026-04-21 14:00:00' }),
      row('cook_poultry', 172),
    ];
    const s = classifyReadings(readings, { expectAllPoints: false });
    const byId = Object.fromEntries(s.map((r) => [r.point_id, r]));
    assert.strictEqual(byId.walk_in_cooler.status, 'green');
    assert.strictEqual(byId.walk_in_cooler.total_readings, 2);
    assert.strictEqual(byId.walk_in_cooler.ok_count, 2);
    assert.strictEqual(byId.cook_poultry.status, 'green');
  });

  it('last_reading_* tracks the newest row by created_at', () => {
    const readings = [
      row('walk_in_cooler', 38, { at: '2026-04-21 10:00:00' }),
      row('walk_in_cooler', 39, { at: '2026-04-21 14:00:00' }),
      row('walk_in_cooler', 37, { at: '2026-04-21 12:00:00' }),
    ];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.last_reading_f, 39);
    assert.strictEqual(s.last_reading_at, '2026-04-21 14:00:00');
  });
});

// ── classifyReadings — corrective (yellow) vs critical (red) ───────

describe('classifyReadings — corrective vs critical', () => {
  it('out-of-range with a note is corrective → yellow tile', () => {
    const readings = [
      row('walk_in_cooler', 38),
      row('walk_in_cooler', 44, { note: 'moved to reach-in, called tech' }),
    ];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.status, 'yellow');
    assert.strictEqual(s.corrective_count, 1);
    assert.strictEqual(s.critical_count, 0);
    assert.strictEqual(s.ok_count, 1);
  });

  it('out-of-range WITHOUT a note is critical → red tile', () => {
    const readings = [
      row('walk_in_cooler', 38),
      row('walk_in_cooler', 44, { note: null }),
    ];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
    assert.strictEqual(s.critical_count, 1);
    assert.strictEqual(s.corrective_count, 0);
  });

  it('red beats yellow — one critical reading turns the tile red even with many corrective ones', () => {
    const readings = [
      row('walk_in_cooler', 43, { note: 'lid was open' }),
      row('walk_in_cooler', 42, { note: 'lid was open' }),
      row('walk_in_cooler', 47, { note: null }),
    ];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
    assert.strictEqual(s.critical_count, 1);
    assert.strictEqual(s.corrective_count, 2);
  });

  it('whitespace-only corrective_action counts as NO note (still critical)', () => {
    const readings = [row('walk_in_cooler', 44, { note: '   ' })];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
    assert.strictEqual(s.critical_count, 1);
  });
});

// ── classifyReadings — cook-temp / protein matrix ──────────────────

describe('classifyReadings — per-protein cook thresholds', () => {
  it('poultry at 164°F (under 165) without note is critical', () => {
    const [s] = classifyReadings([row('cook_poultry', 164)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
    assert.strictEqual(s.critical_count, 1);
  });

  it('poultry at 165°F exactly is OK', () => {
    const [s] = classifyReadings([row('cook_poultry', 165)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'green');
  });

  it('ground beef at 150°F without note is critical', () => {
    const [s] = classifyReadings([row('cook_ground_beef', 150)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
  });

  it('fish at 145°F exactly is OK', () => {
    const [s] = classifyReadings([row('cook_fish', 145)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'green');
  });

  it('reheat at 164°F without note is critical', () => {
    const [s] = classifyReadings([row('reheat', 164)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
    assert.strictEqual(s.critical_count, 1);
  });

  it('reheat at 170°F is OK', () => {
    const [s] = classifyReadings([row('reheat', 170)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'green');
  });
});

// ── classifyReadings — receiving / cold hold / freezer ─────────────

describe('classifyReadings — receiving and hold thresholds', () => {
  it('receiving cold at 41°F exactly is OK', () => {
    const [s] = classifyReadings([row('receiving_cold', 41)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'green');
  });

  it('receiving frozen at 12°F without note is critical', () => {
    const [s] = classifyReadings([row('receiving_frozen', 12)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
  });

  it('freezer at 5°F without note is critical', () => {
    const [s] = classifyReadings([row('freezer', 5)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
  });

  it('freezer at -10°F is OK', () => {
    const [s] = classifyReadings([row('freezer', -10)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'green');
  });

  it('hot hold at 134°F without note is critical (cutoff is 140)', () => {
    // Our registry uses 140°F to match the pre-2017 Food Code — the
    // TempPoint definition locks this at entryFromReading time anyway,
    // so the board aggregation just needs to honor whatever the row
    // carries. §3-501.16 allows 135°F but the kitchen's own policy is
    // tighter at 140 so the cook never drifts into the 135 edge.
    const [s] = classifyReadings([row('hot_hold', 134)], { expectAllPoints: false });
    assert.strictEqual(s.status, 'red');
  });
});

// ── classifyReadings — invalid input ───────────────────────────────

describe('classifyReadings — invalid readings', () => {
  it('NaN reading is counted as invalid, not ok', () => {
    const [s] = classifyReadings(
      [{ point_id: 'walk_in_cooler', reading_f: Number.NaN, corrective_action: null, created_at: null }],
      { expectAllPoints: false },
    );
    assert.strictEqual(s.invalid_count, 1);
    assert.strictEqual(s.ok_count, 0);
    // Only-invalid day is red — the CCP is unverified.
    assert.strictEqual(s.status, 'red');
  });

  it('Infinity reading is counted as invalid', () => {
    const [s] = classifyReadings(
      [{ point_id: 'walk_in_cooler', reading_f: Infinity, corrective_action: null, created_at: null }],
      { expectAllPoints: false },
    );
    assert.strictEqual(s.invalid_count, 1);
    assert.strictEqual(s.status, 'red');
  });

  it('reading past the absolute sanity bound is invalid, not out_of_range', () => {
    const [s] = classifyReadings([row('walk_in_cooler', -500)], { expectAllPoints: false });
    assert.strictEqual(s.invalid_count, 1);
    assert.strictEqual(s.ok_count, 0);
    assert.strictEqual(s.critical_count, 0);
  });

  it('a mix of one invalid and one ok reading stays green (the probe sorted itself out)', () => {
    const readings = [
      row('walk_in_cooler', 38, { at: '2026-04-21 10:00:00' }),
      { point_id: 'walk_in_cooler', reading_f: Number.NaN, corrective_action: null, created_at: '2026-04-21 11:00:00' },
    ];
    const [s] = classifyReadings(readings, { expectAllPoints: false });
    // At least one ok, no critical → green. invalid_count is retained
    // for audit visibility but it doesn't dominate the status.
    assert.strictEqual(s.ok_count, 1);
    assert.strictEqual(s.invalid_count, 1);
    assert.strictEqual(s.status, 'green');
  });
});

// ── classifyReadings — aggregation shape ───────────────────────────

describe('classifyReadings — mixed day shape', () => {
  it('returns all registry CCPs with correct statuses when given a mixed day', () => {
    const readings = [
      row('walk_in_cooler', 38),                                // ok
      row('cook_poultry', 150, { note: null }),                 // critical (red)
      row('cook_fish', 143, { note: 'returned to heat at 148' }), // corrective (yellow)
      row('hot_hold', 150),                                     // ok
    ];
    const s = classifyReadings(readings);
    assert.strictEqual(s.length, TempPoints.length);
    const byId = Object.fromEntries(s.map((r) => [r.point_id, r]));
    assert.strictEqual(byId.walk_in_cooler.status, 'green');
    assert.strictEqual(byId.cook_poultry.status, 'red');
    assert.strictEqual(byId.cook_fish.status, 'yellow');
    assert.strictEqual(byId.hot_hold.status, 'green');
    // A point with no readings is gray
    assert.strictEqual(byId.freezer.status, 'gray');
    assert.strictEqual(byId.freezer.total_readings, 0);
  });

  it('drops rows pointing at a retired point_id', () => {
    const readings = [
      row('walk_in_cooler', 38),
      { point_id: 'retired_legacy_point', reading_f: 32, corrective_action: null, created_at: null },
    ];
    // No crash; the retired row is silently filtered from the summary.
    const s = classifyReadings(readings, { expectAllPoints: false });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].point_id, 'walk_in_cooler');
  });

  it('returns a stable result object shape for each summary row', () => {
    const [s] = classifyReadings([row('walk_in_cooler', 38)], { expectAllPoints: false });
    const keys = Object.keys(s).sort();
    assert.deepStrictEqual(keys, [
      'ccp_id',
      'corrective_count',
      'critical_count',
      'invalid_count',
      'label',
      'last_reading_at',
      'last_reading_f',
      'ok_count',
      'point_id',
      'required_max_f',
      'required_min_f',
      'status',
      'total_readings',
    ]);
  });
});
