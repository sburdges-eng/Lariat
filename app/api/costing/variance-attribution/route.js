// @ts-check
// GET /api/costing/variance-attribution — "the variance moved, what did
// we change?" evidence payload. Read-only; PIN-gated by middleware via
// the /api/costing/* prefix.
//
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   explicit period_end pair (optional;
//                                    default = two most recent periods)
//   ?location=<id>                   location scope

import { locationFromRequest } from '../../../../lib/location';
import { buildVarianceAttribution } from '../../../../lib/varianceAttribution';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** @param {Request} req */
export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if ((from !== null && !DATE_RE.test(from)) || (to !== null && !DATE_RE.test(to))) {
      return Response.json(
        { error: 'from/to must be YYYY-MM-DD' },
        { status: 400, headers: NO_STORE },
      );
    }

    /** @type {{ from?: string, to?: string }} */
    const opts = {};
    if (from !== null) opts.from = from;
    if (to !== null) opts.to = to;

    const payload = buildVarianceAttribution(loc, opts);
    return Response.json(payload, { headers: NO_STORE });
  } catch (err) {
    console.error('GET /api/costing/variance-attribution failed:', err);
    return Response.json(
      { error: 'Could not build variance attribution' },
      { status: 500, headers: NO_STORE },
    );
  }
}
