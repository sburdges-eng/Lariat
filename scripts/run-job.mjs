#!/usr/bin/env node
// CLI wrapper for cron-launched Lariat jobs.
//
// Cron is the scheduler. This file is what cron calls. Job definitions
// live in data/scheduled-jobs.json (read at start of every invocation —
// no need to restart anything to pick up changes).
//
// What it does:
//   1. Parse args; resolve the requested job from the manifest.
//   2. Acquire a file lock (lib/jobLock.ts). If held by a live peer,
//      exit with EX_LOCKED (75) so cron's MAILTO surfaces the skip
//      without flooding logs.
//   3. Open an `ingest_runs` row with kind=`job:<name>`, status='running'.
//   4. Spawn the job's command (stdio inherited so the operator sees
//      live output); forward the exit code.
//   5. Update `ingest_runs` row with status='ok' or 'failed' +
//      finished_at. On failure, append a row to
//      data/audit/job-failures.jsonl with timestamp + exit code +
//      tail of stderr (caller-visible, easy to grep).
//   6. Release the lock (best-effort even on uncaught throw).
//
// Usage:
//   node --experimental-strip-types scripts/run-job.mjs <job-name>
//   node --experimental-strip-types scripts/run-job.mjs --list
//   node --experimental-strip-types scripts/run-job.mjs --status [<job-name>]
//
// Example crontab entry:
//   0 6 * * * cd "$HOME/Dev/Lariat" && node --experimental-strip-types scripts/run-job.mjs ingest-costing >> "$HOME/Library/Logs/Lariat/lariat-cron.log" 2>&1

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'scheduled-jobs.json');

// Failure-log path is resolved against process.cwd() (NOT ROOT) for two
// reasons: (1) tests chdir into a sandbox before importing this module
// and expect failures to land there; (2) lib/auditLog.mjs uses the same
// cwd-relative pattern, so the two audit streams stay consistent. Cron
// jobs `cd ~/Dev/Lariat &&` before invoking, so prod is unaffected.
function failureLogPath() {
  return path.join(process.cwd(), 'data', 'audit', 'job-failures.jsonl');
}

// POSIX exit codes — keeping the 75/64 conventions so cron's `MAILTO`
// rules and any future supervisor can distinguish "lock held" (try
// again later) from "bad config" (alert) from "job failed" (alert).
const EX_OK = 0;
const EX_USAGE = 64;
const EX_LOCKED = 75;
const EX_FAILED = 1;

export function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.jobs) {
    throw new Error(`manifest at ${manifestPath} missing 'jobs' object`);
  }
  return parsed;
}

export function listJobs(manifest) {
  return Object.entries(manifest.jobs).map(([name, def]) => ({
    name,
    cron: def.cron ?? null,
    description: def.description ?? null,
    command: def.command ?? null,
    timeout_sec: def.timeout_sec ?? null,
  }));
}

function appendFailureLog(entry) {
  try {
    const p = failureLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  } catch {
    // If we can't even write the failure log, the operator will see
    // the non-zero exit code from cron. Don't mask the original error.
  }
}

function tailLines(s, n = 10) {
  if (typeof s !== 'string') return '';
  const lines = s.split('\n');
  return lines.slice(-n - 1).join('\n').trim();
}

/**
 * Run one job by name. Returns the exit code; never throws on
 * normal flow (acquisition failure, run failure). Throws only on
 * programmer errors (manifest unreadable, bad CLI args).
 */
