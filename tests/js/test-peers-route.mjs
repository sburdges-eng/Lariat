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
const { GET, redactPeerForUnauth, buildPeersResponse } = await import(
  '../../app/api/peers/route.js'
);

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
  it('returns redacted empty-shape on un-PIN\'d default call (CI has no multicast)', async () => {
    // Without a PIN cookie the route flips into redacted mode, even when
    // peers is empty. The flag is what un-PIN\'d UI surfaces key on to
    // know they cannot trust the host/version/pubkey_fp fields.
    const res = await GET(reqWithQuery(''));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null, redacted: true });
  });

  it('accepts ?timeout=1500 and returns the redacted empty-state shape', async () => {
    const res = await GET(reqWithQuery('timeout=1500'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null, redacted: true });
  });

  it('rejects ?timeout=-1 without crashing (clamps and returns shape)', async () => {
    const res = await GET(reqWithQuery('timeout=-1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null, redacted: true });
  });

  it('rejects ?timeout=foo without crashing (clamps and returns shape)', async () => {
    const res = await GET(reqWithQuery('timeout=foo'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null, redacted: true });
  });

  it('clamps ?timeout=99999 to the cap and returns the shape', async () => {
    const res = await GET(reqWithQuery('timeout=99999'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { peers: [], hub: null, redacted: true });
  });

  it('PIN\'d (legacy unsigned cookie, no LARIAT_PIN_SECRET) returns un-redacted shape', async () => {
    // The legacy `lariat_pin_ok=1` cookie is accepted by hasValidPinCookie
    // only when LARIAT_PIN_SECRET is unset (pinCookie deployment-safety
    // fallback). CI runs with no env vars, so this exercises the auth path
    // without needing to sign an HMAC value.
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    delete process.env.LARIAT_PIN_SECRET;
    try {
      const req = new Request('http://localhost:3000/api/peers', {
        headers: { cookie: 'lariat_pin_ok=1' },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { peers: [], hub: null });
      assert.equal(body.redacted, undefined);
    } finally {
      if (prevSecret !== undefined) process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });
});

describe('redactPeerForUnauth (issue #253)', () => {
  // GH #253: an unauth GET /api/peers must not leak the long-term identity
  // (pubkey_fp), the host:port, or the version string. This redaction is
  // what stops a LAN attacker from enumerating the cluster topology and
  // building a target list for the signed-sync handshake.

  it('strips pubkey_fp, host, port, version, addresses from a full peer', () => {
    const full = peer({
      name: 'Lariat (POS Mac)',
      host: 'host-a.local.',
      port: 3000,
      addresses: ['192.168.1.10'],
      version: '2026.05',
      started_at: '2026-05-05T12:00:00.000Z',
      pubkey_fp: 'a1b2c3d4e5f60718',
    });
    const out = redactPeerForUnauth(full);
    assert.equal(out.name, 'Lariat (POS Mac)');
    assert.equal(out.txt.location_id, 'default');
    assert.equal(out.txt.started_at, '2026-05-05T12:00:00.000Z');
    // The fields the issue explicitly named MUST be absent.
    assert.equal(out.host, undefined);
    assert.equal(out.port, undefined);
    assert.equal(out.addresses, undefined);
    assert.equal(out.txt.version, undefined);
    assert.equal(out.txt.pubkey_fp, undefined);
  });

  it('omits location_id + started_at keys entirely when source has them as non-string', () => {
    // Defensive — if discover() ever returns a row whose TXT record lost a
    // string typecast, we don't want `undefined` keys serializing through.
    const broken = { name: 'X', host: 'h', port: 1, addresses: [], txt: {} };
    const out = redactPeerForUnauth(broken);
    assert.deepEqual(out, { name: 'X', txt: {} });
  });

  it('coerces missing name to empty string', () => {
    // The route always serializes JSON; downstream UIs assume `name` is a
    // string. An undefined name on a malformed mDNS row degrades to '' instead
    // of breaking JSON.stringify or rendering "undefined".
    const out = redactPeerForUnauth({ host: 'h', port: 1, addresses: [], txt: {} });
    assert.equal(out.name, '');
  });
});

describe('buildPeersResponse (issue #253 shape decider)', () => {
  it('returns the verbatim shape when pinOk is true', () => {
    const peers = [
      peer({ host: 'host-a.local.', pubkey_fp: 'a1b2c3d4e5f60718' }),
    ];
    const hub = peers[0];
    const out = buildPeersResponse(peers, hub, { pinOk: true });
    assert.deepEqual(out, { peers, hub });
    // The pubkey_fp the audit flagged should still be available to PIN'd
    // callers — that's the whole point of branching rather than rewriting
    // the response shape for everyone.
    assert.equal(out.peers[0].txt.pubkey_fp, 'a1b2c3d4e5f60718');
  });

  it('redacts peers and drops the hub when pinOk is false', () => {
    const peers = [
      peer({ host: 'host-a.local.', pubkey_fp: 'a1b2c3d4e5f60718' }),
      peer({ host: 'host-b.local.', pubkey_fp: 'fedcba9876543210' }),
    ];
    const hub = peers[0];
    const out = buildPeersResponse(peers, hub, { pinOk: false });
    assert.equal(out.redacted, true);
    assert.equal(out.hub, null);
    assert.equal(out.peers.length, 2);
    for (const p of out.peers) {
      assert.equal(p.host, undefined);
      assert.equal(p.port, undefined);
      assert.equal(p.addresses, undefined);
      assert.equal(p.txt.version, undefined);
      assert.equal(p.txt.pubkey_fp, undefined);
    }
  });
});
