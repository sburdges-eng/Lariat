// @ts-check
// POST /api/auth/temp-pin/revoke — revoke a temp PIN (manager only).
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// Sets revoked_at = now. The login route's WHERE clause filters
// revoked_at IS NULL, so subsequent logins immediately fail; gated
// surfaces re-check on every request, so any in-flight cookie also
// stops working as soon as the row is updated.

import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../lib/idempotency';
import { locationFromBody } from '../../../../../lib/location';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => revokeHandler(req));
}

/** @param {Request} req */
async function revokeHandler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'id required (positive integer)' }, { status: 422 });
  }

  const location = locationFromBody(body);
  const db = getDb();

  /** @type {string | null} */
  let revokedAt = null;
  try {
    db.transaction(() => {
      const existing = /** @type {{ id: number; revoked_at: string | null } | undefined} */ (db
        .prepare(`SELECT id, revoked_at FROM temp_pins WHERE id = ? AND location_id = ?`)
        .get(id, location));
      if (!existing) {
        const err = /** @type {Error & { code?: string }} */ (new Error('not_found'));
        err.code = 'NOT_FOUND';
        throw err;
      }
      // Idempotent: if already revoked, return the same revoked_at without
      // a second audit row.
      if (existing.revoked_at) {
        revokedAt = existing.revoked_at;
        return;
      }

      db.prepare(`UPDATE temp_pins SET revoked_at = datetime('now') WHERE id = ?`).run(id);
      const r = /** @type {{ revoked_at: string | null }} */ (db.prepare(`SELECT revoked_at FROM temp_pins WHERE id = ?`).get(id));
      revokedAt = r.revoked_at;

      postAuditEvent({
        entity: 'temp_pin',
        entity_id: id,
        action: 'update',
        actor_cook_id: null,
        actor_source: 'manager_ui',
        location_id: location,
        payload: { revoked: true, revoked_at: revokedAt },
      });
    })();
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === 'NOT_FOUND') {
      return json({ error: 'temp pin not found' }, { status: 404 });
    }
    console.error('revoke temp pin failed:', err);
    return json({ error: 'could not revoke pin' }, { status: 500 });
  }

  return json({ id, revoked_at: revokedAt }, { status: 200 });
}
