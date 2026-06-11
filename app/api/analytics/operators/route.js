// @ts-check
// GET /api/analytics/operators — operator-analytics dashboard JSON
// (roadmap 3.5). PIN-gated by middleware via the /api/analytics prefix.
//
// Query params:
//   ?window=7|30|90   rolling window in days (default 30; anything else → 400)
//   ?date=YYYY-MM-DD  window end (default today; malformed values fall back)
//   ?location=...     location scope (locationFromRequest)

import { todayISO } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import {
  buildOperatorAnalytics,
  isAllowedWindow,
  DEFAULT_OPERATOR_ANALYTICS_WINDOW,
  OPERATOR_ANALYTICS_WINDOWS,
} from '../../../../lib/operatorAnalytics';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);

    let windowDays = DEFAULT_OPERATOR_ANALYTICS_WINDOW;
    const windowParam = url.searchParams.get('window');
    if (windowParam != null) {
      const n = Number(windowParam);
      if (!Number.isInteger(n) || !isAllowedWindow(n)) {
        return Response.json(
          { error: `window must be one of ${OPERATOR_ANALYTICS_WINDOWS.join(', ')}` },
          { status: 400, headers: { 'cache-control': 'no-store' } },
        );
      }
      windowDays = n;
    }

    const dateParam = url.searchParams.get('date');
    const today =
      typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : todayISO();

    const loc = locationFromRequest(req);
    const analytics = buildOperatorAnalytics(loc, today, windowDays);
    return Response.json(analytics, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/analytics/operators failed:', err);
    return Response.json({ error: 'Could not load operator analytics' }, { status: 500 });
  }
}
