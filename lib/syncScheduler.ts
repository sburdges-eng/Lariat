// lib/syncScheduler.ts
//
// Periodic poll loop that ties the T7 stack together end-to-end:
//
//   fetchSyncSince(peer)   →   applyWindow(ops)   →   setReplayCheckpoint
//
// One scheduler instance polls every configured peer once per tick.
// Each peer's checkpoint is independent (per-feed cursor in
// replay_checkpoints), so a slow/unreachable peer doesn't block the
// others — runPeerCycle returns its own result + the caller logs.
//
// Lifecycle mirrors lib/cloudBridgeDrainer.ts:
//   start()           — arm the interval (unref'd; doesn't pin the event loop)
//   stop()            — clear the interval, no other state changes
//   gracefulStop(ms?) — clear the interval + await in-flight ticks
//                       (per-peer) bounded by `ms`. Idempotent.
//   tick()            — run one tick immediately (used by tests and
//                       manual-flush surfaces).

import type { Buffer } from 'node:buffer';
import { applyWindow } from './syncApply.ts';
import { fetchSyncSince } from './syncClient.ts';
import { getReplayCheckpoint, setReplayCheckpoint } from './syncFeed.ts';
import type { SyncFetchResult } from './syncClient.ts';

export interface PeerConfig {
  /** Remote peer's HTTP base URL. */
  baseUrl: string;
  /**
   * Stable checkpoint key for this remote peer's feed. The receiver
   * checkpoints into replay_checkpoints.(peer_id, feed_scope) keyed on
   * this string. Stable across reboots — the design doc recommends the
   * remote's `(host, started_at)` pair, but for v1 the operator's
   * mDNS-friendly hostname is fine (e.g. `lariat-tablet-1.local`).
   */
  feedKey: string;
  /** Optional operator-set label for logs / dashboard. */
  label?: string;
}

export interface SchedulerOpts {
  /** Peers to poll each tick. Empty list is allowed (scheduler no-ops). */
  peers: PeerConfig[];
  /** Interval between full passes. Default 10 s. */
  tickMs?: number;
  /** Caller's own Ed25519 pubkey (hex) — used to sign the GET requests. */
  ourPubKeyHex: string;
  /** Caller's Ed25519 raw 32-byte private seed. */
  ourPrivKey: Buffer;
  /**
   * Caller's stable peerKey() identity — sent as the request's
   * `peer_id` query param so the REMOTE checkpoints into its own
   * replay_checkpoints row for us.
   */
  ourPeerKey: string;
  /** Optional fetch override (test injection). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Default 10 s. */
  fetchTimeoutMs?: number;
}

export type PeerCycleOutcome =
  | 'applied'
  | 'no-new-ops'
  | 'fetch-error'
  | 'apply-skipped';

export interface PeerCycleResult {
  peerLabel: string;
  feedKey: string;
  fromOp: number;
  /** How many ops the applier landed (excluding family-3 skips). */
  applied: number;
  skippedFamily3: number;
  skippedUnknown: number;
  skippedBadPayload: number;
  skippedSchemaDrift: number;
  /** New checkpoint value if it advanced; null if unchanged. */
  newCheckpoint: number | null;
  outcome: PeerCycleOutcome;
  reason?: string;
}

export interface TickResult {
  cycles: PeerCycleResult[];
}

export interface SchedulerHandle {
  start(): void;
  stop(): void;
  gracefulStop(timeoutMs?: number): Promise<void>;
  tick(): Promise<TickResult>;
  isRunning(): boolean;
}

const DEFAULT_TICK_MS = 10_000;

/**
 * Run one fetch+apply+checkpoint cycle against a single peer. Pure
 * function over the (queue, applier, fetcher) trio — no module state
 * — so callers can compose it (e.g. a manual "sync now" button on
 * /management) without inheriting the scheduler's interval.
 */
