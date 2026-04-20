/**
 * T9 / B2: Unmapped-item queue endpoint.
 *
 * Pure computation lives in lib/t9Benchmarks.mjs (test-importable without
 * Next.js module resolution). See that file for the reason-priority ordering
 * and the sources of each "unmapped" signal.
 *
 * Response:
 *   {
 *     location_id,
 *     total_items, unmapped_count, unmapped_pct,
 *     rows: [{recipe_id, recipe_name, ingredient, reason}, ...]   // cap 50
 *   }
 */

import { getDb } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import { computeUnmapped } from '../../../lib/t9Benchmarks.mjs';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const payload = computeUnmapped(db, loc);
    return Response.json({ location_id: loc, ...payload });
  } catch (err) {
    console.error('GET /api/unmapped failed:', err);
    return Response.json({ error: 'Failed to load unmapped queue' }, { status: 500 });
  }
}
