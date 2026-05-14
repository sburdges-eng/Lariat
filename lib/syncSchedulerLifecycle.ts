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
 * Audit M2 (2026-05-14): refuse baseUrls that point at non-HTTP(S)
 * schemes or LAN-private hosts unless LARIAT_SYNC_ALLOW_PRIVATE=1.
 *
 * Threat model: if an attacker can influence LARIAT_SYNC_PEERS
 * (compromised settings.json, env-var injection on the host), they
 * can otherwise point the scheduler at `file:///etc/passwd` or
 * `http://169.254.169.254/latest/meta-data/` (AWS metadata SSRF).
 * The scheduler signs its outbound requests with our Ed25519 key so
 * the attacker would also get a signed exfil channel.
 *
 * Allowed: http: and https: only.
 * Allowed hosts: anything NOT in (localhost / loopback / link-local /
 * RFC1918). LAN-private hosts are exactly the legitimate target for
 * LAN sync, so we keep them under an opt-in env knob —
 * LARIAT_SYNC_ALLOW_PRIVATE=1 — which the typical LAN deployment sets
 * explicitly. Production hosted setups leave it unset and only sync
 * to public peers.
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // Node's URL.hostname returns IPv6 addrs wrapped in brackets ("[::1]").
  // Strip them so the literal comparisons below match.
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // mDNS .local — fine for LAN sync, but classed as "private" so the
  // opt-in env knob still gates it.
  if (h.endsWith('.local')) return true;
  if (h === '127.0.0.1' || h === '::1') return true;
  // IPv4 RFC1918 + link-local.
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  // IPv6 link-local.
  if (h.startsWith('fe80:')) return true;
  // IPv6 unique-local.
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  return false;
}

export function isAllowedBaseUrl(
  baseUrl: string,
  allowPrivate: boolean = process.env.LARIAT_SYNC_ALLOW_PRIVATE === '1',
): boolean {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!allowPrivate && isPrivateOrLoopbackHost(u.hostname)) return false;
  return true;
}

/**
 * Parse LARIAT_SYNC_PEERS into a typed PeerConfig[]. Returns [] for
 * anything malformed or absent so the scheduler stays dormant rather
 * than crashing the Next worker boot. Audit M2: rejects file://,
 * data://, javascript://, and LAN-private hosts unless
 * LARIAT_SYNC_ALLOW_PRIVATE=1 (the typical LAN sync deployment).
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
    const baseUrl = obj.baseUrl.trim();
    if (!isAllowedBaseUrl(baseUrl)) continue;
    const peer: PeerConfig = {
      baseUrl,
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
  // Audit M1 (2026-05-14): default ourPeerKey to the (host, started_at)
  // identity from lib/localIdentity.ts. Pre-fix the default was
  // process.pid — PIDs are reused across reboots, so a remote's
  // replay_checkpoints row for "peer 1234" would silently mis-track us
  // after any restart that happened to reuse the same PID. The
  // host+ISO-timestamp pair is stable per boot and fresh after every
  // reboot. LARIAT_SYNC_PEER_KEY env override still wins when set.
  const { getLocalHost, getStartedAt } = await import('./localIdentity.ts');
  const defaultPeerKey = `hs:${getLocalHost()}|${getStartedAt()}`;
  const ourPeerKey =
    opts.envOurPeerKey ?? process.env.LARIAT_SYNC_PEER_KEY ?? defaultPeerKey;

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
