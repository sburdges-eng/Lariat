#!/usr/bin/env node
// Tests for lib/peers.ts (loadPeersAndHub helper) and app/api/peers/route.js.
//
// Run: node --experimental-strip-types --test tests/js/test-peers-route.mjs
//
// The helper is a thin wrapper around discover() + electHub() that exists
// purely so we can stub the network seam in tests — discover() itself
// returns [] in CI (no multicast), so without an injectable seam we couldn't
// exercise the "with peers" code path. The route is then a thin wrapper
// around the helper that parses + clamps the ?timeout=<ms> query param.
//
// We register the project's test resolver so extensionless relative imports
// inside the route/helper modules (Next.js convention) resolve under
// node:test, matching what other tests in this directory do.

import { register } from 'node:module';
register(new URL('./resolver.mjs', import.meta.url));

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { loadPeersAndHub } = await import('../../lib/peers.ts');
const { electHub } = await import('../../lib/hubElection.ts');
const { GET } = await import('../../app/api/peers/route.js');

/**
 * Build a DiscoveredInstance with sensible defaults; override any field via
 * the optional partial. Mirrors the helper used by test-hub-election.mjs so
 * the inputs to electHub() match what the production discover() emits.
 */
function peer(overrides = {}) {
  const {
    name = 'Lariat',
    host = 'lariat.local.',
    addresses = ['192.168.1.10'],
    port = 3000,
    version,
    location_id = 'default',
    started_at,
    pubkey_fp,
  } = overrides;
  const txt = { location_id };
  if (version !== undefined) txt.version = version;
  if (started_at !== undefined) txt.started_at = started_at;
  if (pubkey_fp !== undefined) txt.pubkey_fp = pubkey_fp;
  return { name, host, addresses, port, txt };
}

/** Build a Request whose URL has the given query string. */
function reqWithQuery(qs) {
  const url = `http://localhost:3000/api/peers${qs ? `?${qs}` : ''}`;
  return new Request(url);
}

describe('loadPeersAndHub helper', () => {
  it('returns {peers: [], hub: null} when discoverFn yields no peers', async () => {
    const calls = [];
    const result = await loadPeersAndHub({
      discoverFn: async opts => {
        calls.push(opts);
        return [];
      },
    });
    assert.deepEqual(result, { peers: [], hub: null });
    assert.equal(calls.length, 1);
  });

  it('returns the single peer as both the only peer and the hub', async () => {
    const only = peer({
      name: 'Lariat',
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const result = await loadPeersAndHub({
      discoverFn: async () => [only],
    });
    assert.deepEqual(result.peers, [only]);
    assert.equal(result.hub, only);
  });

  it('elects the hub consistent with electHub() over the same input', async () => {
    const newest = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const oldest = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-01T08:00:00.000Z',
    });
    const middle = peer({
      name: 'Lariat (3)',
      addresses: ['192.168.1.12'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const peers = [newest, middle, oldest];
    const result = await loadPeersAndHub({
      discoverFn: async () => peers,
    });
    assert.deepEqual(result.peers, peers);
    assert.equal(result.hub, electHub(peers));
    assert.equal(result.hub, oldest);
  });

  it('passes timeoutMs through to discoverFn', async () => {
    let received;
    await loadPeersAndHub({
      timeoutMs: 1234,
      discoverFn: async opts => {
        received = opts;
        return [];
      },
    });
    assert.deepEqual(received, { timeoutMs: 1234 });
  });

  it('passes undefined timeoutMs through when none is supplied', async () => {
    let received;
    await loadPeersAndHub({
      discoverFn: async opts => {
        received = opts;
        return [];
      },
    });
    assert.deepEqual(received, { timeoutMs: undefined });
  });

  it('preserves pubkey_fp on each peer through to the result', async () => {
    // The Item 13 contract: clients of /api/peers can read
    // peer.txt.pubkey_fp directly. The route does a verbatim JSON
    // passthrough, so the helper must not strip the field.
    const a = peer({
      host: 'host-a.local.',
      started_at: '2026-05-05T12:00:00.000Z',
      pubkey_fp: 'a1b2c3d4e5f60718',
    });
    const b = peer({
      host: 'host-b.local.',
      started_at: '2026-05-05T13:00:00.000Z',
      pubkey_fp: 'fedcba9876543210',
    });
    const result = await loadPeersAndHub({
      discoverFn: async () => [a, b],
    });
    assert.equal(result.peers[0].txt.pubkey_fp, 'a1b2c3d4e5f60718');
    assert.equal(result.peers[1].txt.pubkey_fp, 'fedcba9876543210');
  });

  it('treats a peer without pubkey_fp as undefined (back-compat)', async () => {
    const noFp = peer({ host: 'legacy.local.' });
    const result = await loadPeersAndHub({
      discoverFn: async () => [noFp],
    });
    assert.equal(result.peers[0].txt.pubkey_fp, undefined);
  });
});

describe('GET /api/peers route', () => {
  it('returns {peers: [], hub: null} on a default call (CI has no multicast)', async () => {
    const res = await GET(reqWithQuery(''));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null });
  });

  it('accepts ?timeout=1500 and returns the empty-state shape', async () => {
    const res = await GET(reqWithQuery('timeout=1500'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null });
  });

  it('rejects ?timeout=-1 without crashing (clamps and returns shape)', async () => {
    const res = await GET(reqWithQuery('timeout=-1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null });
  });

  it('rejects ?timeout=foo without crashing (clamps and returns shape)', async () => {
    const res = await GET(reqWithQuery('timeout=foo'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null });
  });

  it('clamps ?timeout=99999 to the cap and returns the shape', async () => {
    const res = await GET(reqWithQuery('timeout=99999'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null });
  });
});
