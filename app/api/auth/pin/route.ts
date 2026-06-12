/** GET — whether PIN gate is configured (does not reveal the PIN). POST { pin } sets cookie. DELETE clears. */

import crypto from 'node:crypto';
import { signPinCookieValue } from '../../../../lib/pinCookie';
import { activeManagerPinUserCount, findActiveManagerByPin } from '../../../../lib/managerPins.ts';
import { locationIdFromEnv } from '../../../../lib/location';

/**
 * Constant-time PIN compare. The 5/60s in-memory rate limiter mitigates
 * brute-force, but a JS string `!==` short-circuits at the first
 * mismatching byte — measurable on a low-jitter LAN. Use
 * `crypto.timingSafeEqual` over Buffers padded to equal length so the
 * compare time is independent of where the PINs diverge.
 *
 * Pads both sides to the longer of the two so timingSafeEqual doesn't
 * throw on length mismatch (which would itself leak the expected
 * length); a length difference is then detected as a non-equal compare
 * after the constant-time pass.
 */
function pinsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  const len = Math.max(a.length, b.length);
  const aPad = Buffer.concat([a, Buffer.alloc(len - a.length)], len);
  const bPad = Buffer.concat([b, Buffer.alloc(len - b.length)], len);
  // Constant-time over the padded buffers; final `&` masks the
  // length-equal check so a length difference still fails.
  const equal = crypto.timingSafeEqual(aPad, bPad);
  return equal && a.length === b.length;
}

/* ------------------------------------------------------------------ */
/* In-memory rate limiter — 5 failed attempts per IP per 60 seconds.  */
/* Resets on process restart (acceptable for LAN-only deployment).    */
/* ------------------------------------------------------------------ */
const attempts = new Map<string, number[]>(); // ip → [timestamp, …]
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let list = attempts.get(ip) || [];
  list = list.filter(ts => now - ts < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

// Only honor x-forwarded-for / x-real-ip when LARIAT_TRUST_PROXY is set. Otherwise
// use the socket-level hint so a client can't spoof an IP to rotate past the limiter.
const TRUST_PROXY = process.env.LARIAT_TRUST_PROXY === '1';

function getIp(req: Request): string {
  if (TRUST_PROXY) {
    const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
    const xreal = req.headers.get('x-real-ip');
    if (xreal) return xreal;
  }
  // Next.js runtime exposes the remote address on the request in most adapters
  // (not in the standard Request type); fall back to a constant bucket
  // (LAN deployment) when unavailable.
  return (req as Request & { ip?: string }).ip || '127.0.0.1';
}

/* ------------------------------------------------------------------ */
/* Cookie helper                                                       */
/* ------------------------------------------------------------------ */
function cookieHeader(name: string, value: string, maxAgeSec?: number): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
export async function GET() {
  const location = locationIdFromEnv();
  let managerCount = 0;
  try {
    managerCount = activeManagerPinUserCount(location);
  } catch {
    managerCount = 0;
  }
  const hasOverride = !!process.env.LARIAT_PIN;
  return Response.json({
    pin_enabled: hasOverride || managerCount > 0,
    pin_override: hasOverride,
    manager_pin_users: managerCount,
    // Exposed so the RoleProvider / ops tooling can tell when the
    // deploy is running in the legacy (unsigned-cookie) fallback.
    pin_signed: !!process.env.LARIAT_PIN_SECRET,
  });
}

export async function POST(req: Request) {
  const expected = process.env.LARIAT_PIN;
  const location = locationIdFromEnv();
  let managerCount = 0;
  try {
    managerCount = activeManagerPinUserCount(location);
  } catch {
    managerCount = 0;
  }
  if (!expected && managerCount === 0) {
    return Response.json({ error: 'PIN setup required' }, { status: 503 });
  }

  const ip = getIp(req);

  if (isRateLimited(ip)) {
    return Response.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 }
    );
  }

  let body: { pin?: unknown } = {};
  try {
    body = (await req.json()) as { pin?: unknown };
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const pin = body.pin != null ? String(body.pin) : '';
  const overrideMatch = expected ? pinsMatch(pin, expected) : false;
  const managerUser = overrideMatch ? null : findActiveManagerByPin(pin, location);
  if (!overrideMatch && !managerUser) {
    recordFailedAttempt(ip);
    return Response.json({ error: 'invalid pin' }, { status: 401 });
  }

  clearAttempts(ip);
  // Session cookie: 8-hour expiry (covers a double shift). The value is
  // HMAC-signed with LARIAT_PIN_SECRET (A2 hardening); see lib/pinCookie.
  const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
  const res = Response.json(
    managerUser
      ? { ok: true, source: 'manager_user', user: { id: managerUser.id, name: managerUser.name, role: managerUser.role } }
      : { ok: true, source: 'override' },
  );
  res.headers.append('Set-Cookie', cookieHeader('lariat_pin_ok', signed, 60 * 60 * 8));
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader('lariat_pin_ok', '', 0));
  return res;
}
