// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { todayISO } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { summarize } from '../../../../lib/commandCenter';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const today = (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
      ? dateParam
      : todayISO();
    const loc = locationFromRequest(req);
    const summary = summarize(loc, today);
    return Response.json(summary);
  } catch (err) {
    console.error('GET /api/command/summary failed:', err);
    return Response.json({ error: 'Could not load summary' }, { status: 500 });
  }
}
