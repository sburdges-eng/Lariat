// Salted PBKDF2-HMAC-SHA256 PIN hashing. Replaces the unsalted single-pass
// SHA-256 that stored manager/owner, temp, and cook PINs (audit 2026-07-10
// P0-3): a 4–6 digit keyspace under a fast unsalted hash falls to a portable
// rainbow table the instant a DB copy leaves the box. Per-user salt + a slow
// KDF forces a fresh, non-portable crack per row and hides PIN reuse.
//
// PBKDF2 (not scrypt/argon2) is deliberate: it is the one slow KDF available
// natively on BOTH runtimes that share this SQLite file — Node's crypto here
// and Apple's CommonCrypto in LariatNative — so both apps can verify each
// other's hashes with no third-party crypto dependency. The stored string
// `p1$iterations$saltB64$keyB64` is the cross-platform contract; LariatModel's
// PinHash mirrors it byte-for-byte.
//
// Pure module, no I/O. `verifyPin` also accepts the legacy 64-hex SHA-256 so
// existing rows keep authenticating; call sites rehash-on-login to migrate.

import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const PREFIX = 'p1';
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DIGEST = 'sha256';
// Iteration count for newly-written hashes. Login now scans and runs one KDF
// per active row (salted hashes can't be looked up by equality), so this is a
// balance: high enough to make offline guessing of a 4–6 digit PIN cost real
// time, low enough that a handful-of-rows scan stays a responsive login on the
// deployment hardware. Tunable per deployment — the count is stored per hash.
const ITERATIONS = 200_000;
// Cap for the iteration count read back out of a row, so a tampered/corrupt
// value can't make PBKDF2 spin for minutes (fail closed instead).
const MAX_ITERATIONS = 5_000_000;

const LEGACY_HEX_RE = /^[0-9a-f]{64}$/;

/** True for the legacy unsalted SHA-256 hex format (64 lowercase hex chars). */
export function isLegacyHash(stored: unknown): boolean {
  return typeof stored === 'string' && LEGACY_HEX_RE.test(stored);
}

/** Hash a PIN with a fresh random salt. Returns `p1$iterations$saltB64$keyB64`. */
export function hashPinSecure(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = pbkdf2Sync(pin, salt, ITERATIONS, KEY_BYTES, DIGEST);
  return `${PREFIX}$${ITERATIONS}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time verify. Accepts both the PBKDF2 format and the legacy
 * SHA-256 hex. Never throws: any malformed input or unparseable stored value
 * fails closed (returns false).
 */
export function verifyPin(pin: unknown, stored: unknown): boolean {
  if (typeof pin !== 'string' || typeof stored !== 'string' || stored.length === 0) {
    return false;
  }

  if (isLegacyHash(stored)) {
    const actual = createHash('sha256').update(pin).digest();
    const expected = Buffer.from(stored, 'hex');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    return false;
  }

  const saltB64 = parts[2];
  const keyB64 = parts[3];
  if (saltB64 === undefined || keyB64 === undefined) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = pbkdf2Sync(pin, salt, iterations, expected.length, DIGEST);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
