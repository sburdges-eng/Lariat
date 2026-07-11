// HMAC-signed PIN cookie.
//
// The `lariat_pin_ok` cookie is the auth ticket for the sensitive
// (KM/manager) pages. Pre-hardening, the cookie was a naked
// `lariat_pin_ok=1` — trivially forgeable by anyone on the LAN with
// a curl one-liner, which defeats the point of the PIN.
//
// This module signs the value with HMAC-SHA256 keyed on
// `LARIAT_PIN_SECRET`. Format (audit P0-1 identity, spec
// docs/superpowers/specs/2026-07-11-lariat-pin-identity-v2.md):
//   `v2.<sub>.<base64url(hmac(secret, "v2." + sub))>`
// where `sub` is the manager_pin_users.id that logged in, or 0 for the
// env LARIAT_PIN override login. The version prefix lives inside the
// signed payload (downgrade block, same as tempPinCookie). The retired
// anonymous `v1.<mac>` format is hard-cut: it no longer verifies, so a
// pre-upgrade browser re-enters the PIN once (8h cookie ceiling anyway).
//
// This module is PURE CRYPTO (Web Crypto API) so it runs in Node routes
// AND the Next.js Edge middleware runtime — the DB-backed is_active
// revocation check on `sub` lives in lib/pin.ts (Node only).
//
// Deployment-safety posture:
// - If `LARIAT_PIN_SECRET` is unset outside production, the app falls
//   back to the legacy unsigned `1` cookie (maps to sub 0) with a
//   one-time deploy warning. In production this fails closed (P0-4).
// - If the secret IS set, only `v2.<sub>.<valid-hmac>` is accepted. A
//   forged `lariat_pin_ok=1` is rejected by middleware.js and the
//   API-level hasPinCookie() check.
//
// Rotating the secret invalidates every outstanding cookie.

export const SIGNED_COOKIE_PREFIX = 'v2.';

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
 * Legacy unsigned cookies are a dev/partial-deploy convenience only. In
 * production (NODE_ENV=production) a missing LARIAT_PIN_SECRET fails
 * closed (audit P0-4): a bare forgeable cookie must never be an auth
 * ticket on a real deployment. The Electron wrapper already fails closed
 * (desktop/settings.ts); this closes the manual `next start` self-host
 * path. Shared by lib/tempPinCookie.ts so both cookies keep one posture.
 */
export function unsignedPinCookieAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

const SECRET_REQUIRED_MSG =
  'LARIAT_PIN_SECRET is required in production — refusing an unsigned PIN ' +
  'cookie. Set it to a random 32-byte value (`openssl rand -hex 32`) and ' +
  'have every browser re-enter the PIN.';

/**
 * Sign the PIN cookie value. Returns a string suitable for
 * `Set-Cookie: lariat_pin_ok=<value>`.
 *
 * `sub` is the identity carried by the session (audit P0-1): the
 * manager_pin_users.id that logged in, or 0 for the env LARIAT_PIN
 * override login. lib/pin.ts re-checks sub > 0 against the DB on every
 * gated request, so disabling a manager revokes their session.
 *
 * If secret is missing we return `"1"` (legacy format, identity lost)
 * and log a one-time warning so a partial deploy doesn't lock the iPad
 * — outside production only; in production this throws instead (see
 * unsignedPinCookieAllowed).
 */
export async function signPinCookieValue(
  secret: string | undefined,
  sub: number = 0,
): Promise<string> {
  if (!Number.isInteger(sub) || sub < 0) {
    throw new Error('PIN cookie sub must be a non-negative integer');
  }
  if (!secret) {
    if (!unsignedPinCookieAllowed()) throw new Error(SECRET_REQUIRED_MSG);
    warnLegacyOnce();
    return COOKIE_PAYLOAD;
  }
  const payload = `${SIGNED_COOKIE_PREFIX}${sub}`;
  const mac = await hmacSign(secret, payload);
  return `${payload}.${b64url(mac)}`;
}

/**
 * Verify a cookie value and extract its subject. Returns the embedded
 * sub (0 = override / legacy) for a valid auth ticket, or null when the
 * value is invalid.
 *
 * If secret is missing (legacy mode, non-production only), accept bare
 * `"1"` as sub 0. A value that *looks* signed but has no secret to
 * verify is rejected — the operator configured some but not all of the
 * signing knobs. The retired `v1.<mac>` format never matches the v2
 * parse and is rejected (hard cut).
 */
export async function pinCookieSubject(
  value: string | undefined | null,
  secret: string | undefined,
): Promise<number | null> {
  if (typeof value !== 'string' || value.length === 0) return null;

  if (value.startsWith(SIGNED_COOKIE_PREFIX)) {
    if (!secret) return null;
    const rest = value.slice(SIGNED_COOKIE_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot === -1) return null;
    const subPart = rest.slice(0, dot);
    const sig = rest.slice(dot + 1);
    if (!/^\d+$/.test(subPart)) return null;
    const sub = Number(subPart);
    if (!Number.isSafeInteger(sub)) return null;

    const expected = await hmacSign(secret, `${SIGNED_COOKIE_PREFIX}${subPart}`);
    let provided: Uint8Array;
    try {
      provided = b64urlDecode(sig);
    } catch {
      return null;
    }
    if (provided.length !== expected.length) return null;
    // Constant-time comparison
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i]! ^ provided[i]!;
    }
    return diff === 0 ? sub : null;
  }

  // Legacy unsigned path: only accept bare "1" (sub 0), only when no
  // secret is configured, and never in production (fail closed — audit
  // P0-4). With a secret set, every request must use the signed path —
  // that's the whole point.
  if (secret) return null;
  if (!unsignedPinCookieAllowed()) return null;
  return value === COOKIE_PAYLOAD ? 0 : null;
}

/**
 * Boolean verify — true iff the value is a valid auth ticket. Kept for
 * middleware.js and any caller that doesn't need the identity.
 */
export async function verifyPinCookieValue(
  value: string | undefined | null,
  secret: string | undefined,
): Promise<boolean> {
  return (await pinCookieSubject(value, secret)) !== null;
}

/**
 * Read the cookie from a fetch-style Request and extract its subject.
 * Returns the sub for a valid ticket, else null. Pure crypto — the
 * DB-backed is_active check on sub belongs to lib/pin.ts.
 */
export async function pinCookieSubjectFromRequest(
  req: Request,
  secret: string | undefined = process.env.LARIAT_PIN_SECRET,
): Promise<number | null> {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== 'lariat_pin_ok') continue;
    const value = part.slice(eq + 1).trim();
    return pinCookieSubject(value, secret);
  }
  return null;
}

/**
 * Read and verify the cookie from a fetch-style Request object. Used
 * by API routes (Edge + Node) that need in-route PIN enforcement.
 */
export async function hasValidPinCookie(
  req: Request,
  secret: string | undefined = process.env.LARIAT_PIN_SECRET,
): Promise<boolean> {
  return (await pinCookieSubjectFromRequest(req, secret)) !== null;
}
