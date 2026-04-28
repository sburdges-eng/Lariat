import { computeDishCoverage } from '../../../lib/dishCostBridge';
import { DEFAULT_LOCATION_ID, locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const report = computeDishCoverage(location_id);
    return Response.json({ location_id, ...report });
  } catch (err) {
    console.error('GET /api/dish-coverage failed:', err);
    return Response.json({ error: 'Failed to compute dish coverage' }, { status: 500 });
  }
}
