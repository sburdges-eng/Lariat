// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../lib/idempotency';
import { generateShareToken, buildShareUrl } from '../../../../../lib/beoShare';
import { locationFromRequest } from '../../../../../lib/location';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */
/**
 * The share columns this route reads off beo_events.
 * @typedef {{ id: number, location_id: string, share_token: string | null,
 *             share_expires_at: string | null, share_revoked_at: string | null }} ShareEventRow
 */

// PIN-gated. Generates a share token for the given BEO event if one
// doesn't already exist; otherwise returns the existing token. The token
// itself is the auth boundary on the public read+sign endpoints — anyone
// who has the URL can view and sign. The operator is responsible for who
// they share it with. If a stored token has been revoked or expired, this
// route mints a fresh URL for the PIN-authenticated operator.

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function POST(req, ctx) {
  return withIdempotency(req, () => handler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function handler(req, ctx) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  const params = await ctx?.params;
  const idRaw = params?.id;
  const eventId = Number(idRaw);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return Response.json({ error: 'invalid event id' }, { status: 400 });
  }

  const db = getDb();
  const location = locationFromRequest(req);
  const event = /** @type {ShareEventRow | undefined} */ (db
    .prepare(
      `SELECT id, location_id, share_token, share_expires_at, share_revoked_at
         FROM beo_events
        WHERE id = ? AND location_id = ?`,
    )
    .get(eventId, location));
  if (!event) return Response.json({ error: 'event not found' }, { status: 404 });

  const tokenActive =
    event.share_token &&
    !event.share_revoked_at &&
    isShareExpiryActive(event.share_expires_at);

  if (tokenActive) {
    // tokenActive requires event.share_token to be truthy.
    const activeToken = /** @type {string} */ (event.share_token);
    return Response.json({
      event_id: event.id,
      token: activeToken,
      share_url: buildShareUrl(activeToken),
      created: false,
    });
  }

  const token = generateShareToken();
  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE beo_events
            SET share_token = ?,
                share_expires_at = NULL,
                share_revoked_at = NULL
          WHERE id = ?`,
      ).run(token, eventId);
      postAuditEvent({
        entity: 'beo_event',
        entity_id: eventId,
        action: 'update',
        actor_cook_id: null,
        actor_source: 'pic_ui',
        location_id: event.location_id,
        note: 'share_token generated',
      });
    })();
  } catch (err) {
    console.error('POST /api/beo/[id]/share-token failed:', err);
    return Response.json({ error: 'failed to generate token' }, { status: 500 });
  }

  return Response.json({
    event_id: eventId,
    token,
    share_url: buildShareUrl(token),
    created: true,
  });
}

/** @param {string | null | undefined} expiresAt */
function isShareExpiryActive(expiresAt) {
  if (!expiresAt) return true;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return Math.floor(expiresMs / 1000) > Math.floor(Date.now() / 1000);
}
