#!/usr/bin/env node
// Tests for lib/jobLock.ts — POSIX-style file-lock primitive used by
// scripts/run-job.mjs to prevent two cron-fired ingest runs from
// stomping on each other.
//
// Run: node --experimental-strip-types --test tests/js/test-job-lock.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { acquireLock, releaseLock, inspectLock } = await import(
  '../../lib/jobLock.ts'
);

let tmpRoot;
let lockDir;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-joblock-'));
  lockDir = path.join(tmpRoot, 'locks');
});

after(() => {
  // Clean up any tmpRoot that may have leaked (beforeEach creates a new
  // one each time; the last one survives the suite).
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const aliveAlways = () => true;
const deadAlways = () => false;

describe('acquireLock', () => {
  it('creates the lock directory if missing', () => {
    const r = acquireLock('costing', { lockDir, pid: 100 });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(lockDir));
    assert.ok(fs.existsSync(path.join(lockDir, 'costing.lock')));
    r.handle.release();
  });

  it('returns ok=true with handle on first acquire', () => {
    const r = acquireLock('analytics', { lockDir, pid: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.handle.jobName, 'analytics');
    assert.equal(r.handle.pid, 100);
    assert.match(r.handle.acquiredAt, /^\d{4}-\d{2}-\d{2}T/);
    r.handle.release();
  });

  it('writes JSON {pid, jobName, acquiredAt} to lockfile', () => {
    const r = acquireLock('toast', { lockDir, pid: 4242 });
    assert.equal(r.ok, true);
    const raw = fs.readFileSync(path.join(lockDir, 'toast.lock'), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.pid, 4242);
    assert.equal(parsed.jobName, 'toast');
    assert.match(parsed.acquiredAt, /^\d{4}-\d{2}-\d{2}T/);
    r.handle.release();
  });

  it('rejects a second concurrent acquire when holder pid is alive', () => {
    const first = acquireLock('costing', {
      lockDir,
      pid: 100,
      isPidAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    const second = acquireLock('costing', {
      lockDir,
      pid: 200,
      isPidAlive: aliveAlways,
    });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, 'already_locked');
      assert.equal(second.heldBy?.pid, 100);
      assert.equal(second.heldBy?.jobName, 'costing');
    }
    first.handle.release();
  });

  it('reclaims the lock when the holder pid is dead', () => {
    const first = acquireLock('analytics', {
      lockDir,
      pid: 100,
      isPidAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    // Don't release — simulate a crashed process leaving an orphaned lockfile.

    const second = acquireLock('analytics', {
      lockDir,
      pid: 200,
      isPidAlive: deadAlways, // pid 100 is "dead"
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.handle.pid, 200);
      const raw = fs.readFileSync(path.join(lockDir, 'analytics.lock'), 'utf-8');
      assert.equal(JSON.parse(raw).pid, 200, 'reclaimed lockfile reflects new owner');
      second.handle.release();
    }
  });

  it('reclaims a stale lockfile even when isPidAlive says alive', () => {
    const first = acquireLock('analytics', {
      lockDir,
      pid: 100,
      isPidAlive: aliveAlways,
    });
    assert.equal(first.ok, true);

    // Backdate mtime by 5 hours so it's older than the default 4-hour stale window.
    const lockPath = path.join(lockDir, 'analytics.lock');
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    fs.utimesSync(lockPath, fiveHoursAgo, fiveHoursAgo);

    const second = acquireLock('analytics', {
      lockDir,
      pid: 200,
      isPidAlive: aliveAlways, // even with "alive" pid, stale wins
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.handle.pid, 200);
      second.handle.release();
    }
  });

  it('different job names do not conflict', () => {
    const a = acquireLock('costing', { lockDir, pid: 100 });
    const b = acquireLock('analytics', { lockDir, pid: 100 });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    a.handle.release();
    b.handle.release();
  });

  it('rejects invalid job names', () => {
    const r = acquireLock('../../etc/passwd', { lockDir, pid: 100 });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'lock_dir_unwritable');
    }
  });

  it('after release, a peer can acquire cleanly', () => {
    const first = acquireLock('costing', {
      lockDir,
      pid: 100,
      isPidAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    first.handle.release();

    const second = acquireLock('costing', {
      lockDir,
      pid: 200,
      isPidAlive: aliveAlways,
    });
    assert.equal(second.ok, true);
    second.handle.release();
  });
});

describe('releaseLock', () => {
  it('does NOT delete a lockfile owned by another pid', () => {
    const first = acquireLock('costing', {
      lockDir,
      pid: 100,
      isPidAlive: aliveAlways,
    });
    assert.equal(first.ok, true);

    // Pretend a different pid tries to release it (e.g. after stale-reclaim
    // by a peer + brand-new acquire by someone else, the original handle
    // shouldn't be able to delete the new lock).
    releaseLock(first.handle.lockfilePath, 999);
    assert.ok(fs.existsSync(first.handle.lockfilePath));

    // The real owner releasing still works.
    first.handle.release();
    assert.ok(!fs.existsSync(first.handle.lockfilePath));
  });

  it('is a no-op when the lockfile is already gone', () => {
    const lockfilePath = path.join(lockDir, 'phantom.lock');
    fs.mkdirSync(lockDir, { recursive: true });
    assert.doesNotThrow(() => releaseLock(lockfilePath, 100));
  });
});

describe('inspectLock', () => {
  it('returns null when no lockfile exists', () => {
    assert.equal(inspectLock('nope', { lockDir }), null);
  });

  it('returns held-by metadata when lockfile is present', () => {
    const r = acquireLock('costing', { lockDir, pid: 4242 });
    assert.equal(r.ok, true);
    const info = inspectLock('costing', { lockDir });
    assert.ok(info);
    assert.equal(info.pid, 4242);
    assert.equal(info.jobName, 'costing');
    assert.ok(typeof info.ageSec === 'number' && info.ageSec >= 0);
    r.handle.release();
  });
});

// ── Disk-full / write-error during lock create ─────────────────────

describe('acquireLock — write-error mid-create cleanup', () => {
  it('does NOT leak the fd or leave a partial lockfile when writeSync throws', () => {
    // Simulate a disk-full / I/O error mid-write by stubbing fs.writeSync.
    // Without the finally-block cleanup, the fd would leak (process-lifetime
    // leak) AND the partial lockfile would block subsequent acquires until
    // the stale-reclaim cycle ran. The fix: try/finally ensures both are
    // cleaned up even when the write throws.
    const realWrite = fs.writeSync;
    let lockfileBeforeFinally = '';
    fs.writeSync = () => {
      // Capture state at the moment of failure: the openSync has run
      // (lockfile exists), but writeSync now throws.
      lockfileBeforeFinally = path.join(lockDir, 'simfail.lock');
      throw Object.assign(new Error('ENOSPC: no space left on device'), {
        code: 'ENOSPC',
      });
    };
    try {
      const r = acquireLock('simfail', { lockDir, pid: 999 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'lock_dir_unwritable');
      assert.match(r.error, /ENOSPC/);
      // The lockfile must have been unlinked by the finally block —
      // a leaked partial lockfile would block the next acquire until
      // the stale-reclaim cycle.
      assert.equal(
        fs.existsSync(lockfileBeforeFinally),
        false,
        'partial lockfile should have been unlinked by the finally cleanup',
      );
    } finally {
      fs.writeSync = realWrite;
    }

    // After cleanup, a fresh acquire on the same name should succeed
    // immediately (no stale-reclaim path needed).
    const r2 = acquireLock('simfail', { lockDir, pid: 1000 });
    assert.equal(r2.ok, true, 'next acquire after the cleanup should succeed cleanly');
    r2.handle.release();
  });
});
