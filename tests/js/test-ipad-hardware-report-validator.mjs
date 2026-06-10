#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateHardwareReport,
  summarizeHardwareValidation,
} from '../../scripts/verify-ipad-hardware-report.mjs';

describe('iPad hardware report validator', () => {
  it('accepts a complete passing Gen 7 hardware report', () => {
    const report = {
      schemaVersion: 'lariat.ipadPerformanceProfile.v1',
      target: {
        baseUrl: 'http://192.168.1.25:3000',
        browserName: 'webkit',
        deviceName: 'iPad (gen 7)',
        hardwareRequired: true,
        iterations: 5,
        thresholdMs: 100,
      },
      summary: {
        flowCount: 3,
        passingFlows: 3,
        failingFlows: 0,
        hardwareAcceptanceSatisfied: false,
      },
      flows: [
        { id: 'station-pass', withinThreshold: true, summary: { count: 5, p95Ms: 84.2 } },
        { id: 'kds-send', withinThreshold: true, summary: { count: 5, p95Ms: 92.4 } },
        { id: 'eighty-six-add', withinThreshold: true, summary: { count: 5, p95Ms: 97.9 } },
      ],
    };

    const result = validateHardwareReport(report);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.perFlow['station-pass'].ok, true);
    assert.equal(result.perFlow['eighty-six-add'].p95Ms, 97.9);

    const summary = summarizeHardwareValidation(result);
    assert.match(summary, /PASS/);
    assert.match(summary, /station-pass: p95 84.2ms/);
  });

  it('fails when browser, device, or thresholds do not meet closure criteria', () => {
    const report = {
      schemaVersion: 'lariat.ipadPerformanceProfile.v1',
      target: {
        baseUrl: 'http://localhost:3000',
        browserName: 'chromium',
        deviceName: 'iPad Pro 11',
        hardwareRequired: false,
        iterations: 4,
        thresholdMs: 100,
      },
      summary: {
        flowCount: 3,
        passingFlows: 2,
        failingFlows: 1,
        hardwareAcceptanceSatisfied: false,
      },
      flows: [
        { id: 'station-pass', withinThreshold: true, summary: { count: 4, p95Ms: 70 } },
        { id: 'kds-send', withinThreshold: false, summary: { count: 5, p95Ms: 140.6 } },
      ],
    };

    const result = validateHardwareReport(report);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /webkit/i);
    assert.match(result.errors.join('\n'), /iPad \(gen 7\)/i);
    assert.match(result.errors.join('\n'), /at least 5 samples/i);
    assert.match(result.errors.join('\n'), /eighty-six-add/);
    assert.equal(result.perFlow['kds-send'].ok, false);

    const summary = summarizeHardwareValidation(result);
    assert.match(summary, /FAIL/);
    assert.match(summary, /kds-send: p95 140.6ms/);
  });
});
