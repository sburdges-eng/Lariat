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
  const startCalls = [];
  return {
    start(opts) {
      startCount += 1;
      startCalls.push(opts);
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
    get startCalls() { return startCalls; },
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

  // ── Env-var threading (audit 2026-05-08 §3, Cloud-bridge LOW) ────────
  //
  // bootCloudBridgeDrainer must pass LARIAT_DRAINER_TICK_MS and
  // LARIAT_DRAINER_STALE_AGE_S into startDrainer({ ... }) instead of only
  // logging the tickMs value. The standalone runner
  // (scripts/cloud-bridge-drainer.mjs) already wires both correctly; the
  // instrumentation boot path was the gap.

  describe('env-var threading into startDrainer', () => {
    let prevTickMs;
    let prevStaleAge;

    beforeEach(() => {
      prevTickMs = process.env.LARIAT_DRAINER_TICK_MS;
      prevStaleAge = process.env.LARIAT_DRAINER_STALE_AGE_S;
      delete process.env.LARIAT_DRAINER_TICK_MS;
      delete process.env.LARIAT_DRAINER_STALE_AGE_S;
    });

    afterEach(() => {
      if (prevTickMs === undefined) {
        delete process.env.LARIAT_DRAINER_TICK_MS;
      } else {
        process.env.LARIAT_DRAINER_TICK_MS = prevTickMs;
      }
      if (prevStaleAge === undefined) {
        delete process.env.LARIAT_DRAINER_STALE_AGE_S;
      } else {
        process.env.LARIAT_DRAINER_STALE_AGE_S = prevStaleAge;
      }
    });

    it('threads LARIAT_DRAINER_TICK_MS into startDrainer opts', async () => {
      process.env.LARIAT_DRAINER_TICK_MS = '5000';
      const fake = makeFakeDrainer();
      await lifecycle.bootCloudBridgeDrainer({
        customIsConfigured: () => true,
        customStartDrainer: fake.start.bind(fake),
        customStopDrainer: fake.stop.bind(fake),
      });

      assert.equal(fake.startCount, 1, 'startDrainer must be called once');
      const calledWith = fake.startCalls[0];
      assert.ok(
        calledWith && typeof calledWith === 'object',
        `expected startDrainer to be called with an opts object, got: ${JSON.stringify(calledWith)}`,
      );
      assert.equal(calledWith.tickMs, 5000, 'tickMs must be threaded as a number');
      assert.equal(
        calledWith.staleClaimAgeSec,
        300,
        'staleClaimAgeSec default (300) must still be threaded when env unset',
      );
    });

    it('threads LARIAT_DRAINER_STALE_AGE_S into startDrainer opts', async () => {
      process.env.LARIAT_DRAINER_STALE_AGE_S = '60';
      const fake = makeFakeDrainer();
      await lifecycle.bootCloudBridgeDrainer({
        customIsConfigured: () => true,
        customStartDrainer: fake.start.bind(fake),
        customStopDrainer: fake.stop.bind(fake),
      });

      const calledWith = fake.startCalls[0];
      assert.ok(calledWith && typeof calledWith === 'object');
      assert.equal(calledWith.staleClaimAgeSec, 60, 'staleClaimAgeSec must be threaded');
      assert.equal(
        calledWith.tickMs,
        30000,
        'tickMs default (30000) must still be threaded when env unset',
      );
    });

    it('applies defaults (tickMs=30000, staleClaimAgeSec=300) when both env vars unset', async () => {
      const fake = makeFakeDrainer();
      await lifecycle.bootCloudBridgeDrainer({
        customIsConfigured: () => true,
        customStartDrainer: fake.start.bind(fake),
        customStopDrainer: fake.stop.bind(fake),
      });

      const calledWith = fake.startCalls[0];
      assert.ok(calledWith && typeof calledWith === 'object');
      assert.equal(calledWith.tickMs, 30000);
      assert.equal(calledWith.staleClaimAgeSec, 300);
    });

    it('log line reflects both tickMs and staleClaimAgeSec values', async () => {
      process.env.LARIAT_DRAINER_TICK_MS = '5000';
      process.env.LARIAT_DRAINER_STALE_AGE_S = '60';
      const fake = makeFakeDrainer();
      await lifecycle.bootCloudBridgeDrainer({
        customIsConfigured: () => true,
        customStartDrainer: fake.start.bind(fake),
        customStopDrainer: fake.stop.bind(fake),
      });

      const startedLine = logCapture.lines.find((l) => /drainer started/.test(l));
      assert.ok(
        startedLine,
        `expected a "drainer started" log line, got: ${JSON.stringify(logCapture.lines)}`,
      );
      assert.match(startedLine, /tickMs=5000/);
      assert.match(startedLine, /staleClaimAgeSec=60/);
    });
  });
});
