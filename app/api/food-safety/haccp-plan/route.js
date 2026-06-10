// @ts-check
// GET /api/food-safety/haccp-plan?date=YYYY-MM-DD&location=…
//   → HaccpPlan JSON (see lib/haccpPlan.ts)
//
// Read-only assembly of the inspector-ready HACCP plan: active CCPs with
// FDA citations, last-30-days corrective actions, and calibration records.
// The printable page at /food-safety/haccp-plan renders the same object;
// this endpoint exists for programmatic export.
//
// No PIN gate: like /api/corrective-actions, this is an informational
// food-safety read — the document exists to be handed to an inspector.

import { todayISO } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { buildHaccpPlan } from '../../../../lib/haccpPlan';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateRaw = url.searchParams.get('date');
    const date = dateRaw && ISO_DATE.test(dateRaw) ? dateRaw : todayISO();
    const location_id = locationFromRequest(req);

    const plan = buildHaccpPlan(location_id, date);

    return Response.json(plan, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/food-safety/haccp-plan failed:', err);
    return Response.json({ error: 'Could not build HACCP plan' }, { status: 500 });
  }
}
