/**
 * Sync-scheduler lifecycle helper.
 *
 * Mirrors `lib/cloudBridgeDrainerLifecycle.ts` so `instrumentation.ts`
 * can boot the scheduler with one line. One public entry point:
 *
 *   - bootSyncScheduler() — call from instrumentation.register().
 *     Reads config from env:
 *       LARIAT_SYNC_PEERS     JSON array of { baseUrl, feedKey, label? }
 *       LARIAT_SYNC_TICK_MS   integer, default 10000
 *       LARIAT_SYNC_PEER_KEY  our peerKey() identity sent as request peer_id
 *     If LARIAT_SYNC_PEERS is absent or [] the scheduler logs a one-line
 *     skip and returns. Otherwise loads the local Ed25519 keypair via
 *     lib/peerKeypair.ts::loadOrCreateKeypair, calls startScheduler(),
 *     stashes a `booted` flag on globalThis, installs SIGTERM/SIGINT
 *     handlers (once).
 *
 * Why a separate file from instrumentation.ts: lib/syncScheduler.ts
 * imports lib/syncApply.ts which imports lib/db.ts (better-sqlite3),
 * and webpack must not bundle that into the edge runtime.
 * instrumentation.ts dynamic-imports this file under the NEXT_RUNTIME
 * Node guard, so the SQLite chain only loads in the Node worker.
 *
 * Idempotency: stash key on globalThis matches the drainer pattern.
 * Next HMR re-runs the boot hook; the second call short-circuits.
 *
 * Mutual exclusion with the standalone scheduler (not yet shipped —
 * Phase 4 follow-on): same claim/ack semantics apply at the
 * sync_feed + replay_checkpoints layer, so two schedulers racing for
 * the same feed are correct.
 */

import type { Buffer } from 'node:buffer';
import type { PeerConfig, SchedulerHandle, SchedulerOpts } from './syncScheduler.ts';

type StartFn = (_opts: SchedulerOpts) => SchedulerHandle;
type StopFn = () => void;
type LoadKeypairFn = () => { pubKey: Buffer; privKey: Buffer };

interface LifecycleStash {
  booted: boolean;
  signalsInstalled: boolean;
}

const HANDLE_KEY = '__lariatSyncSchedulerLifecycle' as const;

declare global {

  var __lariatSyncSchedulerLifecycle: LifecycleStash | undefined;
}

function getStash(): LifecycleStash {
  let stash = globalThis[HANDLE_KEY];
  if (!stash) {
    stash = { booted: false, signalsInstalled: false };
    globalThis[HANDLE_KEY] = stash;
  }
  return stash;
}

function installSignalHandlersOnce(stash: LifecycleStash, stop: StopFn): void {
  if (stash.signalsInstalled) return;
  stash.signalsInstalled = true;
  const onSignal = (signal: NodeJS.Signals): void => {
    console.log(`[sync-scheduler] ${signal} received, stopping…`);
    stop();
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

/**
 * Parse LARIAT_SYNC_PEERS into a typed PeerConfig[]. Returns [] for
 * anything malformed or absent so the scheduler stays dormant rather
 * than crashing the Next worker boot.
 */
export function parsePeersEnv(raw: string | undefined | null): PeerConfig[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PeerConfig[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.baseUrl !== 'string' || !obj.baseUrl.trim()) continue;
    if (typeof obj.feedKey !== 'string' || !obj.feedKey.trim()) continue;
    const peer: PeerConfig = {
      baseUrl: obj.baseUrl.trim(),
      feedKey: obj.feedKey.trim(),
    };
    if (typeof obj.label === 'string' && obj.label.trim()) {
      peer.label = obj.label.trim();
    }
    out.push(peer);
  }
  return out;
}

export interface BootOptions {
  customStart?: StartFn;
  customStop?: StopFn;
  customLoadKeypair?: LoadKeypairFn;
  /** Test-only: override the env reads. */
  envPeersJson?: string;
  envTickMs?: number;
  envOurPeerKey?: string;
}

export async function bootSyncScheduler(opts: BootOptions = {}): Promise<void> {
  const stash = getStash();
  if (stash.booted) return;

  let start = opts.customStart;
  let stop = opts.customStop;
  let loadKeypair = opts.customLoadKeypair;

  if (!start || !stop || !loadKeypair) {
    const sched = await import('./syncScheduler.ts');
    const keypairMod = await import('./peerKeypair.ts');
    start ??= sched.startScheduler;
    stop ??= sched.stopScheduler;
    loadKeypair ??= keypairMod.loadOrCreateKeypair;
  }

  // C1 audit-finding boot guard: refuse to start the scheduler if
  // FAMILY_*_TABLES doesn't match the live schema. Without this, a
  // typo in a table name produces "skipped-unknown-table" forever and
  // the operator dashboard counts the loss as zero. We'd rather crash
  // the worker boot than ship silently-lossy sync.
  try {
    const { assertFamilyTablesExist } = await import('./syncApply.ts');
    const { getDb } = await import('./db.ts');
    assertFamilyTablesExist(getDb());
  } catch (err) {
    console.error('[sync-scheduler] schema-name check failed:', err);
    throw err;
  }

  const peers = parsePeersEnv(
    opts.envPeersJson ?? process.env.LARIAT_SYNC_PEERS ?? null,
  );
  if (peers.length === 0) {
    console.log(
      '[sync-scheduler] skipped — no peers configured ' +
        '(set LARIAT_SYNC_PEERS to a JSON array of { baseUrl, feedKey })',
    );
    return;
  }

  const tickMs =
    opts.envTickMs ?? (Number(process.env.LARIAT_SYNC_TICK_MS) || 10_000);
  const ourPeerKey =
    opts.envOurPeerKey ?? process.env.LARIAT_SYNC_PEER_KEY ?? `${process.pid}`;

  const { pubKey, privKey } = loadKeypair();

  start({
    peers,
    tickMs,
    ourPubKeyHex: pubKey.toString('hex'),
    ourPrivKey: privKey,
    ourPeerKey,
  });
  stash.booted = true;
  installSignalHandlersOnce(stash, stop);

  console.log(
    `[sync-scheduler] started (tickMs=${tickMs}, peers=${peers.length}, ` +
      `labels=[${peers.map((p) => p.label ?? p.feedKey).join(',')}])`,
  );
}

/** Test-only: reset booted/signal flags without stopping the scheduler. */
export function _resetSyncSchedulerLifecycleForTests(): void {
  globalThis[HANDLE_KEY] = undefined;
}
