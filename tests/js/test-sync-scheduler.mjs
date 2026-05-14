#!/usr/bin/env node
// Tests for lib/syncScheduler.ts — the Phase 4 sync-apply scheduler.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-scheduler.mjs

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

const { createScheduler, runPeerCycle, _resetSchedulerForTests } = await import(
  '../../lib/syncScheduler.ts'
);
const { addPeer } = await import('../../lib/peerTrust.ts');
const { appendOp, getReplayCheckpoint } = await import('../../lib/syncFeed.ts');
const route = await import('../../app/api/peers/sync-since/route.js');

beforeEach(() => {
  db.exec(`
    DELETE FROM peer_trust;
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
    DELETE FROM line_check_entries;
  `);
  _resetSchedulerForTests();
});

function mkKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub_spki = publicKey.export({ type: 'spki', format: 'der' });
  const priv_pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubKey = Buffer.from(pub_spki).subarray(pub_spki.length - 32);
  const privKey = Buffer.from(priv_pkcs8).subarray(priv_pkcs8.length - 32);
  return { pubKey, pubHex: pubKey.toString('hex'), privKey };
}

const inProcessFetch = (url, init) => route.GET(new Request(url, init));

function seedRow(rowJson, opId) {
  db.transaction(() => {
    appendOp({
      opId,
      tableName: 'line_check_entries',
      locationId: 'default',
      opKind: 'insert',
      rowPk: '1',
      rowJson: JSON.stringify(rowJson),
      createdAt: '2026-05-06T00:00:00Z',
      sourceHost: 'lariat-tablet-1',
      sourceStartedAt: '2026-05-06T00:00:00Z',
    });
  })();
}

// ─────────────────────────────────────────────────────────────────
// runPeerCycle
// ─────────────────────────────────────────────────────────────────

describe('runPeerCycle', () => {
  it('no-new-ops when the feed is empty', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const r = await runPeerCycle(
      { baseUrl: 'http://localhost', feedKey: 'peer-x' },
      {
        ourPubKeyHex: k.pubHex,
        ourPrivKey: k.privKey,
        ourPeerKey: 'us',
        fetchImpl: inProcessFetch,
      },
    );
    assert.equal(r.outcome, 'no-new-ops');
    assert.equal(r.applied, 0);
    assert.equal(r.newCheckpoint, null);
  });

  it('applied advances checkpoint after a successful window', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'x', status: 'pass', location_id: 'default' },
      'op-a',
    );
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'y', status: 'pass', location_id: 'default' },
      'op-b',
    );

    assert.equal(getReplayCheckpoint('peer-x', 'remote'), 0);

    const r = await runPeerCycle(
      { baseUrl: 'http://localhost', feedKey: 'peer-x' },
      {
        ourPubKeyHex: k.pubHex,
        ourPrivKey: k.privKey,
        ourPeerKey: 'us',
        fetchImpl: inProcessFetch,
      },
    );
    assert.equal(r.outcome, 'applied');
    assert.equal(r.applied, 2);
    assert.ok(r.newCheckpoint !== null && r.newCheckpoint > 0);
    assert.equal(getReplayCheckpoint('peer-x', 'remote'), r.newCheckpoint);
  });

  it('fetch-error preserves the checkpoint', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'x', status: 'pass', location_id: 'default' },
      'op-a',
    );
    const throwingFetch = () => {
      throw new Error('connection refused');
    };
    const r = await runPeerCycle(
      { baseUrl: 'http://localhost', feedKey: 'peer-x' },
      {
        ourPubKeyHex: k.pubHex,
        ourPrivKey: k.privKey,
        ourPeerKey: 'us',
        fetchImpl: throwingFetch,
      },
    );
    assert.equal(r.outcome, 'fetch-error');
    assert.match(r.reason || '', /connection refused/);
    // Checkpoint UNCHANGED — a failed fetch must not advance the cursor.
    assert.equal(getReplayCheckpoint('peer-x', 'remote'), 0);
  });

  it('apply-skipped (family-3-only window) still advances checkpoint to avoid re-fetch loop', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    // Seed a family-3 op (dish_components — `recipes` was removed
    // from FAMILY_3_TABLES per audit C1 since it has no SQL table).
    // The applier SKIPs family-3 ops with audit.
    db.transaction(() => {
      appendOp({
        opId: 'family3-only',
        tableName: 'dish_components',
        locationId: 'default',
        opKind: 'update',
        rowPk: 'pasta:tomato',
        rowJson: '{"dish_name":"pasta","ingredient":"tomato"}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'h',
        sourceStartedAt: '2026-05-06T00:00:00Z',
      });
    })();
    const r = await runPeerCycle(
      { baseUrl: 'http://localhost', feedKey: 'peer-x' },
      {
        ourPubKeyHex: k.pubHex,
        ourPrivKey: k.privKey,
        ourPeerKey: 'us',
        fetchImpl: inProcessFetch,
      },
    );
    assert.equal(r.outcome, 'apply-skipped');
    assert.equal(r.applied, 0);
    assert.equal(r.skippedFamily3, 1);
    // Checkpoint advanced past the family-3 op so we don't loop on it.
    assert.ok(r.newCheckpoint !== null && r.newCheckpoint > 0);
  });

  it('reuses prior checkpoint as fromOp on next call (only new ops are fetched)', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'x', status: 'pass', location_id: 'default' },
      'op-1',
    );
    const ourId = 'us';
    const peer = { baseUrl: 'http://localhost', feedKey: 'peer-x' };
    const optsBase = {
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: ourId,
      fetchImpl: inProcessFetch,
    };

    const r1 = await runPeerCycle(peer, optsBase);
    assert.equal(r1.applied, 1);
    const cp = getReplayCheckpoint('peer-x', 'remote');
    assert.ok(cp > 0);

    // Add a second op AFTER the first cycle.
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'y', status: 'pass', location_id: 'default' },
      'op-2',
    );
    const r2 = await runPeerCycle(peer, optsBase);
    assert.equal(r2.fromOp, cp, 'second cycle starts from the prior checkpoint');
    assert.equal(r2.applied, 1, 'only the new op was applied');
  });
});

