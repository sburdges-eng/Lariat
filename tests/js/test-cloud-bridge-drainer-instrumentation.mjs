#!/usr/bin/env node
// Tests for the cloud-bridge drainer lifecycle helper.
//
// Scope: idempotency of bootCloudBridgeDrainer, single SIGTERM/SIGINT
// registration, the "bridge not configured" no-op branch, and the
// dependency-injection seam used to keep these tests off SQLite + fetch.
//
// We deliberately do NOT exercise the real `lib/cloudBridgeDrainer.ts`
// here — `tests/js/test-cloud-bridge-drainer.mjs` covers the tick loop
// against a real in-memory SQLite. This file pins lifecycle behaviour
// the same way `test-mdns-autostart.mjs` pins mDNS lifecycle.
//
// Run:
//   node --experimental-strip-types --test \
//     tests/js/test-cloud-bridge-drainer-instrumentation.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const lifecycle = await import('../../lib/cloudBridgeDrainerLifecycle.ts');

// ── Test fixtures ──────────────────────────────────────────────────────

function makeFakeDrainer() {
  let startCount = 0;
  let stopCount = 0;
  let running = false;
  return {
    start() {
      startCount += 1;
      running = true;
      return {
        start() { /* re-arm — no-op for fake */ },
        stop() { running = false; stopCount += 1; },
        tick: async () => ({ swept: 0, claimed: 0, outcome: 'no-op' }),
        isRunning() { return running; },
      };
    },
    stop() {
      stopCount += 1;
      running = false;
    },
    get startCount() { return startCount; },
    get stopCount() { return stopCount; },
    get running() { return running; },
  };
}

// Snapshot+restore signal listeners so tests don't bleed handlers into
// the harness process.
function snapshotListeners(signal) {
  return process.listeners(signal).slice();
}

function restoreListeners(signal, snapshot) {
  for (const l of process.listeners(signal)) {
    if (!snapshot.includes(l)) {
      process.removeListener(signal, l);
    }
  }
}

// Silence the lifecycle's console.log so tests don't pollute output —
// but keep recording the lines so we can assert on them.
function captureConsoleLog() {
  const original = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore() {
      console.log = original;
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('cloudBridgeDrainerLifecycle', () => {
  let sigtermSnap;
  let sigintSnap;
  let logCapture;

  beforeEach(() => {
    lifecycle._resetForTests();
    sigtermSnap = snapshotListeners('SIGTERM');
    sigintSnap = snapshotListeners('SIGINT');
    logCapture = captureConsoleLog();
  });

  afterEach(() => {
    lifecycle._resetForTests();
    restoreListeners('SIGTERM', sigtermSnap);
    restoreListeners('SIGINT', sigintSnap);
    logCapture.restore();
  });

  it('skips with a one-line log when bridge is not configured', async () => {
    const fake = makeFakeDrainer();
    await lifecycle.bootCloudBridgeDrainer({
      customIsConfigured: () => false,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    });

    assert.equal(fake.startCount, 0, 'startDrainer must not run when unconfigured');
    assert.ok(
      logCapture.lines.some((l) => /drainer skipped/.test(l)),
      `expected a "drainer skipped" log line, got: ${JSON.stringify(logCapture.lines)}`,
    );
  });

  it('starts the drainer and logs status when configured', async () => {
    const fake = makeFakeDrainer();
    await lifecycle.bootCloudBridgeDrainer({
      customIsConfigured: () => true,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    });

    assert.equal(fake.startCount, 1, 'startDrainer must run exactly once');
    assert.ok(
      logCapture.lines.some((l) => /drainer started \(tickMs=/.test(l)),
      `expected a "drainer started" log line, got: ${JSON.stringify(logCapture.lines)}`,
    );
  });

  it('boot twice does not double-arm the drainer', async () => {
    const fake = makeFakeDrainer();
    const opts = {
      customIsConfigured: () => true,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    };

    await lifecycle.bootCloudBridgeDrainer(opts);
    await lifecycle.bootCloudBridgeDrainer(opts);
    await lifecycle.bootCloudBridgeDrainer(opts);

    assert.equal(
      fake.startCount,
      1,
      'startDrainer must run exactly once across HMR-style repeat boots',
    );
  });

  it('SIGTERM and SIGINT handlers are registered exactly once across many boots', async () => {
    const fake = makeFakeDrainer();
    const opts = {
      customIsConfigured: () => true,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    };

    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');

    await lifecycle.bootCloudBridgeDrainer(opts);
    await lifecycle.bootCloudBridgeDrainer(opts);
    await lifecycle.bootCloudBridgeDrainer(opts);

    const afterTerm = process.listenerCount('SIGTERM');
    const afterInt = process.listenerCount('SIGINT');

    assert.equal(
      afterTerm - beforeTerm,
      1,
      'exactly one SIGTERM listener must be added regardless of boot count',
    );
    assert.equal(
      afterInt - beforeInt,
      1,
      'exactly one SIGINT listener must be added regardless of boot count',
    );
  });

  it('skip-when-unconfigured does NOT install signal handlers', async () => {
    const fake = makeFakeDrainer();

    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');

    await lifecycle.bootCloudBridgeDrainer({
      customIsConfigured: () => false,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    });

    const afterTerm = process.listenerCount('SIGTERM');
    const afterInt = process.listenerCount('SIGINT');

    assert.equal(afterTerm, beforeTerm, 'no SIGTERM listener when skipped');
    assert.equal(afterInt, beforeInt, 'no SIGINT listener when skipped');
  });

  it('after _resetForTests, the next boot re-runs startDrainer', async () => {
    const fake = makeFakeDrainer();
    const opts = {
      customIsConfigured: () => true,
      customStartDrainer: fake.start.bind(fake),
      customStopDrainer: fake.stop.bind(fake),
    };

    await lifecycle.bootCloudBridgeDrainer(opts);
    lifecycle._resetForTests();
    await lifecycle.bootCloudBridgeDrainer(opts);

    assert.equal(fake.startCount, 2, 'reset must let startDrainer run again');
  });
});
