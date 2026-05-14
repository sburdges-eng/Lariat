// lib/peerTrust.ts
//
// Per-instance peer allowlist for cross-host sync. Operators add a
// peer's raw 32-byte Ed25519 pubkey (hex) here before that peer is
// allowed to call /api/peers/sync-since. Revocation flips `revoked`
// to 1 without removing the row — keeps the audit trail.
//
// Signing payload contract (frozen as part of the public v1 wire
// contract — DO NOT change without a versioned migration):
//
//   `${method}\n${pathname}\n${query}\n${timestampIso}`
//
// e.g. GET /api/peers/sync-since?peer_id=hub&from_op=42 at
//      2026-05-14T10:11:12Z is signed as:
//
//   GET\n/api/peers/sync-since\npeer_id=hub&from_op=42\n2026-05-14T10:11:12Z
//
// Query string is the raw `request.url.search` (sans leading '?'). The
// timestamp is the X-Lariat-Timestamp header value verbatim. The server
// rejects timestamps older than CLOCK_SKEW_WINDOW_MS to defeat
// signed-request replay.

import type { Database as DB } from 'better-sqlite3';
import { Buffer } from 'node:buffer';
import { fingerprint as fingerprintOf, verifyProof } from './peerKeypair.ts';

export const CLOCK_SKEW_WINDOW_MS = 60_000;

export interface PeerTrustRow {
  pubkey_hex: string;
  fingerprint: string;
  label: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked: number;
}

export function addPeer(
  db: DB,
  pubkeyHex: string,
  label: string | null = null,
): PeerTrustRow {
  const norm = pubkeyHex.toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(norm)) {
    throw new Error(`addPeer: pubkey_hex must be 64 hex chars (raw 32-byte Ed25519 pubkey)`);
  }
  const fp = fingerprintOf(Buffer.from(norm, 'hex'));
  db.prepare(
    `INSERT INTO peer_trust (pubkey_hex, fingerprint, label, created_at, revoked)
     VALUES (?, ?, ?, datetime('now'), 0)
     ON CONFLICT(pubkey_hex) DO UPDATE SET
       label   = excluded.label,
       revoked = 0`,
  ).run(norm, fp, label);
  return getPeerByPubkey(db, norm) as PeerTrustRow;
}

export function revokePeer(db: DB, pubkeyHex: string): boolean {
  const norm = pubkeyHex.toLowerCase().trim();
  const info = db
    .prepare(`UPDATE peer_trust SET revoked = 1 WHERE pubkey_hex = ?`)
    .run(norm);
  return info.changes > 0;
}

export function getPeerByPubkey(db: DB, pubkeyHex: string): PeerTrustRow | null {
  const norm = pubkeyHex.toLowerCase().trim();
  return (
    (db
      .prepare(`SELECT * FROM peer_trust WHERE pubkey_hex = ?`)
      .get(norm) as PeerTrustRow | undefined) ?? null
  );
}

export function getPeerByFingerprint(db: DB, fp: string): PeerTrustRow | null {
  return (
    (db
      .prepare(`SELECT * FROM peer_trust WHERE fingerprint = ?`)
      .get(fp) as PeerTrustRow | undefined) ?? null
  );
}

export function listPeers(db: DB): PeerTrustRow[] {
  return db
    .prepare(`SELECT * FROM peer_trust ORDER BY created_at ASC`)
    .all() as PeerTrustRow[];
}

export function touchPeerLastSeen(db: DB, pubkeyHex: string): void {
  const norm = pubkeyHex.toLowerCase().trim();
  db.prepare(
    `UPDATE peer_trust SET last_seen_at = datetime('now') WHERE pubkey_hex = ?`,
  ).run(norm);
}

export function canonicalSigningPayload(
  method: string,
  pathname: string,
  query: string,
  timestampIso: string,
): string {
  return `${method}\n${pathname}\n${query}\n${timestampIso}`;
}

export type AuthResult =
  | { ok: true; peer: PeerTrustRow }
  | { ok: false; status: number; reason: string };

/**
 * Authenticate a sync-since request. Pure validator — no DB writes.
 * Call touchPeerLastSeen(...) separately on the happy path so the
 * audit trail records the contact without making the auth path itself
 * mutating.
 *
 * Returns the trusted peer on success, or a structured failure with
 * the HTTP status the caller should return.
 */
export function authenticateSyncRequest(
  db: DB,
  method: string,
  pathname: string,
  query: string,
  headers: {
    pubkeyHex?: string | null;
    timestampIso?: string | null;
    signatureHex?: string | null;
  },
  nowMs: number = Date.now(),
): AuthResult {
  const pubkey = headers.pubkeyHex?.toLowerCase().trim();
  const timestamp = headers.timestampIso?.trim();
  const sig = headers.signatureHex?.toLowerCase().trim();

  if (!pubkey || !timestamp || !sig) {
    return { ok: false, status: 401, reason: 'missing auth headers' };
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return { ok: false, status: 401, reason: 'malformed pubkey' };
  }
  if (!/^[0-9a-f]+$/.test(sig)) {
    return { ok: false, status: 401, reason: 'malformed signature' };
  }

  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) {
    return { ok: false, status: 401, reason: 'malformed timestamp' };
  }
  if (Math.abs(nowMs - ts) > CLOCK_SKEW_WINDOW_MS) {
    return { ok: false, status: 401, reason: 'timestamp outside clock-skew window' };
  }

  const peer = getPeerByPubkey(db, pubkey);
  if (!peer || peer.revoked) {
    return { ok: false, status: 401, reason: 'untrusted peer' };
  }

  const payload = canonicalSigningPayload(method, pathname, query, timestamp);
  const verified = verifyProof(Buffer.from(pubkey, 'hex'), payload, sig);
  if (!verified) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }

  return { ok: true, peer };
}
