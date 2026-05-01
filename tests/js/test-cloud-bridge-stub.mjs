#!/usr/bin/env node
// Tests for the cloud-bridge stub.
//
// Today these tests pin the contract:
//   - createCloudBridge() returns the right shape.
//   - pushSnapshot / pullSnapshot throw the documented sentinel.
//   - status() returns the empty-state object.
//   - GET /api/cloud-bridge/status returns 401 without a PIN cookie
//     (when LARIAT_PIN is configured).
//
// When the next PR replaces the stub with a real client, most of
// these tests should be ported to characterize the real behavior;
// the contract-shape and PIN-gate tests stay as regressions.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-cloud-bridge-stub.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const cloudBridge = await import('../../lib/cloudBridge.ts');
const { createCloudBridge, isCloudBridgeConfigured, CLOUD_BRIDGE_NOT_IMPLEMENTED } =
  cloudBridge;

const route = await import('../../app/api/cloud-bridge/status/route.js');
const { GET } = route;

// ─────────────────────────────────────────────────────────────────
// Library surface
// ─────────────────────────────────────────────────────────────────

describe('createCloudBridge — stub shape', () => {
  it('returns an object with push / pull / status methods', () => {
    const bridge = createCloudBridge();
    assert.equal(typeof bridge.pushSnapshot, 'function');
    assert.equal(typeof bridge.pullSnapshot, 'function');
    assert.equal(typeof bridge.status, 'function');
  });

  it('pushSnapshot throws the not-implemented sentinel', async () => {
    const bridge = createCloudBridge();
    await assert.rejects(
      () => bridge.pushSnapshot('settlement_summaries', [], { locationId: 'default' }),
      (err) => err instanceof Error && err.message === CLOUD_BRIDGE_NOT_IMPLEMENTED,
    );
  });

  it('pullSnapshot throws the not-implemented sentinel', async () => {
    const bridge = createCloudBridge();
    await assert.rejects(
      () =>
        bridge.pullSnapshot('settlement_summaries', {
          locationId: 'default',
          since: '2026-01-01T00:00:00Z',
        }),
      (err) => err instanceof Error && err.message === CLOUD_BRIDGE_NOT_IMPLEMENTED,
    );
  });

  it('status() returns the empty-state shape', async () => {
    const bridge = createCloudBridge();
    const s = await bridge.status();
    assert.deepStrictEqual(s, {
      lastPushAt: null,
      lastPullAt: null,
      queueDepth: 0,
      lastError: null,
    });
  });
});

describe('isCloudBridgeConfigured', () => {
  it('returns false when neither apiKey nor baseUrl is set', () => {
    // Use explicit args so test doesn't depend on the host env.
    assert.equal(isCloudBridgeConfigured({ apiKey: undefined, baseUrl: undefined }), false);
  });

  it('returns true only when both apiKey and baseUrl are set', () => {
    assert.equal(isCloudBridgeConfigured({ apiKey: 'k', baseUrl: undefined }), false);
    assert.equal(isCloudBridgeConfigured({ apiKey: undefined, baseUrl: 'u' }), false);
    assert.equal(isCloudBridgeConfigured({ apiKey: 'k', baseUrl: 'u' }), true);
  });
});

// ─────────────────────────────────────────────────────────────────
// PIN gate on GET /api/cloud-bridge/status
//
// The route uses pinRequiredForPic() which keys off LARIAT_PIN.
// We force the PIN on for this block so the gate is exercised
// regardless of the host env.
// ─────────────────────────────────────────────────────────────────

describe('GET /api/cloud-bridge/status — PIN gate', () => {
  let prevPin;
  before(() => {
    prevPin = process.env.LARIAT_PIN;
    process.env.LARIAT_PIN = '0000';
  });
  after(() => {
    if (prevPin === undefined) delete process.env.LARIAT_PIN;
    else process.env.LARIAT_PIN = prevPin;
  });

  it('returns 401 with no cookie', async () => {
    const req = new Request('http://localhost/api/cloud-bridge/status');
    const res = await GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /PIN required/);
  });

  it('returns 401 with a forged unsigned cookie when PIN_SECRET is set', async () => {
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN_SECRET = 'test-secret-please-ignore';
    try {
      const req = new Request('http://localhost/api/cloud-bridge/status', {
        headers: { cookie: 'lariat_pin_ok=1' },
      });
      const res = await GET(req);
      assert.equal(res.status, 401);
    } finally {
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });
});
