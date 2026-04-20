/**
 * T9 / B1 + B3: Costing benchmark endpoint.
 *
 * Extends — never replaces — any previously exposed fields. Pure computation
 * lives in lib/t9Benchmarks.mjs (test-importable without Next.js module
 * resolution); this file is a thin I/O wrapper that reads the location and
 * serializes JSON.
 *
 * Shape:
 *   {
 *     location_id,
 *     variance: {
 *       max_variance_pct, mean_variance_pct, recipes_over_5pct,
 *       rows: [{recipe_id, recipe_name, theoretical, actual, variance_pct}, ...]
 *     },
 *     ingest: { last_run_at, last_status, age_minutes }
 *   }
 */

import { getDb } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import {
  computeCostVariance,
  readLastCostingIngest,
} from '../../../lib/t9Benchmarks.mjs';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const variance = computeCostVariance(db, loc);
    const ingest = readLastCostingIngest(db);

    // Top 5 only for the dashboard tile; full list stays out of the JSON to
    // bound payload size on a production workbook (~300 recipes).
    return Response.json({
      location_id: loc,
      variance: {
        max_variance_pct: variance.max_variance_pct,
        mean_variance_pct: variance.mean_variance_pct,
        recipes_over_5pct: variance.recipes_over_5pct,
        rows: variance.rows.slice(0, 5),
      },
      ingest,
    });
  } catch (err) {
    console.error('GET /api/costing failed:', err);
    return Response.json({ error: 'Failed to load costing benchmarks' }, { status: 500 });
  }
}
