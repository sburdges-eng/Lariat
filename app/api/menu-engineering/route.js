import { computeMenuEngineering } from '../../../lib/menuEngineering';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const u = new URL(req.url);
  const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
  try {
    const data = computeMenuEngineering(loc);
    return Response.json({ location_id: loc, ...data });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String(e.message) }, { status: 500 });
  }
}
