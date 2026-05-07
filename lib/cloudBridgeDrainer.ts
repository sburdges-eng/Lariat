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

import * as queue from './cloudBridgeQueue';
import { pushBatch as defaultPushBatch, type PushResult } from './cloudBridgePush';
import type { OutboxBatch } from './cloudBridgeQueue';
import { getDb } from './db';

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
      const stillInQueue = queue.deadLetterDepth() === 0 || hasRowAlive(batch.id);
      return {
        swept,
        claimed: 1,
        outcome: stillInQueue ? 'nack-retry' : 'nack-dead-letter',
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

  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        // Floating promise is intentional — interval owns scheduling,
        // tickGuarded swallows errors into TickResult.
        void tickGuarded();
      }, tickMs);
      // Don't keep the event loop alive just for the drainer.
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    tick: tickGuarded,
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
