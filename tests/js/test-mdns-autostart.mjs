#!/usr/bin/env node
// Tests for the mDNS auto-start lifecycle helper.
//
// Scope: idempotency of startAdvertiseOnce / stopAdvertiseOnce, single
// SIGTERM/SIGINT registration, and the dependency-injection seam used to
// keep these tests off the multicast network. We deliberately do NOT
// exercise the real `bonjour-service` here — `tests/js/test-mdns-discovery.mjs`
// already covers that path; this file pins lifecycle behaviour.
//
// Run: node --experimental-strip-types --test tests/js/test-mdns-autostart.mjs
//
// Why dependency injection over global stash for stubbing: the lifecycle
// module exposes a `customAdvertise` injection point so tests can swap in
// a fake `advertise()` without touching globalThis (which the production
// code uses for HMR-survival). Conflating those two roles in one global
// would let test fakes bleed across `node --test` files via module-cache
// reuse. DI keeps the test surface explicit.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const lifecycle = await import('../../lib/mdnsAdvertiseLifecycle.ts');

// ── Test fixtures ──────────────────────────────────────────────────────

function makeFakeHandle() {
  let active = true;
  let stopCount = 0;
  return {
    get active() {
      return active;
    },
    get stopCount() {
      return stopCount;
    },
    async stop() {
      stopCount += 1;
      active = false;
    },
  };
}

function makeFakeAdvertise() {
  let callCount = 0;
  const handles = [];
  const fake = async () => {
    callCount += 1;
    const h = makeFakeHandle();
    handles.push(h);
    return h;
  };
  return {
    fake,
    get callCount() {
      return callCount;
    },
    get handles() {
      return handles;
    },
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

// ── Tests ──────────────────────────────────────────────────────────────

describe('mdnsAdvertiseLifecycle', () => {
  let sigtermSnap;
  let sigintSnap;

  beforeEach(async () => {
    // Make sure each test starts with a clean stash so order doesn't matter.
    await lifecycle.stopAdvertiseOnce();
    lifecycle._resetForTests();
    sigtermSnap = snapshotListeners('SIGTERM');
    sigintSnap = snapshotListeners('SIGINT');
  });

  afterEach(async () => {
    await lifecycle.stopAdvertiseOnce();
    lifecycle._resetForTests();
    restoreListeners('SIGTERM', sigtermSnap);
    restoreListeners('SIGINT', sigintSnap);
  });

  it('startAdvertiseOnce twice does not double-register the handle', async () => {
    const adv = makeFakeAdvertise();
    const opts = { port: 3000, locationId: 'test', version: '0.0.0' };

    const h1 = await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });
    const h2 = await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });

    assert.equal(adv.callCount, 1, 'advertise() must run exactly once');
    assert.strictEqual(h1, h2, 'second call must return the cached handle');
    assert.equal(h1.active, true);
  });

  it('start then stop clears the stash; next start re-creates a handle', async () => {
    const adv = makeFakeAdvertise();
    const opts = { port: 3000, locationId: 'test', version: '0.0.0' };

    const first = await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });
    await lifecycle.stopAdvertiseOnce();
    assert.equal(first.stopCount, 1, 'stop() must be invoked on the cached handle');
    assert.equal(first.active, false);

    const second = await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });
    assert.equal(adv.callCount, 2, 'advertise() must run again after stop');
    assert.notStrictEqual(first, second, 'a fresh handle is expected after stop');
  });

  it('stopAdvertiseOnce is idempotent when nothing is running', async () => {
    // Must not throw even if start was never called.
    await lifecycle.stopAdvertiseOnce();
    await lifecycle.stopAdvertiseOnce();
  });

  it('SIGTERM and SIGINT handlers are registered exactly once across many starts', async () => {
    const adv = makeFakeAdvertise();
    const opts = { port: 3000, locationId: 'test', version: '0.0.0' };

    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');

    await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });
    await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });
    await lifecycle.startAdvertiseOnce(opts, { customAdvertise: adv.fake });

    const afterTerm = process.listenerCount('SIGTERM');
    const afterInt = process.listenerCount('SIGINT');

    assert.equal(
      afterTerm - beforeTerm,
      1,
      'exactly one SIGTERM listener must be added regardless of start count'
    );
    assert.equal(
      afterInt - beforeInt,
      1,
      'exactly one SIGINT listener must be added regardless of start count'
    );
  });

  it('a no-op handle (active=false) is still cached so we do not retry on every call', async () => {
    // Simulates the "multicast unavailable" branch from advertise(): the
    // lifecycle should still cache the handle to avoid re-attempting on
    // every page render in HMR.
    let callCount = 0;
    const customAdvertise = async () => {
      callCount += 1;
      return {
        active: false,
        async stop() {
          /* no-op */
        },
      };
    };

    const opts = { port: 3000, locationId: 'test', version: '0.0.0' };
    await lifecycle.startAdvertiseOnce(opts, { customAdvertise });
    await lifecycle.startAdvertiseOnce(opts, { customAdvertise });
    assert.equal(callCount, 1, 'failed advertise must still be cached');
  });
});
