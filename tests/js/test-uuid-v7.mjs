#!/usr/bin/env node
// Tests for lib/uuid.ts — UUID v7 generator.
// Run: node --experimental-strip-types --test tests/js/test-uuid-v7.mjs
//
// Verifies:
//   - canonical 36-char hyphenated format
//   - version nibble = 7, variant bits = 10
//   - embedded timestamp round-trips
//   - lexicographic ordering matches generation order across ms boundaries
//   - high-entropy randomness (no two of 10k calls collide)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { uuidv7, isUuidV7, uuidv7Timestamp } from '../../lib/uuid.ts';

describe('uuidv7 — format', () => {
  it('produces canonical 36-char hyphenated form', () => {
    const u = uuidv7();
    assert.strictEqual(u.length, 36);
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sets version nibble to 7', () => {
    for (let i = 0; i < 50; i++) {
      const u = uuidv7();
      assert.strictEqual(u[14], '7', `expected version=7 at idx 14, got ${u}`);
    }
  });

  it('sets variant bits to 10xx (first nibble of group 4 ∈ {8,9,a,b})', () => {
    for (let i = 0; i < 50; i++) {
      const u = uuidv7();
      assert.match(u[19], /[89ab]/, `expected variant nibble in {8,9,a,b}, got ${u}`);
    }
  });

  it('isUuidV7 accepts its own output', () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(isUuidV7(uuidv7()), 'uuidv7() output must validate');
    }
  });

  it('isUuidV7 rejects v4 / malformed / non-strings', () => {
    assert.strictEqual(isUuidV7('not-a-uuid'), false);
    assert.strictEqual(isUuidV7(''), false);
    assert.strictEqual(isUuidV7(null), false);
    assert.strictEqual(isUuidV7(undefined), false);
    assert.strictEqual(isUuidV7(42), false);
    // v4 — version=4 → invalid for v7
    assert.strictEqual(
      isUuidV7('123e4567-e89b-42d3-a456-426614174000'),
      false,
    );
  });
});

describe('uuidv7 — timestamp embedding', () => {
  it('embeds the supplied ms timestamp', () => {
    const t = 1_700_000_000_123; // arbitrary fixed ms
    const u = uuidv7(t);
    assert.strictEqual(uuidv7Timestamp(u), t);
  });

  it('embeds Date.now() within a tiny tolerance when called default', () => {
    const before = Date.now();
    const u = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(u);
    assert.ok(ts !== null);
    assert.ok(ts >= before && ts <= after, `${ts} not in [${before}, ${after}]`);
  });

  it('rejects negative / non-integer ms input', () => {
    assert.throws(() => uuidv7(-1), /non-negative integer/);
    assert.throws(() => uuidv7(1.5), /non-negative integer/);
    assert.throws(() => uuidv7(Number.NaN), /non-negative integer/);
  });

  it('uuidv7Timestamp returns null for non-v7 strings', () => {
    assert.strictEqual(uuidv7Timestamp('not-a-uuid'), null);
    assert.strictEqual(uuidv7Timestamp('123e4567-e89b-42d3-a456-426614174000'), null);
  });
});

describe('uuidv7 — ordering & uniqueness', () => {
  it('lexicographic order matches generation order across ms boundaries', () => {
    // Use deterministic ms inputs so the test isn't flaky on a fast loop.
    const t0 = 1_700_000_000_000;
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(uuidv7(t0 + i));
    const sorted = [...ids].sort();
    assert.deepStrictEqual(ids, sorted, 'v7 ids must sort lexicographically by time');
  });

  it('10k generations produce no collisions', () => {
    const seen = new Set();
    for (let i = 0; i < 10_000; i++) seen.add(uuidv7());
    assert.strictEqual(seen.size, 10_000);
  });
});
