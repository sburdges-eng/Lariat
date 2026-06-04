#!/usr/bin/env node
// Tests for the mDNS hub-discovery stub.
//
// Scope: handle shape + graceful no-op when multicast is unavailable +
// /api/discover GET response shape. We deliberately do NOT test
// cross-host discovery — that's network-dependent and would make CI
// require real multicast.
//
// Run: node --experimental-strip-types --test tests/js/test-mdns-discovery.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const mdns = await import('../../lib/mdnsDiscovery.ts');
const route = await import('../../app/api/discover/route.js');

const handles = [];
after(async () => {
  for (const h of handles) {
    try {
      await h.stop();
    } catch {
      /* ignore */
    }
  }
});

describe('mdnsDiscovery.advertise', () => {
  it('returns a handle with active flag and async stop()', async () => {
    // Use a high arbitrary port — we never actually bind anything there,
    // it's only what gets advertised in the SRV record. Real port = real
    // happy-path coverage on hosts that have multicast.
    const handle = await mdns.advertise({ port: 38731, locationId: 'test' });
    handles.push(handle);
    assert.equal(typeof handle.active, 'boolean');
    assert.equal(typeof handle.stop, 'function');
    // stop() must be idempotent and never throw.
    await handle.stop();
    await handle.stop();
    assert.equal(handle.active, false);
  });

  it('does not throw when bonjour rejects bad config (degrades to no-op)', async () => {
    // We can't reliably force "no multicast" in CI, but we CAN force the
    // failure branch by handing bonjour-service a config it rejects
    // (port 0 fails its internal validator). The contract this pins:
    // advertise() always RESOLVES with a valid handle, never rejects,
    // and the handle reports active=false when publish failed.
    const handle = await mdns.advertise({ port: 0, locationId: 'test-2' });
    handles.push(handle);
    assert.ok(handle, 'advertise() must always resolve to a handle');
    assert.equal(handle.active, false, 'invalid config should degrade to no-op');
    await handle.stop(); // must still be safe to call
  });

  it('accepts pubkeyFp without throwing (TXT record gains pubkey_fp)', async () => {
    // We can't directly inspect bonjour-service's published TXT in
    // unit tests, but the handle contract is: advertise() must accept
    // the optional pubkeyFp option without rejecting and return a
    // valid handle. The on-the-wire assertion lives in the manual
    // smoke test (`dns-sd -L`) documented in the Item 13 plan.
    const handle = await mdns.advertise({
      port: 38741,
      locationId: 'test-fp',
      pubkeyFp: 'a1b2c3d4e5f60718',
    });
    handles.push(handle);
    assert.ok(handle, 'advertise() must always resolve to a handle');
    assert.equal(typeof handle.active, 'boolean');
    await handle.stop();
  });
});

describe('mdnsDiscovery status', () => {
  it('retains service-name conflict state for operator-facing health checks', () => {
    mdns._resetWarnedReasonsForTest();
    mdns._resetStatusForTest();

    mdns.warnOnce(
      'Bonjour publish failed',
      new Error('Service name is already in use on the network')
    );

    const status = mdns.getMdnsStatus();
    assert.equal(status.ok, false);
    assert.equal(status.code, 'service_name_conflict');
    assert.match(status.error, /already in use/i);

    mdns._resetStatusForTest();
  });
});

describe('mdnsDiscovery.discover', () => {
  it('resolves to an array within the timeout (never rejects)', async () => {
    const t0 = Date.now();
    const peers = await mdns.discover({ timeoutMs: 100 });
    const elapsed = Date.now() - t0;
    assert.ok(Array.isArray(peers), 'discover() must return an array');
    // Allow generous slack for slow CI; the contract is "bounded by timeout".
    assert.ok(elapsed < 5000, `discover() should be bounded by timeout (took ${elapsed}ms)`);
  });
});

describe('GET /api/discover', () => {
  it('returns the local instance identity in the documented shape', async () => {
    const req = new Request('http://localhost/api/discover');
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'lariat');
    assert.equal(typeof body.version, 'string');
    assert.equal(typeof body.location_id, 'string');
    assert.equal(typeof body.started_at, 'string');
    // started_at must be a valid ISO timestamp — peers parse this.
    assert.ok(
      !Number.isNaN(Date.parse(body.started_at)),
      `started_at must be a valid ISO date: ${body.started_at}`
    );
  });

  it('reports location_id from LARIAT_LOCATION_ID env when set', async () => {
    const prev = process.env.LARIAT_LOCATION_ID;
    process.env.LARIAT_LOCATION_ID = 'upstairs';
    try {
      const res = await route.GET(new Request('http://localhost/api/discover'));
      const body = await res.json();
      assert.equal(body.location_id, 'upstairs');
    } finally {
      if (prev === undefined) delete process.env.LARIAT_LOCATION_ID;
      else process.env.LARIAT_LOCATION_ID = prev;
    }
  });
});
