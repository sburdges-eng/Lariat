/** GET — whether PIN gate is configured (does not reveal the PIN). POST { pin } sets cookie. DELETE clears. */

import { signPinCookieValue } from '../../../../lib/pinCookie';

/* ------------------------------------------------------------------ */
/* In-memory rate limiter — 5 failed attempts per IP per 60 seconds.  */
/* Resets on process restart (acceptable for LAN-only deployment).    */
/* ------------------------------------------------------------------ */
const attempts = new Map();          // ip → [timestamp, …]
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

function isRateLimited(ip) {
  const now = Date.now();
  let list = attempts.get(ip) || [];
  list = list.filter(ts => now - ts < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
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

/* ------------------------------------------------------------------ */
/* Cookie helper                                                       */
/* ------------------------------------------------------------------ */
function cookieHeader(name, value, maxAgeSec) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
export async function GET() {
  return Response.json({
    pin_enabled: !!process.env.LARIAT_PIN,
    // Exposed so the RoleProvider / ops tooling can tell when the
    // deploy is running in the legacy (unsigned-cookie) fallback.
    pin_signed: !!process.env.LARIAT_PIN_SECRET,
  });
}

export async function POST(req) {
  const expected = process.env.LARIAT_PIN;
  if (!expected) {
    return Response.json({ ok: true, pin_disabled: true });
  }

  const ip = getIp(req);

  if (isRateLimited(ip)) {
    return Response.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 }
    );
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const pin = body.pin != null ? String(body.pin) : '';
  if (pin !== expected) {
    recordFailedAttempt(ip);
    return Response.json({ error: 'invalid pin' }, { status: 401 });
  }

  clearAttempts(ip);
  // Session cookie: 8-hour expiry (covers a double shift). The value is
  // HMAC-signed with LARIAT_PIN_SECRET (A2 hardening); see lib/pinCookie.
  const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader('lariat_pin_ok', signed, 60 * 60 * 8));
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader('lariat_pin_ok', '', 0));
  return res;
}
