// POST /api/auth/temp-pin/login — exchange a temp PIN for a cookie.
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
//
// PUBLIC route — the PIN itself is the authenticator. On success, sets
// the lariat_temp_pin_ok cookie (HMAC-signed by lib/tempPinCookie). The
// gated routes (lib/pin.ts::hasPinOrTempPin) re-validate the cookie's
// id against temp_pins on every request, so revocation/expiry takes
// effect immediately without waiting for cookie expiry.
//
// Returns 401 on any failure (unknown PIN, expired, revoked) without
// distinguishing — info leak avoidance. 422 only for malformed input
// (wrong length / non-digits) where there's no PII to leak.
//
// Rate limited 5/60s per IP — same shape as /api/auth/pin (in-memory
// Map, sliding window). PIN space is 10^4; without throttling a LAN
// attacker enumerates the entire space in seconds. Failed attempts on
// every path (JSON-fail, format-fail, unknown-PIN) consume a slot;
// successful login clears the IP's bucket. Per the route's existing
// header note: failed attempts are deliberately NOT audited — same
// noise rationale as before, the rate limiter handles brute-force.

import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { hashPin, validatePinFormat, parseScopes } from '../../../../../lib/tempPin';
import { signTempPinCookieValue, TEMP_PIN_COOKIE_NAME } from '../../../../../lib/tempPinCookie';

export const dynamic = 'force-dynamic';

const COOKIE_TTL_HOURS = 12; // Cookie's natural lifespan; row's expires_at is the real cap

/* ------------------------------------------------------------------ */
/* In-memory rate limiter — 5 failed attempts per IP per 60 seconds.  */
/* Resets on process restart (acceptable for LAN-only deployment).    */
/* Mirrors the limiter shape in app/api/auth/pin/route.js verbatim.   */
/* ------------------------------------------------------------------ */
const attempts = new Map();          // ip → [timestamp, …]
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

// Indirection so tests can advance the clock without monkeypatching
// global Date. Production code path is `Date.now()` exactly as in the
// master-PIN route.
let nowFn = () => Date.now();

function isRateLimited(ip) {
  const now = nowFn();
  let list = attempts.get(ip) || [];
  list = list.filter(ts => now - ts < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(nowFn());
  attempts.set(ip, list);
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

// Only honor x-forwarded-for / x-real-ip when LARIAT_TRUST_PROXY is set. Otherwise
// use the socket-level hint so a client can't spoof an IP to rotate past the limiter.
const TRUST_PROXY = process.env.LARIAT_TRUST_PROXY === '1';

function getIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
    const xreal = req.headers.get('x-real-ip');
    if (xreal) return xreal;
  }
  // Next.js runtime exposes the remote address on the request in most adapters;
  // fall back to a constant bucket (LAN deployment) when unavailable.
  return req.ip || '127.0.0.1';
}

// Test-only hooks. Must NEVER be called in production code paths.
export function _resetAttemptsForTest() {
  attempts.clear();
}
export function _setNowForTest(fn) {
  nowFn = typeof fn === 'function' ? fn : () => Date.now();
}

export async function POST(req) {
  const ip = getIp(req);

  if (isRateLimited(ip)) {
    return json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    recordFailedAttempt(ip);
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  const fmt = validatePinFormat(body?.pin);
  if (!fmt.ok) {
    recordFailedAttempt(ip);
    return json({ error: fmt.error }, { status: 422 });
  }

  const pinHash = hashPin(body.pin);
  const db = getDb();

  // SELECT ... AND revoked_at IS NULL AND expires_at > now is the
  // single source of truth for "active". UNIQUE on pin_hash means at
  // most one row matches.
  const row = db
    .prepare(
      // datetime() wraps both sides — see /list/route.js for why string
      // compare across formats was wrong.
      `SELECT id, location_id, scopes_json, expires_at
         FROM temp_pins
        WHERE pin_hash = ?
          AND revoked_at IS NULL
          AND datetime(expires_at) > datetime('now')`,
    )
    .get(pinHash);

  if (!row) {
    recordFailedAttempt(ip);
    return json({ error: 'pin not recognized' }, { status: 401 });
  }

  // Audit the successful exchange. Failed attempts deliberately are not
  // audited — they're noise on misclick, and the PIN itself isn't in the
  // payload so an audit row would just say "someone tried a wrong PIN".
  // Revisit if brute-force becomes a real threat (would add rate-limit too).
  try {
    db.transaction(() => {
      postAuditEvent({
        entity: 'temp_pin',
        entity_id: row.id,
        action: 'view',
        actor_cook_id: null,
        actor_source: 'kds_login',
        location_id: row.location_id,
        payload: { event: 'login' },
      });
    })();
  } catch (err) {
    console.error('temp pin login audit failed:', err);
    // Don't fail the login on audit failure — but we should know.
  }

  let cookieValue;
  try {
    cookieValue = await signTempPinCookieValue(row.id, process.env.LARIAT_PIN_SECRET);
  } catch (err) {
    console.error('sign temp pin cookie failed:', err);
    return json({ error: 'could not issue session' }, { status: 500 });
  }

  // Successful login → drop the IP's failed-attempt window. Mirrors the
  // master-PIN route's clearAttempts(ip) on the 200 path.
  clearAttempts(ip);

  const setCookie = [
    `${TEMP_PIN_COOKIE_NAME}=${cookieValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_TTL_HOURS * 60 * 60}`,
  ].join('; ');

  return new Response(
    JSON.stringify({
      id: row.id,
      scopes: parseScopes(row.scopes_json),
      expires_at: row.expires_at,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': setCookie,
      },
    },
  );
}
