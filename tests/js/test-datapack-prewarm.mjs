#!/usr/bin/env node
// Tests for lib/datapackSearch.prewarmDataPack — the boot-time pre-warm
// that lib/instrumentation.ts dispatches via setImmediate.
//
// Run: node --experimental-strip-types --test tests/js/test-datapack-prewarm.mjs
//
// The pre-warm exists to amortize the ~20s cold-load of the BGE
// embedding model + ingredients vector bucket (~3 GB, 2M+ rows) so the
// first user-triggered INGREDIENT_KEYWORDS query doesn't pay that tax.
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §5.
//
// Contract under test (all three properties matter for boot safety):
//   1. graceful-degraded: returns silently when the data pack isn't
//      mounted (available() === false) — must never throw.
//   2. idempotent / safe-on-error: any internal failure (semantic
//      throw, model-load failure) is swallowed; pre-warm logs and
//      returns. Never crashes the boot path.
//   3. import is clean: dynamic-importing the module from
//      instrumentation.ts must succeed and expose `prewarmDataPack`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  prewarmDataPack,
  _resetForTest,
  _setAvailableOverrideForTest,
} from '../../lib/datapackSearch.ts';

describe('lib/datapackSearch.prewarmDataPack — graceful-degraded', () => {
  it('returns silently when data pack is unavailable', async () => {
    // Force the unavailable branch via the test-only override so this
    // case runs cleanly on machines that DO have the SSD mounted.
    _setAvailableOverrideForTest(false);
    try {
      // Must not throw, must not log to stderr, must complete fast
      // (no model load, no vector read).
      const t0 = performance.now();
      await prewarmDataPack();
      const dt = performance.now() - t0;
      assert.ok(
        dt < 50,
        `unavailable pre-warm should return immediately, took ${dt.toFixed(1)}ms`
      );
    } finally {
      _resetForTest();
    }
  });

  it('is safe to call multiple times back-to-back (idempotent)', async () => {
    // Repeated calls under the unavailable override must each short-
    // circuit without side effects. Tests the contract that
    // instrumentation.ts can dispatch this on every boot without
    // worrying about a double-fire (e.g. dev HMR worker restart).
    _setAvailableOverrideForTest(false);
    try {
      await prewarmDataPack();
      await prewarmDataPack();
      await prewarmDataPack();
      // No assertion needed beyond "no throw" — three back-to-back
      // calls completing is the contract.
    } finally {
      _resetForTest();
    }
  });
});

describe('lib/datapackSearch.prewarmDataPack — module surface', () => {
  it('dynamic import resolves and exposes prewarmDataPack', async () => {
    // Mirrors the import shape used by instrumentation.ts:
    //   const { prewarmDataPack } = await import('./lib/datapackSearch.ts');
    // If this fails, the boot-time setImmediate would also fail.
    const mod = await import('../../lib/datapackSearch.ts');
    assert.equal(typeof mod.prewarmDataPack, 'function');
  });
});
