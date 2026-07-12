// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
// PIN-gated settlement read for a single show. Uses Response.json
// rather than next/server's NextResponse so the route is loadable
// from the Node test runner — same pattern as /api/beo/route.js
// and /api/shows/[id]/deal/route.js.

import { hasPinCookie } from '../../../../../lib/pin';
import { locationFromRequest } from '../../../../../lib/location';
import { getSettlement } from '../../../../../lib/settlementRepo';
import { json } from '../../../../../lib/routeHelpers';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  try {
    const summary = getSettlement(showId, locationId);
    return json(summary, { status: 200 });
  } catch (e) {
    if (/not found/.test(String(/** @type {{ message?: unknown } | null} */ (e)?.message)))
      return json({ error: 'show not found' }, { status: 404 });
    throw e;
  }
}
