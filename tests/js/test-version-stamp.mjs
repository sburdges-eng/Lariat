#!/usr/bin/env node
// Tests for scripts/version-stamp.mjs — V.I.NN.NNN build-version scheme.
// Run: node --test tests/js/test-version-stamp.mjs
//
// Scheme: vMAJOR.ITERATION.NN.NNN  (e.g. v0.1.00.001)
//   MAJOR     — breaking line
//   ITERATION — feature iteration
//   NN        — 2-digit minor, 00..99
//   NNN       — 3-digit build, 000..999 (rolls over into NN on bump)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseBuildVersion, formatBuildVersion, bumpBuild } from '../../scripts/version-stamp.mjs';

describe('parseBuildVersion', () => {
  it('parses a 4-part build version', () => {
    assert.deepStrictEqual(parseBuildVersion('0.1.00.001'), {
      major: 0,
      iteration: 1,
      nn: 0,
      nnn: 1,
    });
  });
  it('tolerates a leading v', () => {
    assert.deepStrictEqual(parseBuildVersion('v2.3.04.050'), {
      major: 2,
      iteration: 3,
      nn: 4,
      nnn: 50,
    });
  });
  it('throws on a malformed version', () => {
    assert.throws(() => parseBuildVersion('0.1.0'));
  });
});

describe('formatBuildVersion', () => {
  it('zero-pads NN to 2 and NNN to 3 with a v prefix', () => {
    assert.strictEqual(formatBuildVersion({ major: 0, iteration: 1, nn: 0, nnn: 1 }), 'v0.1.00.001');
    assert.strictEqual(formatBuildVersion({ major: 0, iteration: 1, nn: 0, nnn: 23 }), 'v0.1.00.023');
    assert.strictEqual(formatBuildVersion({ major: 1, iteration: 12, nn: 7, nnn: 400 }), 'v1.12.07.400');
  });
});

describe('bumpBuild', () => {
  it('increments NNN, returns package.json form (no v prefix)', () => {
    assert.strictEqual(bumpBuild('0.1.00.001'), '0.1.00.002');
  });
  it('rolls NNN=999 over into NN', () => {
    assert.strictEqual(bumpBuild('0.1.00.999'), '0.1.01.000');
  });
  it('round-trips through parse/format', () => {
    assert.strictEqual(formatBuildVersion(parseBuildVersion(bumpBuild('0.1.00.009'))), 'v0.1.00.010');
  });
});
