// Shared PIN-cookie helpers for API routes.
//
// The `lariat_pin_ok` cookie is issued by POST /api/auth/pin after the
// manager enters LARIAT_PIN at /login-pin. Middleware.js protects the
// "sensitive" pages (analytics, costing, etc) by redirecting browsers
// without the cookie. API routes that need PIC-level authority (sick
// worker reports, back-dated temp logs, wage actions) perform the same
// check in-route so a curl/replay can't bypass the UI.
//
// The cookie value is HMAC-signed (lib/pinCookie) so `lariat_pin_ok=1`
// forged by hand is rejected. Legacy unsigned cookies are accepted
// only when LARIAT_PIN_SECRET is unset (deployment-safe fallback).

import { hasValidPinCookie } from './pinCookie';

/** True when the PIC has entered the PIN in this browser session. */
export async function hasPinCookie(req: Request): Promise<boolean> {
  return hasValidPinCookie(req);
}

/** True if the PIN gate is configured at all (env var set). */
export function pinConfigured(): boolean {
  return !!process.env.LARIAT_PIN;
}

/**
 * Default gate for PIC-authority actions: if the PIN is configured,
 * require the cookie. If no PIN configured (LAN-trust single-site
 * deployment), allow through. Matches temp-log back-date logic.
 */
export function pinRequiredForPic(): boolean {
  return pinConfigured();
}
