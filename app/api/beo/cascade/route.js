// GET /api/beo/cascade?event_id=N[&location=<slug>]
//
// Loads a BEO event's line items from SQLite and runs the cascade engine
// (lib/beoCascade.ts::cascadeFromLineItems) to produce an order guide,
// prep demands, and unmapped items for that event.
//
// Location scoping: beo_line_items has NO location_id column — we verify
// the event's location_id first, then load its line items.

// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { json } from '../../../../lib/routeHelpers';
import { getDb } from '../../../../lib/db';
import { cascadeFromLineItems } from '../../../../lib/beoCascade';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
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
    const event = /** @type {{ location_id: string } | undefined} */ (db
      .prepare(`SELECT location_id FROM beo_events WHERE id = ?`)
      .get(eventId));

    if (!event || event.location_id !== location) {
      return json({ error: 'event not found' }, { status: 404 });
    }

    // Load line items — event already location-verified above.
    const rows = /** @type {{ item_name: string, quantity: number }[]} */ (db
      .prepare(`SELECT item_name, quantity FROM beo_line_items WHERE event_id = ?`)
      .all(eventId));

    const lineItems = rows.map((r) => ({ item_name: r.item_name, quantity: r.quantity }));

    // Load the latest inventory count for this location so the engine can
    // subtract on-hand stock (to_order = total_needed − on_hand). beo_line_items
    // has no location_id, but the count tables do — scope the count to the
    // event's already-verified location. A location with no count yields [].
    const inventory = /** @type {{ ingredient: string, unit: string | null, on_hand: number }[]} */ (db
      .prepare(
        `SELECT ingredient, unit, on_hand_qty AS on_hand
           FROM inventory_count_lines
          WHERE on_hand_qty IS NOT NULL
            AND count_id = (
              SELECT id FROM inventory_counts
               WHERE location_id = ?
               ORDER BY count_date DESC, id DESC
               LIMIT 1
            )`,
      )
      .all(location))
      .map((r) => ({ ingredient: r.ingredient, unit: r.unit || '', on_hand: r.on_hand }));

    let result;
    try {
      // BEO quantities are individual item counts for pricing (unit_cost × qty = total),
      // not recipe batch counts — pass qtyInYieldUnits so the engine doesn't multiply by yield.
      result = await cascadeFromLineItems(lineItems, { qtyInYieldUnits: true, inventory });
    } catch (err) {
      // CascadeError (engine/data condition) — return consistent shape with error banner info.
      const e = /** @type {{ message?: unknown } | null} */ (err);
      return json(
        {
          event_id: eventId,
          order_guide: [],
          prep_demands: [],
          unmapped: [],
          error: String(e?.message || err),
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
        manifest_warnings: result.manifestWarnings,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('GET /api/beo/cascade failed:', err);
    return json({ error: 'could not load cascade' }, { status: 500 });
  }
}
