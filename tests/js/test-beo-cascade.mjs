#!/usr/bin/env node
// BEO cascade wrapper — TS module that shells to scripts/beo_cascade_cli.py.
// Verifies:
//   1. Round-trip with a bogus item: resolves with unmapped[0].menu_item matching the bogus name.
//   2. Typed error on CLI failure (bad root → missing recipe_index.csv → CascadeError).
//   3. Empty line-items short-circuit: resolves to all-empty arrays without spawning.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-cascade.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CascadeError, cascadeFromLineItems } from '../../lib/beoCascade.ts';

describe('beoCascade', () => {
  it('round-trips a bogus item to unmapped', async () => {
    const BOGUS = '__definitely_not_a_real_item__';
    const result = await cascadeFromLineItems([{ item_name: BOGUS, quantity: 1 }]);
    assert.ok(Array.isArray(result.orderGuide), 'orderGuide must be an array');
    assert.ok(Array.isArray(result.prepDemands), 'prepDemands must be an array');
    assert.ok(Array.isArray(result.unmapped), 'unmapped must be an array');
    assert.equal(result.orderGuide.length, 0, 'orderGuide should be empty for bogus item');
    assert.equal(result.prepDemands.length, 0, 'prepDemands should be empty for bogus item');
    assert.equal(result.unmapped.length, 1, 'unmapped should have exactly 1 entry');
    assert.equal(result.unmapped[0].menu_item, BOGUS, 'unmapped menu_item should match bogus name');
    assert.ok(typeof result.unmapped[0].reason === 'string', 'unmapped reason must be a string');
  });

  it('rejects with CascadeError when CLI fails (bad root)', async () => {
    await assert.rejects(
      () => cascadeFromLineItems([{ item_name: 'anything', quantity: 1 }], { root: '/nonexistent-root-xyz' }),
      (e) => {
        assert.ok(e instanceof CascadeError, `expected CascadeError, got ${e?.constructor?.name}`);
        assert.ok(typeof e.code === 'string', 'CascadeError must have a code field');
        return true;
      },
    );
  });

  it('short-circuits empty line items without spawning', async () => {
    const start = Date.now();
    const result = await cascadeFromLineItems([]);
    const elapsed = Date.now() - start;
    assert.deepEqual(result, {
      orderGuide: [], prepDemands: [], unmapped: [],
      onHandUnapplied: [], manifestWarnings: [],
    });
    // Short-circuit should be instantaneous (< 500 ms) — no spawn overhead
    assert.ok(elapsed < 500, `short-circuit took too long: ${elapsed}ms`);
  });
});
