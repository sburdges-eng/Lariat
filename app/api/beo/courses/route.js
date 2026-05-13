// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// POST /api/beo/courses — create a new course on a BEO event.
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// Gated via hasPinOrTempPin('beo.fire_at_edit') so a manager-issued
// temp PIN can also drive this surface (per spec §C). Audit row in
// the same transaction as the insert (docs/PATTERNS.md §3).

import { json } from '../../../../lib/routeHelpers';
import { getDb } from '../../../../lib/db';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../../lib/pin';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';
import { locationFromBodyOrRequest } from '../../../../lib/location';
import { validateCoursePayload, nextSortOrder } from '../../../../lib/beoCourses';

export const dynamic = 'force-dynamic';

const SCOPE = 'beo.fire_at_edit';

async function requireAuth(req) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, SCOPE))) {
    return json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

// GET ?event_id=&location= — list courses for one event.
// Same gate as POST: managers (master PIN) or temp-PIN with the
// 'beo.fire_at_edit' scope. The fire-schedule rollup (T7) is separate
// and PUBLIC; this list endpoint is the editor side and stays gated.
export async function GET(req) {
  const fail = await requireAuth(req);
  if (fail) return fail;

  const url = new URL(req.url);
  const eventId = Number(url.searchParams.get('event_id'));
  const location = url.searchParams.get('location') || 'default';

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return json({ error: 'event_id required' }, { status: 422 });
  }

  const db = getDb();
  const courses = db
    .prepare(
      `SELECT id, event_id, location_id, course_label, fire_at, notes, sort_order, created_at, updated_at
         FROM beo_courses
        WHERE event_id = ? AND location_id = ?
        ORDER BY sort_order, fire_at, id`,
    )
    .all(eventId, location);

  return json({ courses }, { status: 200 });
}

export async function POST(req) {
  const fail = await requireAuth(req);
  if (fail) return fail;
  return withIdempotency(req, () => createHandler(req));
}

async function createHandler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  const eventId = Number(body?.event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return json({ error: 'event_id required (positive integer)' }, { status: 422 });
  }

  const v = validateCoursePayload(body);
  if (!v.ok) return json({ error: v.error }, { status: 422 });
  const { course_label, fire_at, notes, sort_order: sortOrderIn, station_id: stationId } = v.payload;

  const location = locationFromBodyOrRequest(body, req);
  const db = getDb();

  // Confirm the event exists and belongs to this location — prevents
  // a request from location A creating a course on an event in location B.
  const ev = db
    .prepare(`SELECT id FROM beo_events WHERE id = ? AND location_id = ?`)
    .get(eventId, location);
  if (!ev) {
    return json({ error: 'event not found at this location' }, { status: 404 });
  }

  let resolvedSortOrder = sortOrderIn;
  if (resolvedSortOrder === null) {
    const row = db
      .prepare(`SELECT MAX(sort_order) AS m FROM beo_courses WHERE event_id = ?`)
      .get(eventId);
    resolvedSortOrder = nextSortOrder(row?.m ?? null);
  }

  let newId = 0;
  try {
    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO beo_courses
             (event_id, location_id, course_label, fire_at, notes, sort_order, station_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(eventId, location, course_label, fire_at, notes, resolvedSortOrder, stationId);
      newId = Number(info.lastInsertRowid);

      postAuditEvent({
        entity: 'beo_course',
        entity_id: newId,
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'manager_ui',
        location_id: location,
        payload: { event_id: eventId, course_label, fire_at, sort_order: resolvedSortOrder, station_id: stationId },
      });
    })();
  } catch (err) {
    console.error('POST /api/beo/courses failed:', err);
    return json({ error: 'could not save course' }, { status: 500 });
  }

  return json(
    {
      id: newId,
      event_id: eventId,
      location_id: location,
      course_label,
      fire_at,
      notes,
      sort_order: resolvedSortOrder,
    },
    { status: 200 },
  );
}
