// @ts-check
// First-run setup status (roadmap 3.4). Read-only step detection for
// the /setup wizard. Intentionally reachable pre-PIN — it is NOT in
// the middleware matcher, because the wizard's first job is telling a
// brand-new install that no PIN exists yet. Nothing here is sensitive:
// booleans + row counts only.
import { getSetupStatus } from '../../../../lib/setupStatus';
import { locationFromRequest } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const status = getSetupStatus(loc);
    return Response.json(status, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/setup/status failed:', err);
    return Response.json({ error: 'Failed to load setup status' }, { status: 500 });
  }
}
