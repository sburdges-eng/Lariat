// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { computeMenuEngineering } from '../../../lib/menuEngineering';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const u = new URL(req.url);
  const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
  try {
    const data = computeMenuEngineering(loc);
    return Response.json({ location_id: loc, ...data });
  } catch (err) {
    console.error(err);
    const e = /** @type {{ message?: unknown } | null} */ (err);
    return Response.json({ error: String(e?.message) }, { status: 500 });
  }
}
