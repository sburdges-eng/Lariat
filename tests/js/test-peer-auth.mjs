#!/usr/bin/env node
// Tests for lib/peerTrust.ts and app/api/peers/sync-since/route.js (T7b).
//
// Verifies:
//   - peer_trust schema present (peers table CRUD)
//   - canonicalSigningPayload format (frozen v1 contract)
//   - authenticateSyncRequest happy path + every 401 reason path
//   - clock-skew window enforcement
//   - revoked peers rejected
//   - GET /api/peers/sync-since wires the auth layer correctly + returns
//     replaySince ops on success
//
// Run: node --experimental-strip-types --test tests/js/test-peer-auth.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const {
  addPeer,
  revokePeer,
  getPeerByPubkey,
  getPeerByFingerprint,
  listPeers,
  canonicalSigningPayload,
  authenticateSyncRequest,
  CLOCK_SKEW_WINDOW_MS,
} = await import('../../lib/peerTrust.ts');
const { appendOp } = await import('../../lib/syncFeed.ts');
const { fingerprint: fpOf } = await import('../../lib/peerKeypair.ts');
const route = await import('../../app/api/peers/sync-since/route.js');

beforeEach(() => {
  db.exec(`
    DELETE FROM peer_trust;
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
  `);
});

// ── Test helpers — generate a key + sign + drive the route end-to-end ──

function mkKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub_spki = publicKey.export({ type: 'spki', format: 'der' });
  const priv_pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  // Last 32 bytes of SPKI = raw pubkey; last 32 of PKCS8 = raw priv seed.
  const pubKey = Buffer.from(pub_spki).subarray(pub_spki.length - 32);
  const privKeyObj = privateKey; // KeyObject usable directly by cryptoSign
  return {
    pubKey,
    pubHex: pubKey.toString('hex'),
    privKeyObj,
  };
}

function signPayload(privKeyObj, payload) {
  return cryptoSign(null, Buffer.from(payload, 'utf8'), privKeyObj).toString('hex');
}

// ─────────────────────────────────────────────────────────────────
// peer_trust CRUD
// ─────────────────────────────────────────────────────────────────

describe('peer_trust CRUD', () => {
  it('addPeer normalizes hex and computes fingerprint', () => {
    const { pubHex, pubKey } = mkKeypair();
    const row = addPeer(db, pubHex.toUpperCase(), 'tablet-1');
    assert.equal(row.pubkey_hex, pubHex.toLowerCase());
    assert.equal(row.fingerprint, fpOf(pubKey));
    assert.equal(row.label, 'tablet-1');
    assert.equal(row.revoked, 0);
  });

  it('addPeer rejects bad hex shape', () => {
    assert.throws(() => addPeer(db, 'not hex'));
    assert.throws(() => addPeer(db, '0123'.repeat(10))); // wrong length
  });

  it('addPeer is idempotent — reapplying clears revoked', () => {
    const { pubHex } = mkKeypair();
    addPeer(db, pubHex, 'a');
    revokePeer(db, pubHex);
    addPeer(db, pubHex, 'b'); // re-add → un-revoke + update label
    const row = getPeerByPubkey(db, pubHex);
    assert.equal(row.revoked, 0);
    assert.equal(row.label, 'b');
  });

  it('revokePeer flips the bit, does not delete the row', () => {
    const { pubHex } = mkKeypair();
    addPeer(db, pubHex);
    assert.equal(revokePeer(db, pubHex), true);
    assert.equal(getPeerByPubkey(db, pubHex).revoked, 1);
    assert.equal(revokePeer(db, 'a'.repeat(64)), false, 'unknown peer returns false');
  });

  it('getPeerByFingerprint finds the row by short id', () => {
    const { pubHex, pubKey } = mkKeypair();
    addPeer(db, pubHex);
    const fp = fpOf(pubKey);
    assert.equal(getPeerByFingerprint(db, fp).pubkey_hex, pubHex.toLowerCase());
  });

  it('listPeers returns rows in created_at order', () => {
    const k1 = mkKeypair();
    const k2 = mkKeypair();
    addPeer(db, k1.pubHex, 'first');
    addPeer(db, k2.pubHex, 'second');
    const rows = listPeers(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].label, 'first');
  });
});

