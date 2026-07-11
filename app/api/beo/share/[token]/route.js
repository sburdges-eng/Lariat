// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../lib/db';
import { isValidShareTokenShape } from '../../../../../lib/beoShare';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ token?: string }> | { token?: string } }} RouteCtx */
/**
 * The public-doc columns this route reads off beo_events (location_id is
 * stripped before the response).
 * @typedef {{ id: number, title: string, event_date: string | null,
 *             event_time: string | null, contact_name: string | null,
 *             guest_count: number | null, notes: string | null,
 *             tax_rate: number | null, service_fee_pct: number | null,
 *             location_id: string }} PublicEventRow
 */

// PUBLIC route. Guests with the share token can read the BEO doc.
// The response is deliberately sanitized: line-item PREP fields and
// course station_id stay server-side because they're kitchen-internal.
// Prices remain visible — clients see what they're being charged for,
// matching every banquet-event-order software in the industry.
//
// Middleware (middleware.js PUBLIC_CARVEOUTS) exempts /api/beo/share/*
// from the PIN gate. The token itself is the access boundary.

/**
 * @param {Request} _req
 * @param {RouteCtx} ctx
 */
export async function GET(_req, ctx) {
  const params = await ctx?.params;
  const token = params?.token;
  if (!isValidShareTokenShape(token)) {
    return Response.json({ error: 'invalid token' }, { status: 404 });
  }

  const db = getDb();
  const event = /** @type {PublicEventRow | undefined} */ (db
    .prepare(
      `SELECT id, title, event_date, event_time, contact_name, guest_count,
              notes, tax_rate, service_fee_pct, location_id
         FROM beo_events
        WHERE share_token = ?
          AND share_revoked_at IS NULL
          AND (share_expires_at IS NULL OR datetime(share_expires_at) > datetime('now'))`,
    )
    .get(token));
  if (!event) return Response.json({ error: 'not found' }, { status: 404 });

  const lineItems = db
    .prepare(
      `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
         FROM beo_line_items
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id);

  const courses = db
    .prepare(
      `SELECT id, course_label, fire_at, notes, sort_order
         FROM beo_courses
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id);

  const signatures = db
    .prepare(
      `SELECT id, signed_name, signed_at FROM beo_signatures
        WHERE event_id = ? ORDER BY signed_at DESC, id DESC`,
    )
    .all(event.id);

  // Drop location_id from the response — it's internal routing data,
  // not relevant to the guest viewing the doc.
  const { location_id: _loc, ...publicEvent } = event;
  return Response.json({
    event: publicEvent,
    line_items: lineItems,
    courses,
    signatures,
  });
}
