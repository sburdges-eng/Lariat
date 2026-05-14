// lib/localIdentity.ts
//
// This Lariat instance's stable identity for cross-host sync.
// Mirrors the `(host, started_at)` convention from
// lib/hubFailover.ts::peerKey, but captured locally rather than read
// off a discovered mDNS record.
//
//   host        = os.hostname()
//   started_at  = ISO 8601 timestamp captured at module load
//
// Both values stay fixed for the lifetime of the process. A reboot
// yields a fresh `started_at` — peers correctly see this as a new
// instance, not the prior one, and re-replay from scratch into their
// local replay_checkpoints row.
//
// The same shape feeds:
//   - appendOp call sites (sourceHost + sourceStartedAt on every op)
//   - the scheduler's request peer_id (caller sends as `peer_id` so
//     remotes scope replay_checkpoints by us)
//   - logs / observability — the values are non-sensitive
//
// Also exports newOpId(): UUIDv7-shaped (monotonic ms timestamp +
// random suffix). RFC 9562 strict v7 would format-validate; for the
// sync feed's idempotency-on-UNIQUE-INDEX use case we only need
// global uniqueness + roughly-monotonic ordering within a single
// boot. The crypto.randomUUID() v4 in node:crypto is sufficient by
// itself; the v7-shape is a debugging aid (timestamp readable as the
// first 12 hex chars).

import { hostname } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

const HOST = hostname();
const STARTED_AT = new Date().toISOString();

export function getLocalHost(): string {
  return HOST;
}

export function getStartedAt(): string {
  return STARTED_AT;
}

/**
 * Generate a UUIDv7-shaped id: 48-bit ms-since-epoch big-endian
 * timestamp in the first 6 bytes, version nibble = 7, variant bits =
 * 10, 74 bits of random. Suitable as the sync_feed.op_id idempotency
 * key.
 *
 * Falls back to randomUUID() (v4) if crypto.randomBytes is somehow
 * unavailable — v4 is also unique enough for our scale (~birthday
 * bound at 2^61 ops).
 */
export function newOpId(): string {
  try {
    const ts = Date.now();
    const buf = randomBytes(16);
    // Bytes 0..5: ms timestamp, big-endian.
    buf[0] = (ts / 2 ** 40) & 0xff;
    buf[1] = (ts / 2 ** 32) & 0xff;
    buf[2] = (ts >>> 24) & 0xff;
    buf[3] = (ts >>> 16) & 0xff;
    buf[4] = (ts >>> 8) & 0xff;
    buf[5] = ts & 0xff;
    // Byte 6 high nibble = version 7.
    buf[6] = (buf[6]! & 0x0f) | 0x70;
    // Byte 8 high two bits = variant 10.
    buf[8] = (buf[8]! & 0x3f) | 0x80;
    const hex = buf.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch {
    return randomUUID();
  }
}

/**
 * Bundle of the three fields every appendOp call needs. Convenience
 * for route handlers — `appendOp({...localIdentityFields(), tableName,
 * opKind, ...})` keeps the call site short.
 */
export function localIdentityFields(): {
  sourceHost: string;
  sourceStartedAt: string;
  opId: string;
  createdAt: string;
} {
  return {
    sourceHost: HOST,
    sourceStartedAt: STARTED_AT,
    opId: newOpId(),
    createdAt: new Date().toISOString(),
  };
}
