#!/usr/bin/env node
// Enforces byte-exact parity between Python (scripts/lib/units.py +
// scripts/lib/generate_unit_convert_fixture.py's inline convert_qty) and
// lib/unitConvert.mjs. Regenerate the fixture with:
//   python3 scripts/lib/generate_unit_convert_fixture.py
//
// Run: node --experimental-strip-types --test tests/js/test-unit-convert-parity.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { convertQty, normalizeUnit, unitDimension, effectivePackPrice } from '../../lib/unitConvert.mjs';

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'unit_convert_parity.json',
);

// Strings the Python fixture uses when qty is non-finite — rehydrate them
// into JS Number sentinels so we can pass them to convertQty verbatim.
function rehydrateQty(v) {
  if (typeof v === 'number') return v;
  if (v === 'nan') return NaN;
  if (v === 'inf') return Infinity;
  if (v === '-inf') return -Infinity;
  throw new Error(`unexpected qty sentinel: ${JSON.stringify(v)}`);
}

describe('unitConvert parity with Python', () => {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const rows = JSON.parse(raw);

  it('fixture has at least 40 rows', () => {
    assert.ok(rows.length >= 40, `fixture too small: ${rows.length}`);
  });

  for (const row of rows) {
    const { qty: rawQty, from_unit, to_unit, g_per_ml, expected } = row;
    const qty = rehydrateQty(rawQty);
    const label = `convertQty(${JSON.stringify(rawQty)}, ${JSON.stringify(from_unit)}, ${JSON.stringify(to_unit)}, ${JSON.stringify(g_per_ml)}) === ${JSON.stringify(expected)}`;
    it(label, () => {
      const actual = convertQty(qty, from_unit, to_unit, g_per_ml);
      if (expected === null) {
        // null must be exact — no float fuzzing for rejection cases.
        assert.strictEqual(actual, null);
        return;
      }
      if (expected === 0) {
        // Exact-zero contract: qty=0 and identity-0 both return exact 0.
        assert.strictEqual(actual, 0);
        return;
      }
      // Tolerate ~1e-9 relative for non-zero floats (identity cases and
      // hand-picked integer-yielding conversions still land byte-exact).
      assert.notStrictEqual(actual, null, `expected a number, got null`);
      const diff = Math.abs(actual - expected);
      const scale = Math.max(1, Math.abs(expected));
      assert.ok(diff / scale < 1e-12, `diff=${diff} actual=${actual} expected=${expected}`);
    });
  }
});

describe('unitConvert — sanity on helpers', () => {
  it('normalizeUnit collapses synonyms + casing + whitespace', () => {
    assert.strictEqual(normalizeUnit('LB'), 'lb');
    assert.strictEqual(normalizeUnit(' pound '), 'lb');
    assert.strictEqual(normalizeUnit('Cups'), 'cup');
    assert.strictEqual(normalizeUnit('c'), 'cup');
    assert.strictEqual(normalizeUnit('#'), 'lb');
    assert.strictEqual(normalizeUnit('fluid ounce'), 'floz');
    assert.strictEqual(normalizeUnit(''), '');
    assert.strictEqual(normalizeUnit(null), '');
    assert.strictEqual(normalizeUnit(undefined), '');
  });

  it('unitDimension covers all three axes', () => {
    assert.strictEqual(unitDimension('lb'), 'weight');
    assert.strictEqual(unitDimension('cup'), 'volume');
    assert.strictEqual(unitDimension('ea'), 'count');
    assert.strictEqual(unitDimension('blorp'), null);
  });
});

describe('effectivePackPrice', () => {
  it('prefers explicit pack_price when set', () => {
    assert.strictEqual(effectivePackPrice({ pack_price: 33.01, unit_price: 0.9, pack_size: 36 }), 33.01);
  });

  it('derives pack_price from unit_price × pack_size when pack_price is null', () => {
    assert.strictEqual(
      effectivePackPrice({ pack_price: null, unit_price: 0.916944, pack_size: 36 }),
      0.916944 * 36,
    );
  });

  it('returns null when neither path yields a positive finite price', () => {
    assert.strictEqual(effectivePackPrice({ pack_price: null, unit_price: null, pack_size: 36 }), null);
    assert.strictEqual(effectivePackPrice({ pack_price: 0, unit_price: null, pack_size: 36 }), null);
    assert.strictEqual(effectivePackPrice(null), null);
  });

  it('falls through zero pack_price to unit_price × pack_size', () => {
    assert.strictEqual(effectivePackPrice({ pack_price: 0, unit_price: 1, pack_size: 1 }), 1);
  });
});
