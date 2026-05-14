// Cloud-bridge drainer (Item 8).
//
// What this module IS: the long-running tick loop that drains
// cloud_bridge_outbox to the cloud peer. On each tick:
//   sweepStaleClaims → claim(1) → pushBatch → ack | nack
//
// What this module is NOT:
//   - Not the HTTP client. lib/cloudBridgePush.ts owns that.
//   - Not the queue. lib/cloudBridgeQueue.ts owns durability +
//     allow-list + dead-letter semantics.
//   - Not a retry policy. The queue's nack + DEFAULT_MAX_ATTEMPTS
//     decide when a transient failure becomes dead-letter.
//
// Single-batch claim per tick is intentional (plan §"Tick storm under
// outage"): keeps the per-tick work bounded so an outage burst doesn't
// hold the SQLite WAL open for the full backlog.
//
// Idempotency: createDrainer().start() is a no-op if the interval is
// already armed. The startDrainer() / stopDrainer() module-level
// helpers stash a single instance on globalThis so multiple imports
// (instrumentation hook + standalone script) can't double-tick.

import * as queue from './cloudBridgeQueue.ts';
import { pushBatch as defaultPushBatch, type PushResult } from './cloudBridgePush.ts';
import type { OutboxBatch } from './cloudBridgeQueue.ts';
import { getDb } from './db.ts';

export type PushBatchFn = (
  batch: OutboxBatch,
  opts: { url: string; secret: string; timeoutMs?: number },
) => Promise<PushResult>;

export interface DrainerOpts {
  /** Interval between ticks. Default 30_000ms (30s). */
  tickMs?: number;
  /** Cloud peer base URL. Defaults to env LARIAT_CLOUD_BRIDGE_URL. */
  url?: string;
  /** Per-location HMAC secret. Defaults to env LARIAT_CLOUD_BRIDGE_SECRET. */
  secret?: string;
  /** Inject a stub for tests. Defaults to lib/cloudBridgePush.ts::pushBatch. */
  pushBatch?: PushBatchFn;
  /** Wall-clock per request. Forwarded to pushBatch. */
  pushTimeoutMs?: number;
  /** Stale-claim sweep threshold in seconds. Default 300 (5 min). */
  staleClaimAgeSec?: number;
}

export interface TickResult {
  /** Rows reset by sweepStaleClaims (orphaned in-flight claims). */
  swept: number;
  /** Batches claimed this tick (0 or 1 in v1). */
  claimed: number;
  /** What happened to the claimed batch, if any. */
  outcome?: 'ack' | 'nack-retry' | 'nack-dead-letter' | 'no-op';
  /** Last error message — populated when outcome is nack-* or pushBatch threw. */
  error?: string;
}

export interface DrainerHandle {
  /** Arm the interval. Idempotent — second call is a no-op. */
  start(): void;
  /** Stop the interval. Idempotent — second call is a no-op. */
  stop(): void;
  /**
   * Graceful shutdown for SIGTERM/SIGINT: stop the interval, await any
   * in-flight tick to settle (up to `timeoutMs`), then release every
   * still-claimed row back to the queue so the next drainer doesn't
   * have to wait the full staleClaimAgeSec window. Idempotent.
   *
   * Returns the number of rows released. The legacy signature is
   * preserved; for incident-response visibility, call
   * `gracefulStopVerbose` instead — it returns { released, awaitedMs }.
   */
  gracefulStop(timeoutMs?: number): Promise<number>;
  /**
   * Audit L4 (2026-05-14): same as gracefulStop but returns both the
   * released-rows count AND how long the in-flight-tick wait took.
   * Operators running `npm run cloud-bridge:drain` see a more useful
   * shutdown log line than just "stopped (N claims released)".
   */
  gracefulStopVerbose(timeoutMs?: number): Promise<{ released: number; awaitedMs: number }>;
  /** Run one tick synchronously. Used by the interval and by tests/manual flush. */
  tick(): Promise<TickResult>;
  /** Whether the interval is currently armed. */
  isRunning(): boolean;
}

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_STALE_CLAIM_AGE_SEC = 300;

/**
 * Create a drainer instance bound to the given config. Each instance
 * owns one setInterval handle. `tick()` is exposed for tests and for
 * manual flush ("drain now") buttons.
 *
 * Errors inside a tick never throw out — they fold into TickResult so
 * the interval keeps running. A transient failure (5xx, network,
 * timeout, unexpected throw) routes through `nack` so the queue's
 * DEFAULT_MAX_ATTEMPTS budget governs dead-lettering, not the drainer.
 */
