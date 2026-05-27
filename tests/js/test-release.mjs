#!/usr/bin/env node
// Tests for lib/release.ts — test-release channel detection.
// Run: node --experimental-strip-types --test tests/js/test-release.mjs
//
// A "test release" (V.I.NN.NNN scheme) runs fully offline: external vendor
// integrations (Toast / 7shifts / Prism / off-tree datapack) are disabled and
// require no credentials. Driven by the LARIAT_TEST_RELEASE env var so runtime
// behavior is explicit and deterministic; the official channel uses v.---.--.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { isTestRelease, getReleaseInfo } from '../../lib/release.ts';

const SNAP = process.env.LARIAT_TEST_RELEASE;
after(() => {
  if (SNAP === undefined) delete process.env.LARIAT_TEST_RELEASE;
  else process.env.LARIAT_TEST_RELEASE = SNAP;
});

describe('isTestRelease', () => {
  it('is true for LARIAT_TEST_RELEASE=1', () => {
    process.env.LARIAT_TEST_RELEASE = '1';
    assert.equal(isTestRelease(), true);
  });
  it('is true for LARIAT_TEST_RELEASE=true (case-insensitive)', () => {
    process.env.LARIAT_TEST_RELEASE = 'TRUE';
    assert.equal(isTestRelease(), true);
  });
  it('is false for LARIAT_TEST_RELEASE=0', () => {
    process.env.LARIAT_TEST_RELEASE = '0';
    assert.equal(isTestRelease(), false);
  });
  it('is false when unset (official channel by default)', () => {
    delete process.env.LARIAT_TEST_RELEASE;
    assert.equal(isTestRelease(), false);
  });
});

describe('getReleaseInfo', () => {
  it('reports the test channel when LARIAT_TEST_RELEASE is on', () => {
    process.env.LARIAT_TEST_RELEASE = '1';
    const r = getReleaseInfo();
    assert.equal(r.channel, 'test');
    assert.equal(r.testRelease, true);
    assert.equal(typeof r.version, 'string');
  });
  it('reports the official channel otherwise', () => {
    process.env.LARIAT_TEST_RELEASE = '0';
    const r = getReleaseInfo();
    assert.equal(r.channel, 'official');
    assert.equal(r.testRelease, false);
  });
});