// ─────────────────────────────────────────────────────────────────
// canonicalSigningPayload (frozen v1 contract)
// ─────────────────────────────────────────────────────────────────

describe('canonicalSigningPayload', () => {
  it('formats as method\\npathname\\nquery\\ntimestamp', () => {
    const payload = canonicalSigningPayload(
      'GET',
      '/api/peers/sync-since',
      'peer_id=hub&from_op=42',
      '2026-05-14T10:11:12Z',
    );
    assert.equal(
      payload,
      'GET\n/api/peers/sync-since\npeer_id=hub&from_op=42\n2026-05-14T10:11:12Z',
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// authenticateSyncRequest
// ─────────────────────────────────────────────────────────────────

describe('authenticateSyncRequest', () => {
  const PATH = '/api/peers/sync-since';
  const QUERY = 'peer_id=hub&from_op=0';
  const NOW = Date.parse('2026-05-14T10:00:00Z');
  const TS = '2026-05-14T10:00:00Z';

  it('happy path: signed → ok', () => {
    const { pubHex, privKeyObj } = mkKeypair();
    addPeer(db, pubHex);
    const sig = signPayload(privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, TS));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: TS, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, true);
    assert.equal(res.peer.pubkey_hex, pubHex);
  });

  it('missing headers → 401 missing', () => {
    const res = authenticateSyncRequest(db, 'GET', PATH, QUERY, {}, NOW);
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.match(res.reason, /missing/);
  });

  it('malformed pubkey hex → 401 malformed pubkey', () => {
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: 'not-hex', timestampIso: TS, signatureHex: 'aa' },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /malformed pubkey/);
  });

  it('malformed timestamp → 401 malformed timestamp', () => {
    const { pubHex } = mkKeypair();
    addPeer(db, pubHex);
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: 'yesterday', signatureHex: 'aa' },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /malformed timestamp/);
  });

  it('timestamp outside clock-skew window → 401 outside window', () => {
    const { pubHex, privKeyObj } = mkKeypair();
    addPeer(db, pubHex);
    const stale = '2026-05-14T09:00:00Z'; // 1h before NOW, way past skew window
    const sig = signPayload(privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, stale));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: stale, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /clock-skew/);
  });

  it('untrusted pubkey → 401 untrusted', () => {
    // Don't addPeer — pubkey is not in the allowlist.
    const { pubHex, privKeyObj } = mkKeypair();
    const sig = signPayload(privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, TS));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: TS, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /untrusted/);
  });

  it('revoked peer → 401 untrusted', () => {
    const { pubHex, privKeyObj } = mkKeypair();
    addPeer(db, pubHex);
    revokePeer(db, pubHex);
    const sig = signPayload(privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, TS));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: TS, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /untrusted/);
  });

  it('valid pubkey + bad signature → 401 signature mismatch', () => {
    const { pubHex } = mkKeypair();
    const badKey = mkKeypair();
    addPeer(db, pubHex);
    // Sign with the WRONG private key.
    const sig = signPayload(badKey.privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, TS));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: TS, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /signature/);
  });

  it('signature over wrong path → 401 signature mismatch', () => {
    const { pubHex, privKeyObj } = mkKeypair();
    addPeer(db, pubHex);
    // Sign for /api/peers/sync-since but the request is for /api/peers/forge.
    const sig = signPayload(
      privKeyObj,
      canonicalSigningPayload('GET', '/api/peers/sync-since', QUERY, TS),
    );
    const res = authenticateSyncRequest(
      db,
      'GET',
      '/api/peers/forge',
      QUERY,
      { pubkeyHex: pubHex, timestampIso: TS, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /signature/);
  });

  it('CLOCK_SKEW_WINDOW_MS edge: exactly at window is accepted', () => {
    const { pubHex, privKeyObj } = mkKeypair();
    addPeer(db, pubHex);
    const ts = new Date(NOW - CLOCK_SKEW_WINDOW_MS).toISOString();
    const sig = signPayload(privKeyObj, canonicalSigningPayload('GET', PATH, QUERY, ts));
    const res = authenticateSyncRequest(
      db,
      'GET',
      PATH,
      QUERY,
      { pubkeyHex: pubHex, timestampIso: ts, signatureHex: sig },
      NOW,
    );
    assert.equal(res.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/peers/sync-since (route wiring)
// ─────────────────────────────────────────────────────────────────

describe('GET /api/peers/sync-since', () => {
  function mkSignedReq({ pubHex, privKeyObj, query = 'peer_id=hub&from_op=0' }) {
    const ts = new Date().toISOString();
    const sig = signPayload(
      privKeyObj,
      canonicalSigningPayload('GET', '/api/peers/sync-since', query, ts),
    );
    return new Request(`http://localhost/api/peers/sync-since?${query}`, {
      headers: {
        'x-lariat-peer-pubkey': pubHex,
        'x-lariat-timestamp': ts,
        'x-lariat-signature': sig,
      },
    });
  }

  it('returns 401 when no auth headers', async () => {
    const res = await route.GET(new Request('http://localhost/api/peers/sync-since?peer_id=h'));
    assert.equal(res.status, 401);
  });

  it('returns 401 when peer not in trust list', async () => {
    const k = mkKeypair();
    const res = await route.GET(mkSignedReq({ pubHex: k.pubHex, privKeyObj: k.privKeyObj }));
    assert.equal(res.status, 401);
  });

  it('returns 400 when peer_id is missing', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const res = await route.GET(mkSignedReq({ ...k, query: 'from_op=0' }));
    assert.equal(res.status, 400);
  });

  it('returns 400 when from_op is malformed', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const res = await route.GET(mkSignedReq({ ...k, query: 'peer_id=h&from_op=abc' }));
    assert.equal(res.status, 400);
  });

  it('happy path: returns ops + next_op + caller fingerprint', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex, 'lariat-tablet-1');
    // Seed two sync_feed rows so replaySince has something to return.
    db.transaction(() => {
      appendOp({
        opId: 'op-a',
        tableName: 'cooling_log',
        locationId: 'default',
        opKind: 'insert',
        rowPk: '1',
        rowJson: '{}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'h',
        sourceStartedAt: '2026-05-06T00:00:00Z',
      });
      appendOp({
        opId: 'op-b',
        tableName: 'cooling_log',
        locationId: 'default',
        opKind: 'insert',
        rowPk: '2',
        rowJson: '{}',
        createdAt: '2026-05-06T00:00:01Z',
        sourceHost: 'h',
        sourceStartedAt: '2026-05-06T00:00:00Z',
      });
    })();

    const res = await route.GET(mkSignedReq({ ...k, query: 'peer_id=hub&from_op=0' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.peer_id, 'hub');
    assert.equal(body.from_op, 0);
    assert.equal(body.ops.length, 2);
    assert.equal(body.next_op, null);
    // The caller's own fingerprint echoes back — operator can grep logs
    // for which peer fetched which window.
    assert.equal(body.caller_fingerprint, fpOf(k.pubKey));
  });

  it('updates last_seen_at on a successful call', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const before = getPeerByPubkey(db, k.pubHex).last_seen_at;
    assert.equal(before, null);
    await route.GET(mkSignedReq({ ...k }));
    const after = getPeerByPubkey(db, k.pubHex).last_seen_at;
    assert.ok(after, 'last_seen_at must be populated after a valid call');
  });

  it('does NOT update last_seen_at on 401', async () => {
    const k = mkKeypair();
    // Don't add peer — auth will fail.
    const before = getPeerByPubkey(db, k.pubHex);
    assert.equal(before, null);
    const res = await route.GET(mkSignedReq({ ...k }));
    assert.equal(res.status, 401);
    // Still no row in peer_trust → no last_seen to inspect; this just
    // confirms the route didn't autocreate a row.
    assert.equal(getPeerByPubkey(db, k.pubHex), null);
  });
});
