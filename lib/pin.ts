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
import { readTempPinId } from './tempPinCookie';
import { getDb } from './db';
import { parseScopes, hasScope } from './tempPin';

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

/**
 * Unified gate (T3 — spec §C):
 *   - If the master PIN cookie is valid, allow through (manager has all scopes).
 *   - Else if a temp-PIN cookie is present, look up the row in temp_pins;
 *     allow only when revoked_at IS NULL, expires_at is in the future, and
 *     scopes_json includes `scope`.
 *
 * Per spec invariant 5: the cookie alone NEVER bypasses the DB check —
 * we hit temp_pins on every gated request so revocation/expiry takes
 * effect immediately.
 *
 * Existing routes that need *master-only* authority (e.g. issuing temp PINs)
 * keep using `hasPinCookie(req)` directly — this function deliberately
 * widens the gate.
 */
export async function hasPinOrTempPin(req: Request, scope: string): Promise<boolean> {
  if (await hasPinCookie(req)) return true;

  const id = await readTempPinId(req);
  if (id === null) return false;

  const row = getDb()
    .prepare(
      // datetime() normalizes ISO 'T'/'Z' form vs SQLite 'YYYY-MM-DD HH:MM:SS'.
      `SELECT scopes_json
         FROM temp_pins
        WHERE id = ?
          AND revoked_at IS NULL
          AND datetime(expires_at) > datetime('now')`,
    )
    .get(id) as { scopes_json: string } | undefined;

  if (!row) return false;
  return hasScope(parseScopes(row.scopes_json), scope);
}
