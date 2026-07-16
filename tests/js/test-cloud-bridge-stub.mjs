#!/usr/bin/env node
// Tests for the cloud-bridge surface (lib/cloudBridge.ts).
//
// The push direction is the queue (cloudBridgeQueue.enqueue + the Item-8
// drainer); the direct-push pushSnapshot affordance was retired. pullSnapshot
// still throws the CLOUD_BRIDGE_NOT_IMPLEMENTED sentinel unconditionally —
// pull is v2.
//
// These tests pin the unconfigured behavior + interface shape. The HTTP
// client (configured path) is exercised by tests/js/test-cloud-bridge-push.mjs
// against a stub server; this file does not double-cover that.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-cloud-bridge-stub.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

// Force the unconfigured path regardless of host env so the sentinel
// assertions don't depend on whoever's machine is running the test.
const SAVED_BRIDGE_SECRET = process.env.LARIAT_CLOUD_BRIDGE_SECRET;
const SAVED_BRIDGE_URL = process.env.LARIAT_CLOUD_BRIDGE_URL;
delete process.env.LARIAT_CLOUD_BRIDGE_SECRET;
delete process.env.LARIAT_CLOUD_BRIDGE_URL;
process.on('exit', () => {
  if (SAVED_BRIDGE_SECRET !== undefined) process.env.LARIAT_CLOUD_BRIDGE_SECRET = SAVED_BRIDGE_SECRET;
  if (SAVED_BRIDGE_URL !== undefined) process.env.LARIAT_CLOUD_BRIDGE_URL = SAVED_BRIDGE_URL;
});

const cloudBridge = await import('../../lib/cloudBridge.ts');
const { createCloudBridge, isCloudBridgeConfigured, CLOUD_BRIDGE_NOT_IMPLEMENTED } =
  cloudBridge;

const route = await import('../../app/api/cloud-bridge/status/route.js');
const { GET } = route;

// ─────────────────────────────────────────────────────────────────
// Library surface
// ─────────────────────────────────────────────────────────────────

describe('createCloudBridge — stub shape', () => {
  it('returns an object with pull / status methods (push is the queue path)', () => {
    const bridge = createCloudBridge();
    assert.equal(typeof bridge.pullSnapshot, 'function');
    assert.equal(typeof bridge.status, 'function');
  });

  it('pullSnapshot throws the not-implemented sentinel', async () => {
    const bridge = createCloudBridge();
    await assert.rejects(
      () =>
        bridge.pullSnapshot('beo_events', {
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
  it('returns false when neither secret nor baseUrl is set', () => {
    // Use explicit args so test doesn't depend on the host env.
    assert.equal(isCloudBridgeConfigured({ secret: undefined, baseUrl: undefined }), false);
  });

  it('returns true only when both secret and baseUrl are set', () => {
    assert.equal(isCloudBridgeConfigured({ secret: 'k', baseUrl: undefined }), false);
    assert.equal(isCloudBridgeConfigured({ secret: undefined, baseUrl: 'u' }), false);
    assert.equal(isCloudBridgeConfigured({ secret: 'k', baseUrl: 'u' }), true);
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
