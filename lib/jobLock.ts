/**
 * File-based job lock — concurrent-run prevention for cron-launched
 * Lariat ingest jobs.
 *
 * Lariat runs locally on a single machine. Cron is the scheduler;
 * `scripts/run-job.mjs` is the wrapper cron calls. Two concurrent runs
 * of the same job (e.g. analytics ingest taking longer than its
 * 5-minute cron interval) would race on the DB's DELETE+INSERT pattern
 * and corrupt vendor_prices_history snapshots. This lock is the
 * sequential-exclusion primitive.
 *
 * Atomicity comes from `open(O_CREAT | O_EXCL)` — POSIX guarantees the
 * call fails if the path already exists, even if two processes call it
 * in the same nanosecond.
 *
 * Lockfile contents (JSON):
 *   { pid: number, jobName: string, acquiredAt: ISO-8601 }
 *
 * Two reclamation paths cover the cases where a lockfile outlives the
 * process that wrote it:
 *   1. Dead PID — `process.kill(pid, 0)` raises ESRCH. The lockfile is
 *      orphaned; we delete and retry.
 *   2. Stale age — `mtime` older than staleAfterSec (default 4 hours).
 *      Long-running jobs that exceed this need their `staleAfterSec`
 *      bumped per-job; the default is sized for the longest current
 *      ingest (toast timeseries + analytics ≈ 30 min) plus headroom.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from './dataDir.ts';

const DEFAULT_STALE_AFTER_SEC = 4 * 60 * 60; // 4 hours

export interface LockFileContent {
  pid: number;
  jobName: string;
  acquiredAt: string; // ISO-8601
}

export interface LockHeldInfo extends LockFileContent {
  /** Seconds since lockfile mtime; useful for "lock held N min" reporting. */
  ageSec: number;
}

export interface LockHandle {
  jobName: string;
  pid: number;
  acquiredAt: string;
  lockfilePath: string;
  release(): void;
}

export type AcquireResult =
  | { ok: true; handle: LockHandle }
  | {
      ok: false;
      reason: 'already_locked' | 'lock_dir_unwritable';
      heldBy?: LockHeldInfo;
      error?: string;
    };

export interface AcquireOptions {
  /** Default: <repo>/data/locks. */
  lockDir?: string;
  /** Default: 4 hours. Lockfiles older than this are reclaimable. */
  staleAfterSec?: number;
  /** Override process.pid — only for tests. */
  pid?: number;
  /** Override Date.now-based timestamp — only for tests. */
  now?: () => Date;
  /** Override the liveness probe — only for tests. */
  isPidAlive?: (pid: number) => boolean;
}

function defaultLockDir(): string {
  // Audit M6 (2026-05-14): honor LARIAT_DATA_DIR via the shared
  // resolver. Pre-fix, lockfiles landed at `<cwd>/data/locks` even
  // when SQLite + JSON cache had been relocated via LARIAT_DATA_DIR,
  // splitting the install across two directories. Concurrent-run
  // prevention still worked because both processes shared cwd, but a
  // restart from a different cwd or LARIAT_DATA_DIR layout could
  // orphan locks. Now lock-dir tracks the same root as the rest.
  return path.join(resolveDataDir(), 'locks');
}

function pidAliveDefault(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 doesn't kill — it just probes. Throws ESRCH for dead PIDs,
    // EPERM for live PIDs we don't own (we treat that as alive).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

function readLockfile(p: string): LockFileContent | null {
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.jobName === 'string' &&
      typeof parsed.acquiredAt === 'string'
    ) {
      return parsed as LockFileContent;
    }
    return null;
  } catch {
    return null;
  }
}

