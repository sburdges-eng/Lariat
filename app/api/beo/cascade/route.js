// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// GET /api/beo/cascade?event_id=N[&location=<slug>]
//
// Loads a BEO event's line items from SQLite and runs the cascade engine
// (lib/beoCascade.ts::cascadeFromLineItems) to produce an order guide,
// prep demands, and unmapped items for that event.
//
// Location scoping: beo_line_items has NO location_id column — we verify
// the event's location_id first, then load its line items.

import { json } from '../../../../lib/routeHelpers';
import { getDb } from '../../../../lib/db';
import { cascadeFromLineItems } from '../../../../lib/beoCascade';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const location = url.searchParams.get('location') || 'default';

  const eventIdRaw = url.searchParams.get('event_id');
  const eventIdNum = Number(eventIdRaw);

  // Validate: must be a present, positive integer
  if (
    eventIdRaw === null ||
    eventIdRaw === '' ||
    !Number.isInteger(eventIdNum) ||
    eventIdNum <= 0
  ) {
    return json({ error: 'event_id required' }, { status: 400 });
  }

  const eventId = eventIdNum;

  try {
    const db = getDb();

    // Verify event exists and belongs to the requested location.
    // Same message for missing event and wrong-location event — no cross-location leak.
    const event = db
      .prepare(`SELECT location_id FROM beo_events WHERE id = ?`)
      .get(eventId);

    if (!event || event.location_id !== location) {
      return json({ error: 'event not found' }, { status: 404 });
    }

    // Load line items — event already location-verified above.
    const rows = db
      .prepare(`SELECT item_name, quantity FROM beo_line_items WHERE event_id = ?`)
      .all(eventId);

    const lineItems = rows.map((r) => ({ item_name: r.item_name, quantity: r.quantity }));

    let result;
    try {
      result = await cascadeFromLineItems(lineItems);
    } catch (err) {
      // CascadeError (engine/data condition) — return consistent shape with error banner info.
      return json(
        {
          event_id: eventId,
          order_guide: [],
          prep_demands: [],
          unmapped: [],
          error: String(err.message || err),
        },
        { status: 200 },
      );
    }

    return json(
      {
        event_id: eventId,
        order_guide: result.orderGuide,
        prep_demands: result.prepDemands,
        unmapped: result.unmapped,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('GET /api/beo/cascade failed:', err);
    return json({ error: 'could not load cascade' }, { status: 500 });
  }
}
