// HMAC-signed PIN cookie.
//
// The `lariat_pin_ok` cookie is the auth ticket for the sensitive
// (KM/manager) pages. Pre-hardening, the cookie was a naked
// `lariat_pin_ok=1` — trivially forgeable by anyone on the LAN with
// a curl one-liner, which defeats the point of the PIN.
//
// This module signs the value with HMAC-SHA256 keyed on
// `LARIAT_PIN_SECRET`. Format: `v1.<base64url(hmac(secret, "1"))>`.
//
// Uses the Web Crypto API so this works in both Node.js server
// routes AND the Next.js Edge middleware runtime.
//
// Deployment-safety posture:
// - If `LARIAT_PIN_SECRET` is unset, the app falls back to the legacy
//   unsigned `1` cookie with a one-time deploy warning. Cooks on the
//   iPad keep their session; the ops runbook is "set the secret, then
//   DELETE /api/auth/pin on every browser to rotate".
// - If the secret IS set, only `v1.<valid-hmac>` is accepted. A
//   forged `lariat_pin_ok=1` is rejected by middleware.js and the
//   API-level hasPinCookie() check.
//
// Rotating the secret invalidates every outstanding cookie.

export const SIGNED_COOKIE_PREFIX = 'v1.';

/** The body of the signed cookie before the HMAC tail. Kept short + stable. */
const COOKIE_PAYLOAD = '1';

let warnedLegacy = false;
function warnLegacyOnce() {
  if (warnedLegacy) return;
  warnedLegacy = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[lariat] LARIAT_PIN is set but LARIAT_PIN_SECRET is not. Falling back to ' +
      'an unsigned PIN cookie. This is insecure; set LARIAT_PIN_SECRET to a ' +
      'random 32-byte value (e.g. `openssl rand -hex 32`) and have every ' +
      'browser re-enter the PIN to rotate.',
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

/**
 * Sign the PIN cookie value. Returns a string suitable for
 * `Set-Cookie: lariat_pin_ok=<value>`.
 *
 * If secret is missing we return `"1"` (legacy format) and log a
 * one-time warning so a partial deploy doesn't lock the iPad.
 */
export async function signPinCookieValue(secret: string | undefined): Promise<string> {
  if (!secret) {
    warnLegacyOnce();
    return COOKIE_PAYLOAD;
  }
  const mac = await hmacSign(secret, COOKIE_PAYLOAD);
  return `${SIGNED_COOKIE_PREFIX}${b64url(mac)}`;
}

/**
 * Verify a cookie value. Returns true iff it's a valid auth ticket
 * against the given secret.
 *
 * If secret is missing (legacy mode), accept bare `"1"` only. A
 * value that *looks* signed (`v1.…`) but has no secret to verify is
 * rejected — the operator configured some but not all of the signing
 * knobs.
 */
export async function verifyPinCookieValue(
  value: string | undefined | null,
  secret: string | undefined,
): Promise<boolean> {
  if (typeof value !== 'string' || value.length === 0) return false;

  if (value.startsWith(SIGNED_COOKIE_PREFIX)) {
    if (!secret) return false;
    const tail = value.slice(SIGNED_COOKIE_PREFIX.length);
    const expected = await hmacSign(secret, COOKIE_PAYLOAD);
    let provided: Uint8Array;
    try {
      provided = b64urlDecode(tail);
    } catch {
      return false;
    }
    if (provided.length !== expected.length) return false;
    // Constant-time comparison
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i]! ^ provided[i]!;
    }
    return diff === 0;
  }

  // Legacy unsigned path: only accept bare "1", and only when no
  // secret is configured. With a secret set, every request must use
  // the signed path — that's the whole point.
  if (secret) return false;
  return value === COOKIE_PAYLOAD;
}

/**
 * Read and verify the cookie from a fetch-style Request object. Used
 * by API routes (Edge + Node) that need in-route PIN enforcement.
 */
export async function hasValidPinCookie(
  req: Request,
  secret: string | undefined = process.env.LARIAT_PIN_SECRET,
): Promise<boolean> {
  const raw = req.headers.get('cookie');
  if (!raw) return false;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== 'lariat_pin_ok') continue;
    const value = part.slice(eq + 1).trim();
    return verifyPinCookieValue(value, secret);
  }
  return false;
}
