#!/usr/bin/env node
// Tests for scripts/gc-sync-feed.mjs (audit M9).
//
// Run: node --experimental-strip-types --test tests/js/test-gc-sync-feed.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { computeGcFloor, runGc } = await import('../../scripts/gc-sync-feed.mjs');
const { appendOp, setReplayCheckpoint } = await import('../../lib/syncFeed.ts');

beforeEach(() => {
  db.exec(`
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
  `);
});

function seedRowsAged(count, daysOld) {
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      appendOp({
        opId: `gc-${i}-${Math.random()}`,
        tableName: 'cooling_log',
        locationId: 'default',
        opKind: 'insert',
        rowPk: String(i),
        rowJson: '{}',
        createdAt: '2026-05-06T00:00:00Z',
        sourceHost: 'h',
        sourceStartedAt: '2026-05-06T00:00:00Z',
      });
    }
  })();
  if (daysOld !== undefined) {
    // Override created_at to simulate aged rows.
    db.prepare(
      `UPDATE sync_feed SET created_at = datetime('now', ?)`,
    ).run(`-${daysOld} days`);
  }
}

describe('computeGcFloor', () => {
  it('returns null floor when no peer checkpoints recorded', () => {
    seedRowsAged(5, 100);
    const floor = computeGcFloor(db, 7);
    assert.equal(floor.eligibleFloor, null);
    assert.equal(floor.peerCheckpointCount, 0);
  });

  it('returns 0 when no rows are old enough', () => {
    seedRowsAged(5, 0); // all fresh
    setReplayCheckpoint('peer-a', 999);
    const floor = computeGcFloor(db, 7);
    assert.equal(floor.eligibleFloor, 0, 'no row past min-age cutoff');
  });

  it('returns MIN(peer checkpoint, oldest aged row) when both bound the floor', () => {
    seedRowsAged(5, 30); // 30 days old
    setReplayCheckpoint('peer-a', 3);
    setReplayCheckpoint('peer-b', 5);
    const floor = computeGcFloor(db, 7);
    // min peer = 3, max aged row = 5 → eligible = min(3, 5) = 3
    assert.equal(floor.eligibleFloor, 3);
    assert.equal(floor.minPeerCheckpoint, 3);
    assert.equal(floor.maxAgedRow, 5);
  });

  it('lowest peer checkpoint wins (one slow peer pins everyone)', () => {
    seedRowsAged(10, 30);
    setReplayCheckpoint('fast-peer', 9);
    setReplayCheckpoint('slow-peer', 2);
    const floor = computeGcFloor(db, 7);
    assert.equal(floor.eligibleFloor, 2);
  });
});

describe('runGc', () => {
  it('dry-run reports candidates without deleting', async () => {
    seedRowsAged(5, 30);
    setReplayCheckpoint('peer-a', 5);
    const r = await runGc({ apply: false, minAgeDays: 7 }, { getDb });
    assert.equal(r.apply, false);
    assert.equal(r.deleted, 0, 'dry-run never deletes');
    assert.equal(r.candidatesIfApplied, 5);
    // Verify rows still on disk.
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM sync_feed`).get().n;
    assert.equal(remaining, 5);
  });

  it('apply deletes rows ≤ eligibleFloor', async () => {
    seedRowsAged(5, 30);
    setReplayCheckpoint('peer-a', 3);
    const r = await runGc({ apply: true, minAgeDays: 7 }, { getDb });
    assert.equal(r.apply, true);
    assert.equal(r.eligibleFloor, 3);
    assert.equal(r.deleted, 3);
    // 2 rows survive.
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM sync_feed`).get().n;
    assert.equal(remaining, 2);
  });

  it('refuses to delete when no peers have checkpointed (avoids wiping the feed)', async () => {
    seedRowsAged(5, 30);
    // No setReplayCheckpoint calls.
    const r = await runGc({ apply: true, minAgeDays: 7 }, { getDb });
    assert.equal(r.deleted, 0);
    assert.equal(r.eligibleFloor, null);
    assert.match(r.reason, /no peer checkpoints/);
    // 5 rows survive.
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sync_feed`).get().n, 5);
  });

  it('respects --min-age-days — fresh rows survive even below the peer floor', async () => {
    seedRowsAged(5, 0); // all fresh
    setReplayCheckpoint('peer-a', 5);
    const r = await runGc({ apply: true, minAgeDays: 7 }, { getDb });
    // No rows are older than 7 days, so eligibleFloor = min(5, 0) = 0.
    assert.equal(r.eligibleFloor, 0);
    assert.equal(r.deleted, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sync_feed`).get().n, 5);
  });

  it('empty feed is a no-op (no deletes, no error)', async () => {
    setReplayCheckpoint('peer-a', 0);
    const r = await runGc({ apply: true, minAgeDays: 7 }, { getDb });
    assert.equal(r.totalBefore, 0);
    assert.equal(r.deleted, 0);
  });
});