function lockfileAgeSec(p: string, nowMs: number): number {
  try {
    const st = fs.statSync(p);
    return Math.max(0, Math.floor((nowMs - st.mtimeMs) / 1000));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Acquire an exclusive lock for `jobName`. Returns immediately — does
 * not block waiting for the holder.
 *
 * Two failure modes:
 *  - `already_locked` — another live process holds the lock; caller
 *    should exit (or retry on the next cron tick).
 *  - `lock_dir_unwritable` — the lock directory itself can't be created
 *    or written to (permissions, full disk, etc.). Operational issue.
 */
export function acquireLock(
  jobName: string,
  opts: AcquireOptions = {},
): AcquireResult {
  if (!/^[a-zA-Z0-9._-]+$/.test(jobName)) {
    return {
      ok: false,
      reason: 'lock_dir_unwritable',
      error: `invalid jobName: ${jobName}`,
    };
  }

  const lockDir = opts.lockDir ?? defaultLockDir();
  const staleAfterSec = opts.staleAfterSec ?? DEFAULT_STALE_AFTER_SEC;
  const pid = opts.pid ?? process.pid;
  const now = (opts.now ?? (() => new Date()))();
  const isAlive = opts.isPidAlive ?? pidAliveDefault;

  try {
    fs.mkdirSync(lockDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: 'lock_dir_unwritable',
      error: (err as Error).message,
    };
  }

  const lockfilePath = path.join(lockDir, `${jobName}.lock`);

  const tryCreate = (): AcquireResult => {
    let fd: number | null = null;
    try {
      fd = fs.openSync(lockfilePath, 'wx');
      const content: LockFileContent = {
        pid,
        jobName,
        acquiredAt: now.toISOString(),
      };
      fs.writeSync(fd, JSON.stringify(content));
      fs.closeSync(fd);
      fd = null; // closed cleanly — don't double-close in finally
      return {
        ok: true,
        handle: {
          jobName,
          pid,
          acquiredAt: content.acquiredAt,
          lockfilePath,
          release: () => releaseLock(lockfilePath, pid),
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') return reclaimOrFail();
      return {
        ok: false,
        reason: 'lock_dir_unwritable',
        error: (err as Error).message,
      };
    } finally {
      // If we opened the fd but writeSync threw before we closed it (e.g.
      // disk-full mid-write), close it now and unlink the partial lockfile
      // so we don't leak the descriptor and don't leave a zero-byte
      // lockfile that the next reclaim cycle has to clean up.
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* already gone */ }
        try { fs.unlinkSync(lockfilePath); } catch { /* already gone */ }
      }
    }
  };

  const reclaimOrFail = (): AcquireResult => {
    const existing = readLockfile(lockfilePath);
    const ageSec = lockfileAgeSec(lockfilePath, now.getTime());

    const isStale = ageSec >= staleAfterSec;
    const isOrphan = existing != null && !isAlive(existing.pid);

    if (isStale || isOrphan) {
      try {
        fs.unlinkSync(lockfilePath);
      } catch {
        // Race: another process already cleaned it up. Fall through to retry.
      }
      return tryCreate(); // single retry — if it fails again the holder is now legit
    }

    if (existing) {
      return {
        ok: false,
        reason: 'already_locked',
        heldBy: { ...existing, ageSec },
      };
    }
    return { ok: false, reason: 'already_locked' };
  };

  return tryCreate();
}

/**
 * Release the lock. Safe to call exactly once per successful acquire.
 * Verifies the lockfile still belongs to us (pid match) before deleting
 * — protects against the case where reclamation logic in a peer
 * process already swapped the lockfile.
 */
export function releaseLock(lockfilePath: string, expectedPid: number): void {
  const existing = readLockfile(lockfilePath);
  if (existing && existing.pid !== expectedPid) {
    // Someone else owns it now (e.g., reclaimed after we crashed).
    // Don't delete a lock we don't hold.
    return;
  }
  try {
    fs.unlinkSync(lockfilePath);
  } catch {
    // Already gone — nothing to do.
  }
}

/**
 * Read-only inspection — useful for `run-job.mjs --status`.
 * Returns null when no lockfile exists.
 */
export function inspectLock(
  jobName: string,
  opts: { lockDir?: string; now?: () => Date } = {},
): LockHeldInfo | null {
  const lockDir = opts.lockDir ?? defaultLockDir();
  const now = (opts.now ?? (() => new Date()))();
  const lockfilePath = path.join(lockDir, `${jobName}.lock`);
  const content = readLockfile(lockfilePath);
  if (!content) return null;
  return { ...content, ageSec: lockfileAgeSec(lockfilePath, now.getTime()) };
}
