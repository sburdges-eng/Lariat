// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * /api/shows/[id]/box-office/[lineId] — Phase 2 box-office line ops.
 *
 * PATCH { action: 'mark_scanned', actor_cook_id }
 *   - flips scanned_at on a single ticket line at the door
 *   - idempotent: already-scanned line returns 404 (no-op surfaces as
 *     not-found so the door scanner doesn't double-emit audit events)
 *   - cash custody is regulated → DB audit (lib/auditEvents.ts) inside
 *     the same db.transaction as the UPDATE
 *
 * Defensive PIN gate in addition to middleware.
 */

import { getDb } from '../../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../../lib/location';
import { requirePinOrScope } from '../../../../../../lib/pin';
import { markScanned } from '../../../../../../lib/boxOfficeRepo';
import { withIdempotency } from '../../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

function parsePositiveInt(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const SCOPE = 'event.box_office';

export async function PATCH(req, ctx) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => boxOfficeLinePatchHandler(req, ctx));
}

async function boxOfficeLinePatchHandler(req, { params }) {

  params = await params;
  const showId = parsePositiveInt(params?.id);
  const lineId = parsePositiveInt(params?.lineId);
  if (showId == null || lineId == null) {
    return Response.json({ error: 'Invalid show or line id' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = typeof body?.action === 'string' ? body.action : '';
  if (action !== 'mark_scanned') {
    return Response.json(
      { error: 'Unsupported action; expected "mark_scanned"' },
      { status: 400 },
    );
  }

  const loc = locationFromBody(body) || locationFromRequest(req);
  const actor = typeof body?.actor_cook_id === 'string' ? body.actor_cook_id : null;

  try {
    const db = getDb();
    const line = markScanned(db, showId, lineId, loc, actor);
    if (!line) {
      return Response.json({ error: 'NotFound or already scanned' }, { status: 404 });
    }
    return Response.json({ line });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to mark scanned';
    console.error('PATCH /api/shows/[id]/box-office/[lineId] failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