export async function runJob(jobName, opts = {}) {
  const manifest = opts.manifest ?? loadManifest(opts.manifestPath);
  const def = manifest.jobs[jobName];
  if (!def) {
    process.stderr.write(`run-job: unknown job '${jobName}'\n`);
    return EX_USAGE;
  }
  if (!Array.isArray(def.command) || def.command.length === 0) {
    process.stderr.write(`run-job: job '${jobName}' has no command\n`);
    return EX_USAGE;
  }

  // Defer DB + lock module imports until we know we have work to do —
  // keeps `--list` and `--help` snappy and avoids opening the DB just
  // to print a manifest summary.
  const [{ acquireLock }, { getDb }] = await Promise.all([
    import('../lib/jobLock.ts'),
    import('../lib/db.ts'),
  ]);

  const staleAfterSec = Number(def.timeout_sec) || undefined;
  const acq = acquireLock(jobName, { staleAfterSec });
  if (!acq.ok) {
    if (acq.reason === 'already_locked') {
      const heldFor = acq.heldBy ? ` (held by pid ${acq.heldBy.pid} for ${acq.heldBy.ageSec}s)` : '';
      process.stderr.write(`run-job: job '${jobName}' already locked${heldFor}\n`);
      return EX_LOCKED;
    }
    process.stderr.write(`run-job: failed to acquire lock for '${jobName}': ${acq.reason}\n`);
    return EX_FAILED;
  }

  const db = getDb();
  const startedAt = new Date().toISOString();
  const runId = Number(
    db.prepare(
      `INSERT INTO ingest_runs (kind, started_at, status)
       VALUES (?, datetime('now','subsec'), 'running')`,
    ).run(`job:${jobName}`).lastInsertRowid,
  );

  try {
    const [bin, ...args] = def.command;
    const result = spawnSync(bin, args, {
      cwd: ROOT,
      stdio: opts.captureStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit',
      env: process.env,
    });

    const exitCode = result.status ?? (result.error ? 1 : 0);
    const finishedAt = new Date().toISOString();
    const ok = exitCode === 0 && !result.error;

    db.prepare(
      `UPDATE ingest_runs
          SET status = ?,
              finished_at = datetime('now','subsec')
        WHERE id = ?`,
    ).run(ok ? 'ok' : 'failed', runId);

    if (!ok) {
      appendFailureLog({
        ts: finishedAt,
        job: jobName,
        run_id: runId,
        exit_code: exitCode,
        spawn_error: result.error?.message ?? null,
        stderr_tail: opts.captureStderr ? tailLines(String(result.stderr ?? '')) : null,
        started_at: startedAt,
      });
    }

    return ok ? EX_OK : EX_FAILED;
  } catch (err) {
    db.prepare(
      `UPDATE ingest_runs
          SET status = 'failed',
              finished_at = datetime('now','subsec')
        WHERE id = ?`,
    ).run(runId);
    appendFailureLog({
      ts: new Date().toISOString(),
      job: jobName,
      run_id: runId,
      exit_code: null,
      spawn_error: (err instanceof Error ? err.message : String(err)),
      stderr_tail: null,
      started_at: startedAt,
    });
    return EX_FAILED;
  } finally {
    acq.handle.release();
  }
}

function printUsage(stream = process.stderr) {
  stream.write(
    [
      'usage: run-job.mjs <job-name>',
      '       run-job.mjs --list',
      '       run-job.mjs --status [<job-name>]',
      '',
      'Reads data/scheduled-jobs.json. Acquires a file lock, runs the job,',
      'records to ingest_runs, and writes failures to data/audit/job-failures.jsonl.',
      '',
      'Exit codes: 0 ok | 1 job failed | 64 usage error | 75 already locked',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return EX_USAGE;
  }

  if (args[0] === '--list') {
    const manifest = loadManifest();
    const out = listJobs(manifest);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return EX_OK;
  }

  if (args[0] === '--status') {
    const { inspectLock } = await import('../lib/jobLock.ts');
    const manifest = loadManifest();
    const target = args[1];
    const names = target ? [target] : Object.keys(manifest.jobs);
    const out = names.map((name) => ({ name, lock: inspectLock(name) }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return EX_OK;
  }

  if (args[0].startsWith('--')) {
    process.stderr.write(`run-job: unknown flag '${args[0]}'\n`);
    printUsage();
    return EX_USAGE;
  }

  return runJob(args[0]);
}

const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === new URL(`file://${path.resolve(arg)}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const code = await main();
  process.exit(code);
}
