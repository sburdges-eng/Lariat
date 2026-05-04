// PATCH /api/beo/courses/:id  — edit a course (label, fire_at, notes, sort_order).
// DELETE /api/beo/courses/:id — drop a course; child line_items.course_id → NULL via FK.
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// Same gate as POST /api/beo/courses (master PIN OR temp PIN with
// 'beo.fire_at_edit' scope). Audit row in same tx.

import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../../../lib/pin';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../lib/idempotency';
import { locationFromBodyOrRequest } from '../../../../../lib/location';
import { isIso8601Utc, isStationSlug } from '../../../../../lib/beoCourses';

export const dynamic = 'force-dynamic';

const SCOPE = 'beo.fire_at_edit';
const MAX_LABEL = 80;
const MAX_NOTES = 2000;

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireAuth(req) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, SCOPE))) {
    return json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

export async function PATCH(req, ctx) {
  const fail = await requireAuth(req);
  if (fail) return fail;
  return withIdempotency(req, () => patchHandler(req, ctx));
}

export async function DELETE(req, ctx) {
  const fail = await requireAuth(req);
  if (fail) return fail;
  return withIdempotency(req, () => deleteHandler(req, ctx));
}

async function patchHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return json({ error: 'bad id' }, { status: 400 });

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  // Each field is optional; absence = "don't touch". An empty-string
  // course_label is rejected (would make the row unreadable to cooks).
  let labelToSet = undefined;
  if ('course_label' in body) {
    const v = clip(body.course_label, MAX_LABEL);
    if (!v) return json({ error: 'course_label cannot be empty' }, { status: 422 });
    labelToSet = v;
  }

  let fireAtToSet = undefined;
  if ('fire_at' in body) {
    if (!isIso8601Utc(body.fire_at)) {
      return json({ error: 'fire_at must be canonical ISO-8601 UTC' }, { status: 422 });
    }
    fireAtToSet = body.fire_at;
  }

  // notes: absent = no change; null/empty string = clear; non-empty = set.
  let notesPatch = { touch: false, val: null };
  if ('notes' in body) {
    notesPatch.touch = true;
    notesPatch.val = body.notes == null ? null : clip(body.notes, MAX_NOTES);
  }

  let sortToSet = undefined;
  if ('sort_order' in body && body.sort_order != null) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n) || n < 0) {
      return json({ error: 'sort_order must be a non-negative integer' }, { status: 422 });
    }
    sortToSet = n;
  }

  // station_id: absent = no change; null/empty = clear; non-empty slug = set.
  let stationPatch = { touch: false, val: null };
  if ('station_id' in body) {
    stationPatch.touch = true;
    if (body.station_id == null || body.station_id === '') {
      stationPatch.val = null;
    } else if (isStationSlug(body.station_id)) {
      stationPatch.val = body.station_id;
    } else {
      return json({ error: 'station_id must be a non-empty lowercased slug' }, { status: 422 });
    }
  }

  const location = locationFromBodyOrRequest(body, req);
  const db = getDb();

  const existing = db
    .prepare(`SELECT id, event_id FROM beo_courses WHERE id = ? AND location_id = ?`)
    .get(id, location);
  if (!existing) return json({ error: 'course not found' }, { status: 404 });

  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE beo_courses SET
           course_label = COALESCE(?, course_label),
           fire_at      = COALESCE(?, fire_at),
           notes        = CASE WHEN ? THEN ? ELSE notes END,
           sort_order   = COALESCE(?, sort_order),
           station_id   = CASE WHEN ? THEN ? ELSE station_id END,
           updated_at   = datetime('now')
         WHERE id = ?`,
      ).run(
        labelToSet ?? null,
        fireAtToSet ?? null,
        notesPatch.touch ? 1 : 0, notesPatch.val,
        sortToSet ?? null,
        stationPatch.touch ? 1 : 0, stationPatch.val,
        id,
      );

      postAuditEvent({
        entity: 'beo_course',
        entity_id: id,
        action: 'update',
        actor_cook_id: null,
        actor_source: 'manager_ui',
        location_id: location,
        payload: {
          course_label: labelToSet,
          fire_at: fireAtToSet,
          notes_set: notesPatch.touch,
          sort_order: sortToSet,
        },
      });
    })();
  } catch (err) {
    console.error('PATCH /api/beo/courses/:id failed:', err);
    return json({ error: 'could not update course' }, { status: 500 });
  }

  const row = db.prepare(`SELECT * FROM beo_courses WHERE id = ?`).get(id);
  return json(row, { status: 200 });
}

async function deleteHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return json({ error: 'bad id' }, { status: 400 });

  // Body is optional for DELETE — pull location from URL if no body.
  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const location = locationFromBodyOrRequest(body, req);
  const db = getDb();

  const existing = db
    .prepare(`SELECT id FROM beo_courses WHERE id = ? AND location_id = ?`)
    .get(id, location);
  if (!existing) return json({ error: 'course not found' }, { status: 404 });

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM beo_courses WHERE id = ?`).run(id);
      postAuditEvent({
        entity: 'beo_course',
        entity_id: id,
        action: 'delete',
        actor_cook_id: null,
        actor_source: 'manager_ui',
        location_id: location,
        payload: { id },
      });
    })();
  } catch (err) {
    console.error('DELETE /api/beo/courses/:id failed:', err);
    return json({ error: 'could not delete course' }, { status: 500 });
  }

  return json({ id, deleted: true }, { status: 200 });
}
