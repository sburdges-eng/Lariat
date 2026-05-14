#!/usr/bin/env node
// Tests for lib/syncFeed.ts (T7a): appendOp + replaySince + checkpoint
// helpers, schema migration in lib/db.ts, and the family-1 (append-only
// HACCP) idempotency contract.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-feed.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const {
  appendOp,
  replaySince,
  getReplayCheckpoint,
  setReplayCheckpoint,
} = await import('../../lib/syncFeed.ts');

beforeEach(() => {
  db.exec(`
    DELETE FROM sync_feed;
    DELETE FROM replay_checkpoints;
    DELETE FROM sqlite_sequence WHERE name = 'sync_feed';
  `);
});

function mkOp(overrides = {}) {
  return {
    opId: `op-${Math.random().toString(36).slice(2, 14)}`,
    tableName: 'cooling_log',
    locationId: 'default',
    opKind: 'insert',
    rowPk: '42',
    rowJson: '{"id":42,"item":"chili","start_reading_f":140}',
    createdAt: '2026-05-06T14:31:02.111Z',
    sourceHost: 'lariat-hub.local',
    sourceStartedAt: '2026-05-06T08:00:00.000Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Schema migration smoke test
// ─────────────────────────────────────────────────────────────────

describe('sync_feed schema', () => {
  it('has the sync_feed table after init', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_feed'`)
      .get();
    assert.ok(row, 'sync_feed table must exist');
  });

  it('has the replay_checkpoints table after init', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='replay_checkpoints'`)
      .get();
    assert.ok(row, 'replay_checkpoints table must exist');
  });

  it('has the op_id UNIQUE index', () => {
    db.prepare(
      `INSERT INTO sync_feed (op_id, table_name, location_id, op_kind, row_pk, row_json, source_host, source_started_at)
       VALUES ('unique-1','t','default','insert','1','{}','h','2026-01-01T00:00:00Z')`,
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO sync_feed (op_id, table_name, location_id, op_kind, row_pk, row_json, source_host, source_started_at)
           VALUES ('unique-1','t','default','insert','1','{}','h','2026-01-01T00:00:00Z')`,
        ).run(),
      /UNIQUE/i,
    );
  });

  it('CHECK op_kind allows only the four documented values', () => {
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO sync_feed (op_id, table_name, location_id, op_kind, row_pk, row_json, source_host, source_started_at)
           VALUES ('badkind','t','default','PATCH','1','{}','h','2026-01-01T00:00:00Z')`,
        ).run(),
      /CHECK/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// appendOp
// ─────────────────────────────────────────────────────────────────

describe('appendOp', () => {
  it('throws when called outside a transaction', () => {
    assert.throws(() => appendOp(mkOp()), /transaction/i);
  });

  it('inserts a single row when called inside a tx', () => {
    const op = mkOp();
    db.transaction(() => appendOp(op))();
    const row = db.prepare(`SELECT * FROM sync_feed WHERE op_id = ?`).get(op.opId);
    assert.ok(row);
    assert.equal(row.table_name, op.tableName);
    assert.equal(row.row_pk, op.rowPk);
    assert.equal(row.source_host, op.sourceHost);
  });

  it('rolls back the source row when appendOp throws (real-world atomicity)', () => {
    db.exec(`CREATE TEMP TABLE _src (id INTEGER PRIMARY KEY, val TEXT);`);
    const op = mkOp({ opKind: 'INVALID' }); // CHECK violation → throws
    assert.throws(() => {
      db.transaction(() => {
        db.prepare(`INSERT INTO _src (val) VALUES ('bad')`).run();
        appendOp(op);
      })();
    });
    const count = db.prepare(`SELECT COUNT(*) c FROM _src`).get().c;
    assert.equal(count, 0, 'source row must roll back when appendOp fails');
  });

  it('duplicate op_id is a silent no-op (idempotency property)', () => {
    const op = mkOp();
    db.transaction(() => appendOp(op))();
    db.transaction(() => appendOp(op))(); // same op_id — must not throw, must not duplicate
    const count = db.prepare(`SELECT COUNT(*) c FROM sync_feed WHERE op_id = ?`).get(op.opId).c;
    assert.equal(count, 1);
  });

  it('two different op_ids both land', () => {
    db.transaction(() => {
      appendOp(mkOp({ opId: 'op-a', rowPk: '1' }));
      appendOp(mkOp({ opId: 'op-b', rowPk: '2' }));
    })();
    const count = db.prepare(`SELECT COUNT(*) c FROM sync_feed`).get().c;
    assert.equal(count, 2);
  });
});

// ─────────────────────────────────────────────────────────────────
// replaySince
// ─────────────────────────────────────────────────────────────────

describe('replaySince', () => {
  function seedN(n, prefix = 'op-') {
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        appendOp(mkOp({ opId: `${prefix}${i}`, rowPk: String(i) }));
      }
    })();
  }

  it('returns empty page when feed is empty', () => {
    const page = replaySince('peer-1', 0);
    assert.deepEqual(page.ops, []);
    assert.equal(page.nextOp, null);
  });

  it('returns every op when fromRowId=0', () => {
    seedN(3);
    const page = replaySince('peer-1', 0);
    assert.equal(page.ops.length, 3);
    assert.equal(page.nextOp, null);
    // Ops are in insertion order (rowid ASC).
    assert.deepEqual(page.ops.map((o) => o.rowPk), ['0', '1', '2']);
  });

  it('returns only ops after fromRowId', () => {
    seedN(5);
    const all = replaySince('peer-1', 0).ops;
    const fromMid = replaySince('peer-1', 3).ops;
    assert.equal(all.length, 5);
    // Returns ops 4 and 5 (rowid 4..5 are > fromRowId=3).
    assert.equal(fromMid.length, 2);
  });

  it('respects the limit and signals nextOp when more available', () => {
    seedN(5);
    const page1 = replaySince('peer-1', 0, 2);
    assert.equal(page1.ops.length, 2);
    assert.ok(typeof page1.nextOp === 'number');

    const page2 = replaySince('peer-1', page1.nextOp, 10);
    // After the first 2 ops, we've returned through rowid 2. The next
    // page must start strictly after page1.nextOp.
    assert.ok(page2.ops.length >= 1);
  });

  it('limit clamps to [1, 2000]', () => {
    seedN(3);
    assert.equal(replaySince('peer-1', 0, 0).ops.length, 1, 'limit < 1 clamps to 1');
    assert.equal(replaySince('peer-1', 0, 99999).ops.length, 3, 'limit > 2000 still returns all 3');
  });

  it('nextOp is null on exact-fit page', () => {
    seedN(3);
    const page = replaySince('peer-1', 0, 3);
    assert.equal(page.ops.length, 3);
    assert.equal(page.nextOp, null, 'no more rows → nextOp null');
  });

  it('audit H3: lastSeenId is the highest rowid observed, even when nextOp is null', () => {
    seedN(3);
    const page = replaySince('peer-1', 0);
    // 3 rows, nextOp null (exhausted), lastSeenId is the highest id.
    assert.equal(page.nextOp, null);
    assert.ok(page.lastSeenId > 0, 'lastSeenId is populated');
    // lastSeenId equals the actual highest sync_feed.id from the page.
    const realHigh = db.prepare(`SELECT MAX(id) AS m FROM sync_feed`).get().m;
    assert.equal(page.lastSeenId, realHigh);
  });

  it('audit H3: lastSeenId reflects sparse rowid sequences (no loop on gaps)', () => {
    // Seed 5 rows then DELETE rows 2 and 3 to simulate the
    // rolled-back-tx scenario (rowids 1, 4, 5 remain). The applier's
    // checkpoint must advance to 5 — synthesizing fromOp + ops.length
    // would advance to 3 and re-fetch rows 4 + 5 forever.
    db.transaction(() => {
      for (let i = 0; i < 5; i++) {
        appendOp(mkOp({ opId: `gap-${i}`, rowPk: String(i) }));
      }
    })();
    db.exec(`DELETE FROM sync_feed WHERE id IN (SELECT id FROM sync_feed ORDER BY id LIMIT 2 OFFSET 1)`);
    const page = replaySince('peer-1', 0);
    assert.equal(page.ops.length, 3, 'three rows survived the gap');
    assert.equal(page.nextOp, null);
    const realHigh = db.prepare(`SELECT MAX(id) AS m FROM sync_feed`).get().m;
    assert.equal(page.lastSeenId, realHigh, 'lastSeenId is the survivor max');
    // The crucial property: fromOp + ops.length is < lastSeenId.
    assert.ok(0 + page.ops.length < page.lastSeenId, 'naive advance would skip rows');
  });

  it('audit H3: lastSeenId on an empty page falls back to fromRowId', () => {
    seedN(3);
    // Request past the end → no rows, lastSeenId stays at fromRowId.
    const high = db.prepare(`SELECT MAX(id) AS m FROM sync_feed`).get().m;
    const page = replaySince('peer-1', high + 100);
    assert.equal(page.ops.length, 0);
    assert.equal(page.lastSeenId, high + 100);
  });

  it('camelCase field shape matches SyncOp', () => {
    seedN(1);
    const op = replaySince('peer-1', 0).ops[0];
    assert.ok('opId' in op);
    assert.ok('tableName' in op);
    assert.ok('sourceHost' in op);
    assert.ok('sourceStartedAt' in op);
    // Ensure no snake_case keys leaked.
    assert.ok(!('op_id' in op));
    assert.ok(!('source_host' in op));
  });
});

// ─────────────────────────────────────────────────────────────────
// Checkpoint helpers
// ─────────────────────────────────────────────────────────────────

describe('replay checkpoints', () => {
  it('getReplayCheckpoint returns 0 for unknown peer', () => {
    assert.equal(getReplayCheckpoint('peer-x'), 0);
  });

  it('setReplayCheckpoint creates a row on first call', () => {
    setReplayCheckpoint('peer-x', 42);
    assert.equal(getReplayCheckpoint('peer-x'), 42);
  });

  it('setReplayCheckpoint MAXes against current (no regression)', () => {
    setReplayCheckpoint('peer-x', 100);
    setReplayCheckpoint('peer-x', 50);  // attempted regression
    assert.equal(getReplayCheckpoint('peer-x'), 100, 'checkpoint must not regress');
  });

  it('setReplayCheckpoint advances on increase', () => {
    setReplayCheckpoint('peer-x', 50);
    setReplayCheckpoint('peer-x', 100);
    assert.equal(getReplayCheckpoint('peer-x'), 100);
  });

  it('different peers track independently', () => {
    setReplayCheckpoint('peer-a', 10);
    setReplayCheckpoint('peer-b', 20);
    assert.equal(getReplayCheckpoint('peer-a'), 10);
    assert.equal(getReplayCheckpoint('peer-b'), 20);
  });

  it('different feed_scope tracks independently for the same peer', () => {
    setReplayCheckpoint('peer-x', 10, 'local');
    setReplayCheckpoint('peer-x', 20, 'other');
    assert.equal(getReplayCheckpoint('peer-x', 'local'), 10);
    assert.equal(getReplayCheckpoint('peer-x', 'other'), 20);
  });

  it('audit M5: setReplayCheckpoint clips peer_id to 256 chars', () => {
    const long = 'A'.repeat(500);
    setReplayCheckpoint(long, 42);
    // The function clips to 256 — reading with the same long string
    // returns 0 because the stored key is the clipped version, and
    // reading with the clipped key returns the value.
    const stored = getReplayCheckpoint(long.slice(0, 256));
    assert.equal(stored, 42);
  });

  it('audit M5: setReplayCheckpoint rejects empty peer_id', () => {
    assert.throws(() => setReplayCheckpoint('', 42), /non-empty/);
    assert.throws(() => setReplayCheckpoint('   ', 42), /non-empty/);
  });

  it('audit M5: setReplayCheckpoint rejects control characters in peer_id', () => {
    assert.throws(() => setReplayCheckpoint('peer\nx', 42), /control characters/);
    assert.throws(() => setReplayCheckpoint('peer\x00x', 42), /control characters/);
  });

  it('audit M5: setReplayCheckpoint rejects non-string peer_id', () => {
    // @ts-expect-error — runtime guard
    assert.throws(() => setReplayCheckpoint(42, 42), /must be a string/);
  });
});
