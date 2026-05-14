#!/usr/bin/env node
// Tests for scripts/sync-status.mjs (Phase 4 hardening).
//
// Run: node --experimental-strip-types --test tests/js/test-sync-status.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { collectStatus } = await import('../../scripts/sync-status.mjs');
const { addPeer, revokePeer, touchPeerLastSeen } = await import('../../lib/peerTrust.ts');
const { appendOp, setReplayCheckpoint } = await import('../../lib/syncFeed.ts');

beforeEach(() => {
  db.exec(`
    DELETE FROM peer_trust;
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
  `);
});

function mkKey() {
  const { publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(spki).subarray(spki.length - 32).toString('hex');
}

describe('collectStatus', () => {
  it('returns empty status for a fresh DB', async () => {
    const s = await collectStatus({ getDb });
    assert.deepEqual(s.peers, []);
    assert.deepEqual(s.checkpoints, []);
    assert.equal(s.feed.total, 0);
    assert.equal(s.feed.oldest, null);
    assert.deepEqual(s.feed.bySource, []);
    assert.deepEqual(s.feed.byTable, []);
  });

  it('lists peers in created_at order', async () => {
    addPeer(db, mkKey(), 'first');
    addPeer(db, mkKey(), 'second');
    const s = await collectStatus({ getDb });
    assert.equal(s.peers.length, 2);
    assert.equal(s.peers[0].label, 'first');
    assert.equal(s.peers[1].label, 'second');
  });

  it('flags revoked peers and surfaces last_seen_at', async () => {
    const k = mkKey();
    addPeer(db, k, 'tab');
    touchPeerLastSeen(db, k);
    revokePeer(db, k);
    const s = await collectStatus({ getDb });
    assert.equal(s.peers[0].revoked, 1);
    assert.ok(s.peers[0].last_seen_at);
  });

  it('returns checkpoints ordered by peer_id', async () => {
    setReplayCheckpoint('z-peer', 10);
    setReplayCheckpoint('a-peer', 20);
    const s = await collectStatus({ getDb });
    assert.equal(s.checkpoints.length, 2);
    assert.equal(s.checkpoints[0].peer_id, 'a-peer');
    assert.equal(s.checkpoints[1].peer_id, 'z-peer');
  });

  it('aggregates sync_feed by source and by table', async () => {
    db.transaction(() => {
      appendOp({
        opId: 'a', tableName: 'cooling_log', locationId: 'default',
        opKind: 'insert', rowPk: '1', rowJson: '{}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'tablet-1', sourceStartedAt: '2026-05-06T08:00:00Z',
      });
      appendOp({
        opId: 'b', tableName: 'cooling_log', locationId: 'default',
        opKind: 'insert', rowPk: '2', rowJson: '{}',
        createdAt: '2026-05-06T00:00:01Z',
        sourceHost: 'tablet-1', sourceStartedAt: '2026-05-06T08:00:00Z',
      });
      appendOp({
        opId: 'c', tableName: 'audit_events', locationId: 'default',
        opKind: 'insert', rowPk: '3', rowJson: '{}',
        createdAt: '2026-05-06T00:00:02Z',
        sourceHost: 'hub-laptop', sourceStartedAt: '2026-05-06T07:00:00Z',
      });
    })();

    const s = await collectStatus({ getDb });
    assert.equal(s.feed.total, 3);
    assert.equal(s.feed.oldest, '2026-05-06T00:00:00Z');
    assert.equal(s.feed.newest, '2026-05-06T00:00:02Z');

    // bySource sorted by cnt DESC
    assert.equal(s.feed.bySource[0].source_host, 'tablet-1');
    assert.equal(s.feed.bySource[0].cnt, 2);
    assert.equal(s.feed.bySource[1].source_host, 'hub-laptop');
    assert.equal(s.feed.bySource[1].cnt, 1);

    // byTable sorted by cnt DESC
    assert.equal(s.feed.byTable[0].table_name, 'cooling_log');
    assert.equal(s.feed.byTable[0].cnt, 2);
    assert.equal(s.feed.byTable[1].table_name, 'audit_events');
    assert.equal(s.feed.byTable[1].cnt, 1);
  });
});
