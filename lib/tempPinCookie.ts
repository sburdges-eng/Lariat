// HMAC-signed temp-PIN cookie.
//
// Mirrors lib/pinCookie.ts but encodes the temp_pins.id so the gate
// can look up the row on every check (per spec invariant: cached cookie
// must NOT bypass DB revocation/expiry/scope checks).
//
// Format: `v1.<id>.<base64url(hmac(secret, "v1." + id))>`
// - Including the version prefix in the signed payload blocks
//   downgrade attacks if a v2 format is ever added.
// - The id is plaintext so the gate can read it without verifying first;
//   the HMAC just prevents an attacker from forging a fresh id pointing
//   at someone else's row.
//
// Deployment-safety posture matches lib/pinCookie.ts: if LARIAT_PIN_SECRET
// is unset we degrade to an unsigned `id` cookie with a one-time warning
// — the iPad keeps working, but operator is told to set the secret.
// In production the degrade is disabled entirely: sign throws and verify
// rejects (fail closed — audit P0-4, via unsignedPinCookieAllowed).

import { unsignedPinCookieAllowed } from './pinCookie.ts';

export const SIGNED_TEMP_PIN_PREFIX = 'v1.';
export const TEMP_PIN_COOKIE_NAME = 'lariat_temp_pin_ok';

let warnedLegacy = false;
function warnLegacyOnce() {
  if (warnedLegacy) return;
  warnedLegacy = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[lariat] LARIAT_PIN_SECRET not set; temp-PIN cookies will be unsigned. ' +
      'Set the secret to a random 32-byte value before issuing temp PINs in production.',
  );
}

function b64url(buf: Uint8Array): string {
  let b = '';
  for (const byte of buf) b += String.fromCharCode(byte);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

const encoder = new TextEncoder();

async function hmacSign(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return new Uint8Array(sig);
}

/** Sign a temp_pins.id into the cookie value. */
export async function signTempPinCookieValue(
  id: number,
  secret: string | undefined,
): Promise<string> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('temp pin id must be a positive integer');
  }
  if (!secret) {
    if (!unsignedPinCookieAllowed()) {
      throw new Error(
        'LARIAT_PIN_SECRET is required in production — refusing an unsigned ' +
          'temp-PIN cookie. Set it to a random 32-byte value (`openssl rand -hex 32`).',
      );
    }
    warnLegacyOnce();
    return String(id);
  }
  const payload = `${SIGNED_TEMP_PIN_PREFIX}${id}`;
  const mac = await hmacSign(secret, payload);
  return `${payload}.${b64url(mac)}`;
}

/** Verify and extract the id from a temp-PIN cookie. Returns null if invalid. */
export async function verifyTempPinCookieValue(
  value: string | undefined | null,
  secret: string | undefined,
): Promise<number | null> {
  if (typeof value !== 'string' || value.length === 0) return null;

  if (value.startsWith(SIGNED_TEMP_PIN_PREFIX)) {
    if (!secret) return null;
    const rest = value.slice(SIGNED_TEMP_PIN_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot === -1) return null;
    const idPart = rest.slice(0, dot);
    const sig = rest.slice(dot + 1);
    const id = Number(idPart);
    if (!Number.isInteger(id) || id <= 0) return null;

    const payload = `${SIGNED_TEMP_PIN_PREFIX}${idPart}`;
    const expected = await hmacSign(secret, payload);
    let provided: Uint8Array;
    try {
      provided = b64urlDecode(sig);
    } catch {
      return null;
    }
    if (provided.length !== expected.length) return null;
    // Constant-time compare
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i]! ^ provided[i]!;
    }
    return diff === 0 ? id : null;
  }

  // Legacy unsigned path: only when no secret is configured, and never
  // in production (fail closed — audit P0-4).
  if (secret) return null;
  if (!unsignedPinCookieAllowed()) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Read + verify the temp-PIN cookie from a fetch-style Request. Returns id or null. */
export async function readTempPinId(
  req: Request,
  secret: string | undefined = process.env.LARIAT_PIN_SECRET,
): Promise<number | null> {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== TEMP_PIN_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return verifyTempPinCookieValue(value, secret);
  }
  return null;
}
