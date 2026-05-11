// Client-facing BEO sharing — pure rule module.
//
// The share token is the only thing standing between an unauthenticated
// guest and an event's price + guest_count + notes. We deliberately keep
// the validation surface tiny: a single shape check (lowercase hex, 32
// chars) so that route handlers can fail fast on garbage input before
// touching the DB.
//
// Industry pattern: 128-bit random URL tokens (matching Tripleseat,
// Planning Pod, Event Temple). 16 bytes from a CSPRNG ≈ 10^38 keyspace,
// brute-force infeasible. We're not encrypting; the assumption is that
// "anyone with this URL may view + sign this BEO" matches what the
// operator means when they hit Share.

import { randomBytes } from 'node:crypto';

export const SHARE_TOKEN_BYTES = 16;
export const SHARE_TOKEN_LENGTH = SHARE_TOKEN_BYTES * 2; // hex chars

const SHARE_TOKEN_RE = /^[0-9a-f]+$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('hex');
}

export function isValidShareTokenShape(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  if (token.length !== SHARE_TOKEN_LENGTH) return false;
  return SHARE_TOKEN_RE.test(token);
}

export const MAX_SIGNED_NAME_LENGTH = 200;
export const MAX_USER_AGENT_LENGTH = 500;

/**
 * Trim + length-cap a free-form signed_name. Returns null if the input
 * is empty after trim — callers MUST treat null as "reject the request"
 * rather than persisting a placeholder. A bare 1-character signature is
 * accepted; lower bounds belong in product copy, not at the DB edge.
 */
export function sanitizeSignedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, MAX_SIGNED_NAME_LENGTH);
}

/**
 * Trim + length-cap the user-agent header. Logs only — we cap it so a
 * pathologically long header can't fill the DB. Returns null on empty.
 */
export function clipUserAgent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * Extract the caller's IP from a Next.js Request. We prefer the
 * left-most X-Forwarded-For entry (the original client behind a proxy),
 * falling back to X-Real-IP. Both are caller-asserted — they are NOT a
 * security boundary; they are an audit signal. Returns null when no
 * header is present.
 */
export function extractClientIp(req: { headers: Headers }): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim().slice(0, 64) || null;
  return null;
}

/**
 * Build the absolute share URL for an event token. Honors `LARIAT_BASE_URL`
 * env override (used in production for the LAN-friendly host), falling
 * back to a relative path so the operator can prepend whatever host they
 * actually serve from.
 */
export function buildShareUrl(token: string): string {
  const base = (process.env.LARIAT_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/beo/share/${token}` : `/beo/share/${token}`;
}
