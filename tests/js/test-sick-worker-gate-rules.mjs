#!/usr/bin/env node
// Tests for lib/sickWorkerGate — L6 (FDA 2022 §2-201.12).
// Run: node --experimental-strip-types --test tests/js/test-sick-worker-gate-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SICK_WORKER_EXCLUSION_CITATION,
  cookHasActiveExclusion,
  evaluateCookEligibility,
} from '../../lib/sickWorkerGate.ts';

describe('cookHasActiveExclusion', () => {
  it('empty array → not excluded', () => {
    assert.strictEqual(cookHasActiveExclusion([]), false);
  });

  it('one excluded + open (return_at null) → excluded', () => {
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'excluded', return_at: null }]),
      true,
    );
  });

  it('one excluded but cleared (return_at set) → not excluded', () => {
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'excluded', return_at: '2026-05-04T08:00:00Z' }]),
      false,
    );
  });

  it('one restricted + open → excluded (restricted is also blocking)', () => {
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'restricted', return_at: null }]),
      true,
    );
  });

  it('one monitor + open → NOT excluded (monitor is informational)', () => {
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'monitor', return_at: null }]),
      false,
    );
  });

  it('one none + open → NOT excluded', () => {
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'none', return_at: null }]),
      false,
    );
  });

  it('multiple mixed: excluded-cleared + monitor-open → not excluded', () => {
    assert.strictEqual(
      cookHasActiveExclusion([
        { action: 'excluded', return_at: '2026-05-01T08:00:00Z' },
        { action: 'monitor', return_at: null },
      ]),
      false,
    );
  });

  it('multiple mixed: monitor-open + restricted-open → excluded', () => {
    assert.strictEqual(
      cookHasActiveExclusion([
        { action: 'monitor', return_at: null },
        { action: 'restricted', return_at: null },
      ]),
      true,
    );
  });

  it('rows with return_at undefined still treated as open', () => {
    // Defensive: a route SELECT that omits the column shouldn't
    // bypass the gate. Belt-and-suspenders alongside null check.
    assert.strictEqual(
      cookHasActiveExclusion([{ action: 'excluded', return_at: undefined }]),
      true,
    );
  });

  it('non-array input → false (defensive, never throws)', () => {
    // @ts-expect-error - intentional bad input
    assert.strictEqual(cookHasActiveExclusion(null), false);
    // @ts-expect-error - intentional bad input
    assert.strictEqual(cookHasActiveExclusion(undefined), false);
    // @ts-expect-error - intentional bad input
    assert.strictEqual(cookHasActiveExclusion({}), false);
  });
});

describe('evaluateCookEligibility', () => {
  it('no exclusion → ok', () => {
    const r = evaluateCookEligibility([]);
    assert.deepStrictEqual(r, { ok: true });
  });

  it('open excluded → blocks with FDA citation', () => {
    const r = evaluateCookEligibility([{ action: 'excluded', return_at: null }]);
    assert.strictEqual(r.ok, false);
    if (r.ok === false) {
      assert.match(r.reason, /exclusion/i);
      assert.strictEqual(r.citation, SICK_WORKER_EXCLUSION_CITATION);
    }
  });

  it('open restricted → blocks', () => {
    const r = evaluateCookEligibility([{ action: 'restricted', return_at: null }]);
    assert.strictEqual(r.ok, false);
  });
});

describe('citation constant', () => {
  it('references FDA §2-201.12', () => {
    assert.match(SICK_WORKER_EXCLUSION_CITATION, /2-201\.12/);
  });
});
