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

import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { hashPin, validatePinFormat, parseScopes } from '../../../../../lib/tempPin';
import { signTempPinCookieValue, TEMP_PIN_COOKIE_NAME } from '../../../../../lib/tempPinCookie';

export const dynamic = 'force-dynamic';

const COOKIE_TTL_HOURS = 12; // Cookie's natural lifespan; row's expires_at is the real cap

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  const fmt = validatePinFormat(body?.pin);
  if (!fmt.ok) {
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
