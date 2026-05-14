#!/usr/bin/env node
// Tests for lib/syncClient.ts (T7c).
//
// Verifies the client builds the same signed-request contract the
// server-side authenticateSyncRequest expects. Uses an in-process
// "fetch" that routes straight into route.GET so the round-trip
// exercises both halves without spinning up an HTTP server.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-client.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { fetchSyncSince } = await import('../../lib/syncClient.ts');
const { addPeer } = await import('../../lib/peerTrust.ts');
const { appendOp } = await import('../../lib/syncFeed.ts');
const route = await import('../../app/api/peers/sync-since/route.js');

beforeEach(() => {
  db.exec(`
    DELETE FROM peer_trust;
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
  `);
});

function mkKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub_spki = publicKey.export({ type: 'spki', format: 'der' });
  const priv_pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubKey = Buffer.from(pub_spki).subarray(pub_spki.length - 32);
  const privKey = Buffer.from(priv_pkcs8).subarray(priv_pkcs8.length - 32);
  return { pubKey, pubHex: pubKey.toString('hex'), privKey };
}

/**
 * In-process fetch shim that dispatches /api/peers/sync-since GET
 * straight at the route handler. Returns the route's Response so
 * fetchSyncSince's parsing path runs end-to-end.
 */
function inProcessFetch(url, init) {
  return route.GET(new Request(url, init));
}

// ─────────────────────────────────────────────────────────────────
// fetchSyncSince — happy path round-trip
// ─────────────────────────────────────────────────────────────────

describe('fetchSyncSince', () => {
  it('happy path: signed request lands ops back', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex, 'tablet-1');
    db.transaction(() => {
      appendOp({
        opId: 'op-1', tableName: 'cooling_log', locationId: 'default',
        opKind: 'insert', rowPk: '1', rowJson: '{}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'lariat-tablet-1', sourceStartedAt: '2026-05-06T00:00:00Z',
      });
      appendOp({
        opId: 'op-2', tableName: 'cooling_log', locationId: 'default',
        opKind: 'insert', rowPk: '2', rowJson: '{}',
        createdAt: '2026-05-06T00:00:01Z',
        sourceHost: 'lariat-tablet-1', sourceStartedAt: '2026-05-06T00:00:00Z',
      });
    })();

    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: inProcessFetch,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return; // narrow for ts/types
    assert.equal(res.peerId, 'hub');
    assert.equal(res.fromOp, 0);
    assert.equal(res.ops.length, 2);
    assert.equal(res.nextOp, null);
    assert.ok(res.callerFingerprint.length > 0);
  });

  it('untrusted peer → ok:false with HTTP 401', async () => {
    const k = mkKeypair(); // never added to peer_trust
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: inProcessFetch,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 401);
  });

  it('respects limit parameter', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    db.transaction(() => {
      for (let i = 0; i < 5; i++) {
        appendOp({
          opId: `op-${i}`, tableName: 'cooling_log', locationId: 'default',
          opKind: 'insert', rowPk: String(i), rowJson: '{}',
          createdAt: '2026-05-06T00:00:00Z',
          sourceHost: 'h', sourceStartedAt: '2026-05-06T00:00:00Z',
        });
      }
    })();

    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      limit: 2,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: inProcessFetch,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.ops.length, 2);
    assert.equal(typeof res.nextOp, 'number');
  });

  it('clamps negative fromOp to 0', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    db.transaction(() => {
      appendOp({
        opId: 'only', tableName: 'cooling_log', locationId: 'default',
        opKind: 'insert', rowPk: '1', rowJson: '{}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'h', sourceStartedAt: '2026-05-06T00:00:00Z',
      });
    })();

    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: -42, // gets clamped to 0
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: inProcessFetch,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.ops.length, 1);
  });

  it('returns ok:false with status 0 when fetch throws', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const throwingFetch = () => {
      throw new Error('connection refused');
    };
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: throwingFetch,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 0);
    assert.match(res.reason, /connection refused/);
  });

  it('rejects when the response body is not JSON', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    // A 200 response with malformed body — server-side success but
    // body parse fails on the client.
    const malformedFetch = async () =>
      new Response('not-json{', { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: malformedFetch,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.reason, /invalid JSON/);
  });

  it('audit M11: rejects oversized response body via Content-Length', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    // Server claims a body 100 MB long — pre-cap fetch would buffer it.
    const hugeFetch = async () =>
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(100 * 1024 * 1024),
        },
      });
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: hugeFetch,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.reason, /body too large/);
  });

  it('audit M11: rejects oversized response body via streaming', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    // No content-length header — body is read from the stream and the
    // cap kicks in mid-flight. Construct a Response whose body stream
    // emits enough chunks to exceed the 10 MB default.
    const chunk = 'x'.repeat(1024 * 1024); // 1 MB
    const stream = new ReadableStream({
      start(controller) {
        // 12 MB total — over the default 10 MB cap.
        for (let i = 0; i < 12; i++) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const overflowFetch = async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: overflowFetch,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.reason, /body too large/);
  });

  it('rejects when response is missing ops array', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const wrongShape = async () =>
      new Response(JSON.stringify({ no_ops_here: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const res = await fetchSyncSince({
      baseUrl: 'http://localhost',
      peerId: 'hub',
      fromOp: 0,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      fetchImpl: wrongShape,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.reason, /ops/);
  });
});
