#!/usr/bin/env node
// Tests for scripts/run-job.mjs — the cron wrapper that locks, executes,
// records to ingest_runs, and writes failures to job-failures.jsonl.
//
// Run: node --experimental-strip-types --test tests/js/test-run-job.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Same chdir-before-import dance the pack-changes route test uses, since
// run-job.mjs derives ROOT from __dirname/.. and writes job-failures.jsonl
// relative to that. We chdir to a sandbox so failures don't pollute
// data/audit/job-failures.jsonl in the repo.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-runjob-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { runJob, listJobs, loadManifest } = await import('../../scripts/run-job.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

let manifestPath;
let manifest;

beforeEach(() => {
  db.exec(`DELETE FROM ingest_runs WHERE kind LIKE 'job:%';`);

  // Each test gets its own throwaway manifest. We use simple shell
  // commands so the test doesn't depend on Lariat-internal scripts.
  manifestPath = path.join(tmpRoot, `manifest-${Date.now()}-${Math.random()}.json`);
  manifest = {
    version: 1,
    jobs: {
      'pass-job': { command: ['true'], cron: '* * * * *', timeout_sec: 60 },
      'fail-job': { command: ['false'], cron: '* * * * *', timeout_sec: 60 },
      'echo-job': { command: ['echo', 'hello'], cron: '* * * * *', timeout_sec: 60 },
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  // Clean any prior lockfiles + failure log between tests.
  for (const sub of ['locks', 'audit']) {
    const p = path.join(tmpRoot, 'data', sub);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
});

function readFailures() {
  const p = path.join(tmpRoot, 'data', 'audit', 'job-failures.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('listJobs', () => {
  it('returns name + cron + description for each job', () => {
    const out = listJobs(manifest);
    assert.equal(out.length, 3);
    assert.equal(out[0].name, 'pass-job');
    assert.equal(out[0].cron, '* * * * *');
  });
});

describe('loadManifest', () => {
  it('throws when manifest path is bogus', () => {
    assert.throws(() => loadManifest('/no/such/file.json'));
  });
  it('throws when manifest has no jobs key', () => {
    const bad = path.join(tmpRoot, 'bad.json');
    fs.writeFileSync(bad, '{"foo":1}');
    assert.throws(() => loadManifest(bad), /jobs/);
  });
});

describe('runJob — happy path', () => {
  it('exits 0 + records ingest_runs status=ok for a passing job', async () => {
    const code = await runJob('pass-job', { manifestPath });
    assert.equal(code, 0);
    const row = db
      .prepare(`SELECT kind, status FROM ingest_runs WHERE kind = 'job:pass-job' ORDER BY id DESC LIMIT 1`)
      .get();
    assert.deepEqual(row, { kind: 'job:pass-job', status: 'ok' });

    // No failure log on success.
    assert.deepEqual(readFailures(), []);
  });

  it('echo-job runs and finishes ok', async () => {
    const code = await runJob('echo-job', { manifestPath });
    assert.equal(code, 0);
  });
});

describe('runJob — failure path', () => {
  it('exits 1 + records ingest_runs status=failed + writes job-failures.jsonl', async () => {
    const code = await runJob('fail-job', { manifestPath });
    assert.equal(code, 1);

    const row = db
      .prepare(`SELECT kind, status FROM ingest_runs WHERE kind = 'job:fail-job' ORDER BY id DESC LIMIT 1`)
      .get();
    assert.deepEqual(row, { kind: 'job:fail-job', status: 'failed' });

    const failures = readFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].job, 'fail-job');
    assert.equal(failures[0].exit_code, 1);
    assert.match(failures[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('runJob — usage errors', () => {
  it('exits 64 for an unknown job', async () => {
    const code = await runJob('phantom-job', { manifestPath });
    assert.equal(code, 64);
    // No ingest_runs row should be created when usage fails before run.
    const row = db
      .prepare(`SELECT kind FROM ingest_runs WHERE kind = 'job:phantom-job' LIMIT 1`)
      .get();
    assert.equal(row, undefined);
  });

  it('exits 64 for a job with empty command array', async () => {
    const bad = path.join(tmpRoot, 'bad-manifest.json');
    fs.writeFileSync(bad, JSON.stringify({
      version: 1,
      jobs: { broken: { command: [] } },
    }));
    const code = await runJob('broken', { manifestPath: bad });
    assert.equal(code, 64);
  });
});

describe('runJob — concurrent-run prevention', () => {
  it('second invocation while first holds the lock exits 75', async () => {
    // Simulate a held lock by manually creating a lockfile pointing at
    // an alive PID (our own).
    const lockDir = path.join(tmpRoot, 'data', 'locks');
    fs.mkdirSync(lockDir, { recursive: true });
    const lockfile = path.join(lockDir, 'pass-job.lock');
    fs.writeFileSync(
      lockfile,
      JSON.stringify({ pid: process.pid, jobName: 'pass-job', acquiredAt: new Date().toISOString() }),
    );

    const code = await runJob('pass-job', { manifestPath });
    assert.equal(code, 75, 'should exit EX_LOCKED when a live peer holds the lock');

    // No new ingest_runs row should be created — lock check happens BEFORE INSERT.
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM ingest_runs WHERE kind = 'job:pass-job'`)
      .get().c;
    assert.equal(count, 0);

    // Cleanup: release the manual lockfile so subsequent tests can run.
    fs.unlinkSync(lockfile);
  });
});
