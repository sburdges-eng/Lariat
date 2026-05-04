// GET /api/beo/fire-schedule?date=YYYY-MM-DD&location=<slug>
//
// Per spec §B (T7). PUBLIC endpoint — line cooks read this on a wall
// iPad without entering a PIN. No PII is in the response (event titles
// are operator-set; if those leak guest names, the operator chooses
// the title).
//
// Returns the per-station rollup for "tonight" (events whose
// event_date matches the query). Joins beo_courses → beo_line_items
// (only lines with course_id set) and groups by beo_courses.station_id.

import { json } from '../../../../lib/routeHelpers';
import { getDb, todayISO } from '../../../../lib/db';
import { resolveSchedule } from '../../../../lib/beoFireSchedule';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || todayISO();
  const location = url.searchParams.get('location') || 'default';

  try {
    const db = getDb();

    const courses = db
      .prepare(
        `SELECT c.id, c.event_id, c.course_label, c.fire_at, c.station_id,
                e.title AS event_title
           FROM beo_courses c
           JOIN beo_events e ON e.id = c.event_id
          WHERE c.location_id = ?
            AND e.event_date = ?
          ORDER BY c.fire_at, c.id`,
      )
      .all(location, date);

    // Pull every line bound to one of these courses in a single query.
    const courseIds = courses.map((c) => c.id);
    let lines = [];
    if (courseIds.length > 0) {
      const placeholders = courseIds.map(() => '?').join(',');
      lines = db
        .prepare(
          `SELECT id, event_id, course_id, item_name, quantity, prep_notes, order_items_notes
             FROM beo_line_items
            WHERE course_id IN (${placeholders})`,
        )
        .all(...courseIds);
    }

    const payload = resolveSchedule(date, location, courses, lines);
    return json(payload, { status: 200 });
  } catch (err) {
    console.error('GET /api/beo/fire-schedule failed:', err);
    return json({ error: 'could not load schedule' }, { status: 500 });
  }
}