export async function runPeerCycle(
  peer: PeerConfig,
  opts: Pick<SchedulerOpts, 'ourPubKeyHex' | 'ourPrivKey' | 'ourPeerKey' | 'fetchImpl' | 'fetchTimeoutMs'>,
): Promise<PeerCycleResult> {
  const label = peer.label ?? peer.feedKey;
  const fromOp = getReplayCheckpoint(peer.feedKey, 'remote');

  let res: SyncFetchResult;
  try {
    res = await fetchSyncSince({
      baseUrl: peer.baseUrl,
      peerId: opts.ourPeerKey,
      fromOp,
      ourPubKeyHex: opts.ourPubKeyHex,
      ourPrivKey: opts.ourPrivKey,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.fetchTimeoutMs !== undefined ? { timeoutMs: opts.fetchTimeoutMs } : {}),
    });
  } catch (err) {
    return baseResult(label, peer.feedKey, fromOp, {
      outcome: 'fetch-error',
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (!res.ok) {
    return baseResult(label, peer.feedKey, fromOp, {
      outcome: 'fetch-error',
      reason: `${res.status}: ${res.reason}`,
    });
  }

  if (res.ops.length === 0) {
    return baseResult(label, peer.feedKey, fromOp, { outcome: 'no-new-ops' });
  }

  // Lazy import of db.ts: lets caller (and tests) reset the DB path
  // between cycles without holding a stale handle here.
  const { getDb } = await import('./db.ts');
  const db = getDb();

  const apply = applyWindow(db, res.ops);
  const anyApplied = apply.applied > 0;

  // The cursor advances when ANY op landed in this window. Even a window
  // that's "all family-3 skips" still consumed the window — we don't
  // want to re-fetch the same range forever — so we advance to nextOp
  // (or, when nextOp is null because the window was exhaustive, to the
  // highest rowid the response saw).
  let newCheckpoint: number | null = null;
  if (res.nextOp !== null) {
    setReplayCheckpoint(peer.feedKey, res.nextOp, 'remote');
    newCheckpoint = res.nextOp;
  } else if (res.ops.length > 0) {
    // No more rows after this window. The applier's contract doesn't
    // expose rowids (they're a server-side detail), so we use fromOp +
    // ops.length as a coarse advance. The server-side replaySince
    // re-validates `> from_op` so a duplicate slice on a re-pull is
    // safe (op_id idempotency on the producer side).
    const advance = fromOp + res.ops.length;
    setReplayCheckpoint(peer.feedKey, advance, 'remote');
    newCheckpoint = advance;
  }

  return baseResult(label, peer.feedKey, fromOp, {
    outcome: anyApplied ? 'applied' : 'apply-skipped',
    newCheckpoint,
    applied: apply.applied,
    skippedFamily3: apply.skippedFamily3,
    skippedUnknown: apply.skippedUnknown,
    skippedBadPayload: apply.skippedBadPayload,
    skippedSchemaDrift: apply.skippedSchemaDrift,
    reason: apply.reasons.length ? apply.reasons.slice(0, 3).join(' | ') : undefined,
  });
}

function baseResult(
  peerLabel: string,
  feedKey: string,
  fromOp: number,
  over: Partial<PeerCycleResult> & { outcome: PeerCycleOutcome },
): PeerCycleResult {
  return {
    peerLabel,
    feedKey,
    fromOp,
    applied: 0,
    skippedFamily3: 0,
    skippedUnknown: 0,
    skippedBadPayload: 0,
    skippedSchemaDrift: 0,
    newCheckpoint: null,
    ...over,
  };
}

/**
 * Create a scheduler instance. Each instance owns one setInterval
 * handle. `tick()` runs the per-peer cycle in parallel (Promise.all)
 * so a slow peer doesn't serialize the others.
 */
export function createScheduler(opts: SchedulerOpts): SchedulerHandle {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTickP: Promise<TickResult> | null = null;

  async function runTick(): Promise<TickResult> {
    if (opts.peers.length === 0) return { cycles: [] };
    const results = await Promise.all(
      opts.peers.map((peer) =>
        runPeerCycle(peer, {
          ourPubKeyHex: opts.ourPubKeyHex,
          ourPrivKey: opts.ourPrivKey,
          ourPeerKey: opts.ourPeerKey,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          ...(opts.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: opts.fetchTimeoutMs } : {}),
        }).catch((err) =>
          baseResult(peer.label ?? peer.feedKey, peer.feedKey, 0, {
            outcome: 'fetch-error',
            reason: err instanceof Error ? err.message : String(err),
          }),
        ),
      ),
    );
    return { cycles: results };
  }

  async function tickTracked(): Promise<TickResult> {
    if (inFlightTickP) return inFlightTickP;
    const p = runTick();
    inFlightTickP = p;
    try {
      return await p;
    } finally {
      if (inFlightTickP === p) inFlightTickP = null;
    }
  }

  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        void tickTracked();
      }, tickMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    async gracefulStop(timeoutMs: number = 5000): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlightTickP !== null) {
        const pending = inFlightTickP;
        const timeout = new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(0, timeoutMs)).unref?.(),
        );
        try {
          await Promise.race([pending, timeout]);
        } catch {
          // tick errors fold into TickResult; never throw here.
        }
      }
    },
    tick: tickTracked,
    isRunning() {
      return timer !== null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Module-level singleton — mirrors createDrainer/startDrainer pattern.
// ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__lariatSyncSchedulerHandle';

export function startScheduler(opts: SchedulerOpts): SchedulerHandle {
  const g = globalThis as Record<string, unknown>;
  let handle = g[GLOBAL_KEY] as SchedulerHandle | undefined;
  if (!handle) {
    handle = createScheduler(opts);
    g[GLOBAL_KEY] = handle;
  }
  handle.start();
  return handle;
}

export function stopScheduler(): void {
  const g = globalThis as Record<string, unknown>;
  const handle = g[GLOBAL_KEY] as SchedulerHandle | undefined;
  if (handle) handle.stop();
}

/** Test-only: clear the singleton handle without stopping it. */
export function _resetSchedulerForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}
