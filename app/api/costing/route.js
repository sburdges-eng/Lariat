/**
 * T9 / B1 + B3: Costing benchmark endpoint.
 *
 * Extends — never replaces — any previously exposed fields. Pure computation
 * lives in lib/costingBenchmarks.mjs (test-importable without Next.js module
 * resolution); this file is a thin I/O wrapper that reads the location and
 * serializes JSON.
 *
 * Shape:
 *   {
 *     location_id,
 *     variance: {
 *       max_variance_pct, mean_variance_pct, recipes_over_5pct,
 *       rows: [{recipe_id, recipe_name, theoretical, actual, variance_pct,
 *              total_lines, unmatched_lines, excluded, exclusion_reason}, ...]
 *       summary: { healthy, yellow, red, excluded_high_unmatched }   // D6
 *     },
 *     ingest: { last_run_at, last_status, age_minutes }
 *   }
 *
 * D6: per-row `total_lines`, `unmatched_lines`, `excluded`, `exclusion_reason`
 * and a `summary` block are new. Existing fields (`max_variance_pct`,
 * `mean_variance_pct`, `recipes_over_5pct`, per-row `variance_pct`,
 * `theoretical`, `actual`) stay in the same place so the dashboard UI
 * doesn't break. `variance_pct` / `actual` are `null` on excluded rows
 * (previously unreachable — the pre-D6 BOM fallback always produced a
 * number).
 */

import { getDb } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import {
  computeCostVariance,
  readLastCostingIngest,
} from '../../../lib/costingBenchmarks.mjs';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const variance = computeCostVariance(db, loc);
    const ingest = readLastCostingIngest(db);

    // Top 5 only for the dashboard tile; full list stays out of the JSON to
    // bound payload size on a production workbook (~300 recipes). Excluded
    // rows sort to the end in computeCostVariance, so slicing the first 5
    // still prioritizes the highest-variance healthy recipes.
    return Response.json({
      location_id: loc,
      variance: {
        max_variance_pct: variance.max_variance_pct,
        mean_variance_pct: variance.mean_variance_pct,
        recipes_over_5pct: variance.recipes_over_5pct,
        rows: variance.rows.slice(0, 5),
        summary: variance.summary,
      },
      ingest,
    });
  } catch (err) {
    console.error('GET /api/costing failed:', err);
    return Response.json({ error: 'Failed to load costing benchmarks' }, { status: 500 });
  }
}