// ─────────────────────────────────────────────────────────────────
// Scheduler instance — tick + gracefulStop
// ─────────────────────────────────────────────────────────────────

describe('createScheduler', () => {
  it('tick polls every peer in parallel and returns one cycle each', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'x', status: 'pass', location_id: 'default' },
      'op-1',
    );

    const sched = createScheduler({
      peers: [
        { baseUrl: 'http://localhost', feedKey: 'peer-a' },
        { baseUrl: 'http://localhost', feedKey: 'peer-b' },
      ],
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: 'us',
      fetchImpl: inProcessFetch,
    });
    const result = await sched.tick();
    assert.equal(result.cycles.length, 2);
    // Both peers see the same feed (same in-process server), so both
    // apply the op on first tick — but each peer's checkpoint is
    // independent.
    assert.equal(result.cycles.every((c) => c.outcome === 'applied'), true);
    assert.equal(getReplayCheckpoint('peer-a', 'remote') > 0, true);
    assert.equal(getReplayCheckpoint('peer-b', 'remote') > 0, true);
  });

  it('empty peer list → tick returns empty cycles array', async () => {
    const k = mkKeypair();
    const sched = createScheduler({
      peers: [],
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: 'us',
    });
    const r = await sched.tick();
    assert.deepEqual(r.cycles, []);
  });

  it('start/stop is idempotent and isRunning reflects state', async () => {
    const k = mkKeypair();
    const sched = createScheduler({
      peers: [],
      tickMs: 1_000_000,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: 'us',
    });
    assert.equal(sched.isRunning(), false);
    sched.start();
    assert.equal(sched.isRunning(), true);
    sched.start(); // idempotent
    assert.equal(sched.isRunning(), true);
    sched.stop();
    assert.equal(sched.isRunning(), false);
    sched.stop(); // idempotent
  });

  it('gracefulStop awaits in-flight tick and clears the interval', async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    const sched = createScheduler({
      peers: [{ baseUrl: 'http://localhost', feedKey: 'peer-x' }],
      tickMs: 1_000_000,
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: 'us',
      fetchImpl: inProcessFetch,
    });
    sched.start();
    const inFlight = sched.tick();
    await sched.gracefulStop(500);
    assert.equal(sched.isRunning(), false);
    await inFlight; // should have already resolved by the await above
  });

  it("one peer's failure does NOT break the other peer's cycle", async () => {
    const k = mkKeypair();
    addPeer(db, k.pubHex);
    seedRow(
      { shift_date: '2026-05-06', station_id: 'saute', item: 'x', status: 'pass', location_id: 'default' },
      'op-1',
    );

    let callIdx = 0;
    const flakyFetch = (url, init) => {
      callIdx += 1;
      if (callIdx === 1) throw new Error('peer-a is down');
      return route.GET(new Request(url, init));
    };

    const sched = createScheduler({
      peers: [
        { baseUrl: 'http://localhost', feedKey: 'peer-a' },
        { baseUrl: 'http://localhost', feedKey: 'peer-b' },
      ],
      ourPubKeyHex: k.pubHex,
      ourPrivKey: k.privKey,
      ourPeerKey: 'us',
      fetchImpl: flakyFetch,
    });
    const result = await sched.tick();
    assert.equal(result.cycles.length, 2);
    const a = result.cycles.find((c) => c.feedKey === 'peer-a');
    const b = result.cycles.find((c) => c.feedKey === 'peer-b');
    assert.equal(a.outcome, 'fetch-error');
    assert.equal(b.outcome, 'applied');
  });
});
