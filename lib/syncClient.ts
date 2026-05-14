// lib/syncClient.ts
//
// Pull side of cross-host sync. Fetches one window of ops from a peer's
// /api/peers/sync-since with the Ed25519-signed-request contract from
// lib/peerTrust.ts and lib/peerKeypair.ts. The applier
// (lib/syncApply.ts::applyWindow) is the next layer — this module only
// owns the network call + signing + response parsing.
//
// Pure-network, no DB. Caller threads in its own keypair + peerId so the
// module is unit-testable without filesystem state.
//
// The two halves of T7 share the canonical signing payload contract
// (frozen at v1): `${method}\n${pathname}\n${query}\n${timestampIso}`.

import { canonicalSigningPayload } from './peerTrust.ts';
import { signProof } from './peerKeypair.ts';
import type { Buffer } from 'node:buffer';
import type { SyncOp } from './syncFeed.ts';

export interface SyncClientOpts {
  /** Base URL of the peer, e.g. `http://lariat-tablet-1.local:3000`. */
  baseUrl: string;
  /**
   * Caller's stable peerKey() identity — `(host, started_at)` per
   * lib/hubFailover.ts. Echoed back in the response body.
   */
  peerId: string;
  /** Highest rowid the caller has applied from this peer's feed. */
  fromOp: number;
  /** Optional page size (default 500 server-side; max 2000). */
  limit?: number;
  /** Caller's raw 32-byte Ed25519 pubkey (hex). */
  ourPubKeyHex: string;
  /** Caller's raw 32-byte Ed25519 private seed. */
  ourPrivKey: Buffer;
  /** Optional override for the global fetch (test injection). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Default 10s. */
  timeoutMs?: number;
  /**
   * Test-only override for the "now" timestamp baked into the
   * X-Lariat-Timestamp header. Production callers leave this unset.
   */
  nowMs?: number;
}

export type SyncFetchResult =
  | {
      ok: true;
      peerId: string;
      fromOp: number;
      ops: SyncOp[];
      nextOp: number | null;
      /**
       * Highest rowid the server observed in this scan. Receivers use
       * this for unconditional checkpoint advance per audit H3 — see
       * lib/syncScheduler.runPeerCycle. Always present on a successful
       * response; falls back to `fromOp` when the server returned no
       * ops (i.e., already caught up).
       */
      lastSeenId: number;
      callerFingerprint: string;
    }
  | {
      ok: false;
      status: number;
      reason: string;
    };

const DEFAULT_TIMEOUT_MS = 10_000;

/** Fetch one sync-since window from a peer. */
export async function fetchSyncSince(opts: SyncClientOpts): Promise<SyncFetchResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 0, reason: 'no fetch available' };
  }

  const url = new URL('/api/peers/sync-since', opts.baseUrl);
  url.searchParams.set('peer_id', opts.peerId);
  url.searchParams.set('from_op', String(Math.max(0, Math.floor(opts.fromOp))));
  if (opts.limit !== undefined) {
    url.searchParams.set('limit', String(Math.max(1, Math.floor(opts.limit))));
  }

  const pathname = url.pathname;
  // url.search starts with '?'; the signing contract excludes the leading '?'.
  const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const timestampIso = new Date(opts.nowMs ?? Date.now()).toISOString();
  const payload = canonicalSigningPayload('GET', pathname, query, timestampIso);
  const signatureHex = signProof(opts.ourPrivKey, payload);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'X-Lariat-Peer-Pubkey': opts.ourPubKeyHex,
        'X-Lariat-Timestamp': timestampIso,
        'X-Lariat-Signature': signatureHex,
      },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : 'fetch threw';
    return { ok: false, status: 0, reason };
  }
  clearTimeout(timer);

  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) reason = `HTTP ${res.status}: ${body.error}`;
    } catch {
      // ignore parse error
    }
    return { ok: false, status: res.status, reason };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, reason: 'invalid JSON body' };
  }
  if (body === null || typeof body !== 'object') {
    return { ok: false, status: res.status, reason: 'response is not an object' };
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.ops)) {
    return { ok: false, status: res.status, reason: 'response.ops missing or not an array' };
  }
  // next_op is number | null. Pass through whatever the server sent;
  // applier doesn't need to distinguish "missing" from "null".
  const nextOp =
    typeof b.next_op === 'number' && Number.isFinite(b.next_op) ? b.next_op : null;
  const callerFingerprint = typeof b.caller_fingerprint === 'string' ? b.caller_fingerprint : '';
  // Audit H3: prefer the server-reported last_seen_id for checkpoint
  // advance. Fall back to fromOp when the server omits it (pre-H3
  // routes) — that's the pre-fix behavior, which is no worse than what
  // the receiver had before.
  const fromOpEcho = typeof b.from_op === 'number' ? b.from_op : opts.fromOp;
  const lastSeenId =
    typeof b.last_seen_id === 'number' && Number.isFinite(b.last_seen_id)
      ? b.last_seen_id
      : fromOpEcho;

  return {
    ok: true,
    peerId: typeof b.peer_id === 'string' ? b.peer_id : opts.peerId,
    fromOp: fromOpEcho,
    ops: b.ops as SyncOp[],
    nextOp,
    lastSeenId,
    callerFingerprint,
  };
}
