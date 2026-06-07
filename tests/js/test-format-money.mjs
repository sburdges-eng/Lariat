#!/usr/bin/env node
// formatMoney + formatDollars contract.
//
// Closes §7 P2 from the 2026-05-02 breaker audit
// (docs/agentic/findings/2026-05-02-no-canonical-money-formatter.md).
//
// Run: node --experimental-strip-types --test tests/js/test-format-money.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactDollars,
  formatDollars,
  formatMoney,
} from '../../lib/formatMoney.ts';

describe('formatMoney — INTEGER cents in, money string out', () => {
  it('formats 1234 cents as "$12.34"', () => {
    assert.strictEqual(formatMoney(1234), '$12.34');
  });

  it('formats 0 as "$0.00"', () => {
    assert.strictEqual(formatMoney(0), '$0.00');
  });

  it('formats negative as -$X.YZ (sign before currency)', () => {
    assert.strictEqual(formatMoney(-1234), '-$12.34');
    assert.strictEqual(formatMoney(-100), '-$1.00');
    assert.strictEqual(formatMoney(-1), '-$0.01');
  });

  it('uses thousands separator', () => {
    assert.strictEqual(formatMoney(1234567), '$12,345.67');
    assert.strictEqual(formatMoney(1000000000), '$10,000,000.00');
    assert.strictEqual(formatMoney(-12345678), '-$123,456.78');
  });

  it('null/undefined → default "—"', () => {
    assert.strictEqual(formatMoney(null), '—');
    assert.strictEqual(formatMoney(undefined), '—');
  });

  it('null fallback is overridable', () => {
    assert.strictEqual(formatMoney(null, { nullDisplay: 'n/a' }), 'n/a');
    assert.strictEqual(formatMoney(undefined, { nullDisplay: '' }), '');
  });

  it('NaN / Infinity → null fallback', () => {
    assert.strictEqual(formatMoney(NaN), '—');
    assert.strictEqual(formatMoney(Infinity), '—');
    assert.strictEqual(formatMoney(-Infinity), '—');
  });

  it('opt-in 4-decimal form', () => {
    assert.strictEqual(formatMoney(1234, { decimals: 4 }), '$12.3400');
    assert.strictEqual(formatMoney(-1234, { decimals: 4 }), '-$12.3400');
  });

  it('supports whole-dollar and 3-decimal display modes without local helpers', () => {
    assert.strictEqual(formatMoney(1234, { decimals: 0 }), '$12');
    assert.strictEqual(formatMoney(-1234, { decimals: 0 }), '-$12');
    assert.strictEqual(formatMoney(1234, { decimals: 3 }), '$12.340');
  });
});

describe('formatDollars — dollar float in, money string out', () => {
  it('formats 12.34 as "$12.34"', () => {
    assert.strictEqual(formatDollars(12.34), '$12.34');
  });

  it('formats string "12.34" via Number coerce', () => {
    assert.strictEqual(formatDollars('12.34'), '$12.34');
  });

  it('null/undefined/empty-string → "—"', () => {
    assert.strictEqual(formatDollars(null), '—');
    assert.strictEqual(formatDollars(undefined), '—');
    assert.strictEqual(formatDollars(''), '—');
  });

  it('handles negative correctly', () => {
    assert.strictEqual(formatDollars(-12.34), '-$12.34');
    assert.strictEqual(formatDollars('-99.99'), '-$99.99');
  });

  it('thousands separator on large values', () => {
    assert.strictEqual(formatDollars(12345.67), '$12,345.67');
    assert.strictEqual(formatDollars(1000000), '$1,000,000.00');
  });

  it('rounds half-up to whole cents in default mode', () => {
    // 12.345 rounds to 12.35 (half-up via Math.round)
    assert.strictEqual(formatDollars(12.345), '$12.35');
    assert.strictEqual(formatDollars(12.344), '$12.34');
  });

  it('opt-in 4-decimal precision on vendor unit-price surfaces', () => {
    assert.strictEqual(formatDollars(0.0234, { decimals: 4 }), '$0.0234');
    assert.strictEqual(formatDollars(12.5, { decimals: 4 }), '$12.5000');
    assert.strictEqual(formatDollars(-0.0234, { decimals: 4 }), '-$0.0234');
  });

  it('supports chart and unit-price precision modes', () => {
    assert.strictEqual(formatDollars(1234.56, { decimals: 0 }), '$1,235');
    assert.strictEqual(formatDollars(-1234.56, { decimals: 0 }), '-$1,235');
    assert.strictEqual(formatDollars(12.3456, { decimals: 1 }), '$12.3');
    assert.strictEqual(formatDollars(0.1234, { decimals: 3 }), '$0.123');
  });

  it('non-finite Number coerce → null fallback', () => {
    assert.strictEqual(formatDollars('not a number'), '—');
    assert.strictEqual(formatDollars(NaN), '—');
  });
});

describe('formatCompactDollars — chart labels', () => {
  it('keeps the sign before the currency symbol', () => {
    assert.strictEqual(formatCompactDollars(-1234), '-$1k');
    assert.strictEqual(formatCompactDollars(-1250000), '-$1.3M');
  });

  it('uses compact labels for chart axes', () => {
    assert.strictEqual(formatCompactDollars(999), '$999');
    assert.strictEqual(formatCompactDollars(1234), '$1k');
    assert.strictEqual(formatCompactDollars(1250000), '$1.3M');
  });

  it('uses the null fallback for missing values', () => {
    assert.strictEqual(formatCompactDollars(null), '—');
    assert.strictEqual(formatCompactDollars(undefined, { nullDisplay: 'n/a' }), 'n/a');
  });
});

describe('formatMoney — regression cases from the §7 P2 finding', () => {
  it('does NOT produce $-12.34 (the bug pattern)', () => {
    const out = formatMoney(-1234);
    assert.ok(!out.startsWith('$-'), `output must not start with "$-"; got ${out}`);
  });

  it('SpecialDetailClient.jsx-style call: cost_total as string survives without crash', () => {
    // Pre-fix: special.cost_total.toFixed(2) crashed if cost_total was a string.
    // The helper coerces via Number; no crash.
    assert.strictEqual(formatDollars('45.00'), '$45.00');
    assert.strictEqual(formatDollars(''), '—');
  });
});
