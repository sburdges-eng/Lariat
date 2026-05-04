// GET /api/auth/temp-pin/list — list active temp PINs (manager only).
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// Returns metadata (id, label, scopes, issued_at, expires_at).
// NEVER returns pin_hash or the raw PIN — those are unrecoverable
// after issuance by design (spec invariant 4).

import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { hasPinCookie, pinRequiredForPic } from '../../../../../lib/pin';
import { locationFromRequest } from '../../../../../lib/location';
import { parseScopes } from '../../../../../lib/tempPin';

export const dynamic = 'force-dynamic';

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const location = locationFromRequest(req);
    const db = getDb();
    const rows = db
      .prepare(
        // datetime() on both sides normalizes the ISO 'T'/'Z' form to SQLite's
        // canonical 'YYYY-MM-DD HH:MM:SS', so string > comparison is correct.
        `SELECT id, label, scopes_json, issued_at, expires_at
           FROM temp_pins
          WHERE location_id = ?
            AND revoked_at IS NULL
            AND datetime(expires_at) > datetime('now')
          ORDER BY issued_at DESC`,
      )
      .all(location);

    const pins = rows.map((r) => ({
      id: r.id,
      label: r.label,
      scopes: parseScopes(r.scopes_json),
      issued_at: r.issued_at,
      expires_at: r.expires_at,
    }));

    return json({ pins }, { status: 200 });
  } catch (err) {
    console.error('GET /api/auth/temp-pin/list failed:', err);
    return json({ error: 'could not load pins' }, { status: 500 });
  }
}
