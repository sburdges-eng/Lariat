// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
/**
 * GET /api/receiving/matches
 *
 * Manager queue for accepted receiving rows that captured qty/unit but
 * could not be tied to ingredient_masters at check-in. Resolution lives
 * in /api/receiving/matches/[id].
 */

import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { locationFromRequest } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const location_id = locationFromRequest(req);
    const db = getDb();
    const matches = db
      .prepare(
        `SELECT r.*
           FROM receiving_log r
          WHERE r.location_id = ?
            AND r.status IN ('accepted', 'accepted_with_note')
            AND r.received_qty IS NOT NULL
            AND r.received_qty > 0
            AND r.received_unit IS NOT NULL
            AND trim(r.received_unit) != ''
            AND COALESCE(r.match_status, 'not_attempted') IN ('unmatched', 'ambiguous')
          ORDER BY r.created_at DESC, r.id DESC`,
      )
      .all(location_id);

    return Response.json({
      location_id,
      total: matches.length,
      matches,
    });
  } catch (err) {
    console.error('GET /api/receiving/matches failed:', err);
    return Response.json(
      { error: 'Failed to load receiving matches' },
      { status: 500 },
    );
  }
}
