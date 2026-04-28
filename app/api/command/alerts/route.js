import { todayISO } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { summarize, alertsFor } from '../../../../lib/commandCenter';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const today = (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
      ? dateParam
      : todayISO();
    const loc = locationFromRequest(req);
    const summary = summarize(loc, today);
    const alerts = alertsFor(summary);
    const red = alerts.filter((a) => a.severity === 'red').length;
    const amber = alerts.filter((a) => a.severity === 'amber').length;
    return Response.json({
      shift_date: today,
      location_id: loc,
      red,
      amber,
      alerts,
    });
  } catch (err) {
    console.error('GET /api/command/alerts failed:', err);
    return Response.json({ error: 'Could not load alerts' }, { status: 500 });
  }
}