export function createDrainer(opts: DrainerOpts = {}): DrainerHandle {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const url = opts.url ?? process.env.LARIAT_CLOUD_BRIDGE_URL;
  const secret = opts.secret ?? process.env.LARIAT_CLOUD_BRIDGE_SECRET;
  const push = opts.pushBatch ?? defaultPushBatch;
  const staleAge = opts.staleClaimAgeSec ?? DEFAULT_STALE_CLAIM_AGE_SEC;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  async function runTick(): Promise<TickResult> {
    const swept = queue.sweepStaleClaims(staleAge);

    if (!url || !secret) {
      // Configured guard: no point claiming if we can't push.
      return { swept, claimed: 0, outcome: 'no-op', error: 'bridge unconfigured' };
    }

    const [batch] = queue.claim(1);
    if (!batch) {
      return { swept, claimed: 0, outcome: 'no-op' };
    }

    let result: PushResult;
    try {
      result = await push(batch, {
        url,
        secret,
        ...(opts.pushTimeoutMs !== undefined ? { timeoutMs: opts.pushTimeoutMs } : {}),
      });
    } catch (err: unknown) {
      // Treat unexpected throws as transient — nack and let the queue
      // budget govern dead-lettering. The error string lands in the
      // outbox row's last_error for triage.
      const reason = err instanceof Error ? err.message : 'pushBatch threw';
      queue.nack(batch.id, reason);
      // Audit L2 (2026-05-14): pre-fix this read
      //   `deadLetterDepth() === 0 || hasRowAlive(batch.id)`
      // The `|| hasRowAlive(...)` is the load-bearing check —
      // hasRowAlive returns true when the row is queued (not dead-
      // lettered) and false when nack pushed it past max-attempts.
      // The deadLetterDepth() check is redundant noise: when depth is
      // zero, hasRowAlive is the only honest answer; when depth is
      // non-zero AND the row is alive, the OR still picks "alive."
      // Removed for clarity. Behaviour identical.
      return {
        swept,
        claimed: 1,
        outcome: hasRowAlive(batch.id) ? 'nack-retry' : 'nack-dead-letter',
        error: reason,
      };
    }

    if (result.ok) {
      queue.ack(batch.id);
      return { swept, claimed: 1, outcome: 'ack' };
    }
    if (result.permanent) {
      // Permanent rejects (4xx-style) drop without burning retry
      // budget. The cloud-side body's reason string lands in logs at
      // the call site that surfaces this in /management/cloud-bridge
      // (Item 9, follow-up).
      queue.ack(batch.id);
      return {
        swept,
        claimed: 1,
        outcome: 'ack',
        error: `permanent: ${result.status ?? '?'} ${result.reason ?? ''}`.trim(),
      };
    }

    // Transient — nack and let the queue decide retry-vs-dead-letter.
    const reason = result.reason ?? `transient ${result.status ?? ''}`.trim();
    queue.nack(batch.id, reason);
    const outcome: TickResult['outcome'] = hasRowAlive(batch.id)
      ? 'nack-retry'
      : 'nack-dead-letter';
    return { swept, claimed: 1, outcome, error: reason };
  }

  async function tickGuarded(): Promise<TickResult> {
    if (inFlight) return { swept: 0, claimed: 0, outcome: 'no-op' };
    inFlight = true;
    try {
      return await runTick();
    } finally {
      inFlight = false;
    }
  }

  // Tracks the current in-flight tick promise so gracefulStop can
  // await its settlement before releasing claims.
  let inFlightPromise: Promise<TickResult> | null = null;

  async function tickGuardedTracked(): Promise<TickResult> {
    if (inFlight) return { swept: 0, claimed: 0, outcome: 'no-op' };
    const p = (async () => tickGuarded())();
    inFlightPromise = p;
    try {
      return await p;
    } finally {
      if (inFlightPromise === p) inFlightPromise = null;
    }
  }

  // Inner helper shared by gracefulStop (back-compat shape) and
  // gracefulStopVerbose (audit L4). Returns both rows-released and
  // the await-duration so operators can log the shutdown cost.
  async function gracefulStopInner(timeoutMs: number): Promise<{ released: number; awaitedMs: number }> {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    let awaitedMs = 0;
    if (inFlightPromise !== null) {
      const start = Date.now();
      const pending = inFlightPromise;
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, timeoutMs)).unref?.(),
      );
      try {
        await Promise.race([pending, timeout]);
      } catch {
        // Tick errors fold into TickResult; never throw here.
      }
      awaitedMs = Date.now() - start;
    }
    const released = queue.releaseAllClaimedRows();
    return { released, awaitedMs };
  }

  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        // Floating promise is intentional — interval owns scheduling,
        // tickGuarded swallows errors into TickResult.
        void tickGuardedTracked();
      }, tickMs);
      // Don't keep the event loop alive just for the drainer.
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    async gracefulStop(timeoutMs: number = 5000): Promise<number> {
      const r = await gracefulStopInner(timeoutMs);
      return r.released;
    },
    async gracefulStopVerbose(timeoutMs: number = 5000): Promise<{ released: number; awaitedMs: number }> {
      return gracefulStopInner(timeoutMs);
    },
    tick: tickGuardedTracked,
    isRunning() {
      return timer !== null;
    },
  };
}

/**
 * Helper: did the row survive nack? (i.e., it's queued for retry, not
 * dead-lettered yet). Reads cloud_bridge_outbox directly because the
 * queue's depth() can't distinguish "this specific row" — sweepStaleClaims
 * + concurrent inserts could change depth between calls.
 */
function hasRowAlive(id: number): boolean {
  const row = getDb()
    .prepare('SELECT dead_letter FROM cloud_bridge_outbox WHERE id = ?')
    .get(id) as { dead_letter: number } | undefined;
  if (!row) return false; // ack'd elsewhere
  return row.dead_letter === 0;
}

// ─────────────────────────────────────────────────────────────────
// Module-level singleton (used by instrumentation.ts wire-in + the
// standalone script). Multiple start() calls are idempotent.
// ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__lariatCloudBridgeDrainerHandle';

/**
 * Start the singleton drainer. Idempotent across imports — multiple
 * calls return the same handle.
 */
export function startDrainer(opts: DrainerOpts = {}): DrainerHandle {
  const g = globalThis as Record<string, unknown>;
  let handle = g[GLOBAL_KEY] as DrainerHandle | undefined;
  if (!handle) {
    handle = createDrainer(opts);
    g[GLOBAL_KEY] = handle;
  }
  handle.start();
  return handle;
}

/** Stop the singleton drainer. No-op if never started. */
export function stopDrainer(): void {
  const g = globalThis as Record<string, unknown>;
  const handle = g[GLOBAL_KEY] as DrainerHandle | undefined;
  if (handle) handle.stop();
}
