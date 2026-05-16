// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../lib/idempotency';
import { generateShareToken, buildShareUrl } from '../../../../../lib/beoShare';

export const dynamic = 'force-dynamic';

// PIN-gated. Generates a share token for the given BEO event if one
// doesn't already exist; otherwise returns the existing token. The token
// itself is the auth boundary on the public read+sign endpoints — anyone
// who has the URL can view and sign. The operator is responsible for who
// they share it with. Rotation is out of scope here: drop the column via
// the DB if the token is leaked.

export async function POST(req, ctx) {
  return withIdempotency(req, () => handler(req, ctx));
}

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
  const event = db
    .prepare('SELECT id, location_id, share_token FROM beo_events WHERE id = ?')
    .get(eventId);
  if (!event) return Response.json({ error: 'event not found' }, { status: 404 });

  if (event.share_token) {
    return Response.json({
      event_id: event.id,
      token: event.share_token,
      share_url: buildShareUrl(event.share_token),
      created: false,
    });
  }

  const token = generateShareToken();
  try {
    db.transaction(() => {
      db.prepare('UPDATE beo_events SET share_token = ? WHERE id = ?').run(token, eventId);
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
