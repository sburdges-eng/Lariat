#!/usr/bin/env node
// iPad cook-surface profiler coverage.
// Run: node --test tests/js/test-ipad-performance-profile.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildReport,
  eightySixSubmitAccessibleName,
  parseArgs,
  summarizeSamples,
  SCHEMA_VERSION,
} from '../../scripts/profile-ipad-cook-surfaces.mjs';

describe('iPad performance profiler helpers', () => {
  it('parses deterministic defaults for the iPad gen 7 low-power target', () => {
    const opts = parseArgs([]);

    assert.equal(opts.baseUrl, 'http://localhost:3000');
    assert.equal(opts.browserName, 'webkit');
    assert.equal(opts.deviceName, 'iPad (gen 7)');
    assert.equal(opts.iterations, 5);
    assert.equal(opts.thresholdMs, 100);
    assert.equal(opts.hardwareRequired, true);
  });

  it('summarizes samples with stable percentile and average values', () => {
    const summary = summarizeSamples([100.4, 20.2, 50.5, 10.1, 70.7]);

    assert.deepEqual(summary, {
      count: 5,
      minMs: 10.1,
      medianMs: 50.5,
      avgMs: 50.4,
      p95Ms: 100.4,
      maxMs: 100.4,
    });
  });

  it('matches the 86 submit button aria-label for a filled item', () => {
    assert.equal(eightySixSubmitAccessibleName('Perf steak'), "Mark Perf steak as 86'd");
  });

  it('rejects output paths that escape the working tree', () => {
    assert.throws(() => parseArgs(['--out', path.join(path.sep, 'tmp', 'ipad.json')]), /--out must be relative/);
    assert.throws(() => parseArgs(['--out', '../ipad.json']), /--out must stay within/);
  });

  it('--no-hardware flips acceptance to software-only', () => {
    assert.equal(parseArgs([]).hardwareRequired, true);
    assert.equal(parseArgs(['--no-hardware']).hardwareRequired, false);
  });

  it('accepts a slash-leading route prefix for profiling the v2 tree', () => {
    assert.equal(parseArgs([]).routePrefix, '');
    assert.equal(parseArgs(['--route-prefix', '/v2']).routePrefix, '/v2');
    assert.equal(parseArgs(['--route-prefix=/v2']).routePrefix, '/v2');
    assert.throws(() => parseArgs(['--route-prefix', 'v2']), /must start with '\//);
    assert.throws(() => parseArgs(['--route-prefix', '/v2/']), /not end with one/);
  });

  it('builds schema-versioned reports and evaluates every flow threshold', () => {
    const report = buildReport({
      baseUrl: 'http://localhost:4321',
      browserName: 'chromium',
      deviceName: 'iPad (gen 7)',
      iterations: 3,
      thresholdMs: 100,
      hardwareRequired: true,
      measurements: [
        { id: 'station-pass', label: 'Station pass tap', samplesMs: [30, 40, 50] },
        { id: 'kds-send', label: 'KDS send tap', samplesMs: [70, 90, 130] },
      ],
    });

    assert.equal(Object.keys(report)[0], 'schemaVersion');
    assert.equal(report.schemaVersion, SCHEMA_VERSION);
    assert.equal(report.target.hardwareRequired, true);
    assert.equal(report.summary.passingFlows, 1);
    assert.equal(report.summary.failingFlows, 1);
    assert.equal(report.summary.hardwareAcceptanceSatisfied, false);
    assert.equal(report.flows[0].withinThreshold, true);
    assert.equal(report.flows[1].withinThreshold, false);
    assert.equal(JSON.stringify(report).includes('/Users/'), false);
  });
});
