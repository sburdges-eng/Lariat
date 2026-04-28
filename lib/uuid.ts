/**
 * UUID v7 generator (RFC 9562 §5.7).
 *
 * Layout (128 bits, big-endian):
 *   48 bits  unix_ts_ms     — millisecond timestamp
 *    4 bits  version (0x7)
 *   12 bits  rand_a         — random
 *    2 bits  variant (0b10)
 *   62 bits  rand_b         — random
 *
 * Why v7 over v4:
 *   - Time-ordered: lexicographic sort ≈ insertion order, so SQLite indexes
 *     on UUID PKs stay tight (page locality on a B-tree). v4 is fully
 *     random and shreds the index.
 *   - Same uniqueness guarantees; same hyphenated 36-char string format.
 *
 * Why we don't use crypto.randomUUID():
 *   - Node's randomUUID() is v4. There's no built-in v7 in Node 20/22 yet.
 *
 * Format: 'xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx' where y ∈ {8,9,a,b}.
 */

import { randomBytes } from 'node:crypto';

const HEX = '0123456789abcdef';

function bytesToHex(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] as number;
    out += (HEX[(b >>> 4) & 0xf] as string) + (HEX[b & 0xf] as string);
  }
  return out;
}

/**
 * Generate a UUID v7 string. Pass `nowMs` to make output deterministic in
 * tests; in prod let it default to `Date.now()`.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  if (!Number.isInteger(nowMs) || nowMs < 0) {
    throw new RangeError(`uuidv7: nowMs must be a non-negative integer, got ${nowMs}`);
  }

  // 6 bytes of timestamp + 10 bytes of random scratch space.
  const buf = Buffer.alloc(16);

  // 48-bit big-endian ms timestamp into bytes 0..5.
  // Number.MAX_SAFE_INTEGER is 2^53-1, so a 48-bit value fits cleanly.
  buf[0] = (nowMs / 0x10000000000) & 0xff; // top 8 bits of 48
  buf[1] = (nowMs / 0x100000000) & 0xff;
  buf[2] = (nowMs >>> 24) & 0xff;
  buf[3] = (nowMs >>> 16) & 0xff;
  buf[4] = (nowMs >>> 8) & 0xff;
  buf[5] = nowMs & 0xff;

  // Random tail.
  const rand = randomBytes(10);
  rand.copy(buf, 6);

  // Set version (0x7) in the high nibble of byte 6.
  buf[6] = ((buf[6] as number) & 0x0f) | 0x70;
  // Set variant (10xx) in the high bits of byte 8.
  buf[8] = ((buf[8] as number) & 0x3f) | 0x80;

  const hex = bytesToHex(buf);
  return (
    hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20, 32)
  );
}

/** True iff `s` matches the canonical UUID v7 string shape. */
export function isUuidV7(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== 36) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Extract the embedded ms timestamp from a UUID v7 string. Returns null if
 * `s` isn't a v7. Useful for "when was this entity first registered" debug
 * paths without an extra column.
 */
export function uuidv7Timestamp(s: string): number | null {
  if (!isUuidV7(s)) return null;
  const hex = s.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
