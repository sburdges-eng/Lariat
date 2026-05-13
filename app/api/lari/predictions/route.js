import { getDb, todayISO } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { requirePin } from '../../../../lib/pin';
import { buildBeoPredictions } from '../../../../lib/lariPredictions';

export const dynamic = 'force-dynamic';

// LaRi ambient predictions — read-only feed for the ambient strip.
//
// V5 ships a deterministic stub: walk operational tables for the
// requested surface, emit up to 5 predictions ranked by severity. The
// contract is the response shape, not the inference logic — every
// future ML/heuristic upgrade keeps `LariPrediction[]` as the output.
//
// PIN-gated via `requirePin()` (defense-in-depth — the consumer pages
// are already in the middleware matcher list, this re-checks).
//
// Surfaces supported in V5:
//   ?surface=beo  → BEO prep + line-item rollup for tonight + 7d out
// Other values return an empty list rather than 4xx, so the consumer
// component can ship a generic loader without a per-surface case.

const SUPPORTED_SURFACES = new Set(['beo']);

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const u = new URL(req.url);
    const surface = u.searchParams.get('surface') || 'beo';
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const today = u.searchParams.get('date') || todayISO();

    if (!SUPPORTED_SURFACES.has(surface)) {
      return Response.json({
        surface,
        location_id: loc,
        date: today,
        predictions: [],
        note: `Surface "${surface}" has no LaRi handler yet.`,
      });
    }

    const db = getDb();

    if (surface === 'beo') {
      const events = db
        .prepare(
          `SELECT id, title, event_date, event_time, contact_name, guest_count, notes
             FROM beo_events
            WHERE location_id = ?
              AND (event_date IS NULL OR event_date >= ?)
            ORDER BY event_date, id`,
        )
        .all(loc, today);

      const lineItems = events.length
        ? db
            .prepare(
              `SELECT id, event_id, item_name, quantity
                 FROM beo_line_items
                WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
            )
            .all(loc)
        : [];

      const prepTasks = events.length
        ? db
            .prepare(
              `SELECT id, event_id, task, due_date, done
                 FROM beo_prep_tasks
                WHERE location_id = ?`,
            )
            .all(loc)
        : [];

      const predictions = buildBeoPredictions({ events, lineItems, prepTasks, today });

      return Response.json({
        surface,
        location_id: loc,
        date: today,
        predictions,
      });
    }

    // Defensive: SUPPORTED_SURFACES gate is checked above, but if a
    // future contributor adds a value to the set without wiring the
    // branch, fall through gracefully rather than throw.
    return Response.json({
      surface,
      location_id: loc,
      date: today,
      predictions: [],
      note: `Handler for surface "${surface}" is registered but unimplemented.`,
    });
  } catch (err) {
    console.error('GET /api/lari/predictions failed:', err);
    return Response.json({ error: 'Failed to load LaRi predictions' }, { status: 500 });
  }
}
