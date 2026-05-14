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

// Audit M11 (2026-05-14): cap on the response body size we'll buffer
// before parsing JSON. A misbehaving or malicious peer could otherwise
// stream a 1 GB JSON document and exhaust the puller's memory. 10 MB
// is far above realistic sync windows (default 500 ops × ~2 KB row =
// ~1 MB) and well below buffer-DoS territory. Override via
// LARIAT_SYNC_MAX_BODY_BYTES if a deployment needs bigger.
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

function maxBodyBytes(): number {
  const env = Number(process.env.LARIAT_SYNC_MAX_BODY_BYTES);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Read a Response body with a size cap. Reads chunks via the streaming
 * body reader and accumulates up to `maxBytes` — returns an error if
 * the body exceeds that bound. Falls back to `res.text()` if the body
 * stream isn't available (older runtimes, Polyfilled fetch).
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  // Content-Length short-circuit when present.
  const len = res.headers.get('content-length');
  if (len !== null) {
    const n = Number(len);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, reason: `body too large (${n} > ${maxBytes})` };
    }
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) {
      return { ok: false, reason: `body too large (${text.length} > ${maxBytes})` };
    }
    return { ok: true, text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder('utf-8');
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Best-effort cancel to free the underlying connection.
      try { await reader.cancel('body too large'); } catch { /* ignore */ }
      return { ok: false, reason: `body too large (${total} > ${maxBytes})` };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { ok: true, text: decoder.decode(buf) };
}

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
      // Audit M11: cap the error-body read too — a hostile peer can
      // serve a huge error body just as easily as a huge success body.
      const cap = await readBodyCapped(res, maxBodyBytes());
      if (cap.ok) {
        try {
          const body = JSON.parse(cap.text) as { error?: string };
          if (body?.error) reason = `HTTP ${res.status}: ${body.error}`;
        } catch {
          // ignore parse error
        }
      }
    } catch {
      // ignore read error
    }
    return { ok: false, status: res.status, reason };
  }

  // Audit M11: bound body buffering to maxBodyBytes() to defend against
  // a peer that serves a huge JSON payload and exhausts our memory.
  const cap = await readBodyCapped(res, maxBodyBytes());
  if (!cap.ok) {
    return { ok: false, status: res.status, reason: cap.reason };
  }
  let body: unknown;
  try {
    body = JSON.parse(cap.text);
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
