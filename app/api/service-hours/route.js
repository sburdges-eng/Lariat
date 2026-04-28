import { getDb } from '../../../lib/db';
import {
  DEFAULT_LOCATION_ID,
  locationFromBody,
  locationFromRequest,
} from '../../../lib/location';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

function toDayOfWeek(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  if (!Number.isInteger(n)) return NaN;
  if (n < 0 || n > 6) return NaN;
  return n;
}

function selectRows(db, locationId, includeArchived) {
  const base = `SELECT id, location_id, day_of_week, opens_at, closes_at,
                       service_label, notes, active, created_at, archived_at
                  FROM service_hours
                 WHERE location_id = ?`;
  const filter = includeArchived ? '' : ' AND archived_at IS NULL';
  const order = ' ORDER BY day_of_week, service_label, id';
  return db.prepare(base + filter + order).all(locationId);
}

function selectOne(db, id) {
  return db
    .prepare(
      `SELECT id, location_id, day_of_week, opens_at, closes_at,
              service_label, notes, active, created_at, archived_at
         FROM service_hours
        WHERE id = ?`,
    )
    .get(id);
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const locationId = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const includeArchived = url.searchParams.get('includeArchived') === '1';
    const db = getDb();
    const rows = selectRows(db, locationId, includeArchived);
    return Response.json({ location_id: locationId, rows });
  } catch (err) {
    console.error('GET /api/service-hours failed:', err);
    return Response.json({ error: 'Failed to load service hours' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    const dow = toDayOfWeek(body.day_of_week);
    if (dow === null || Number.isNaN(dow)) {
      return Response.json(
        { error: 'day_of_week must be an integer 0-6 (0=Sunday)' },
        { status: 400 },
      );
    }

    // If caller supplied location_id as a blank string, treat that as an
    // explicit error rather than silently substituting the default.
    if (
      'location_id' in body &&
      typeof body.location_id === 'string' &&
      body.location_id.trim() === ''
    ) {
      return Response.json({ error: 'location_id cannot be empty' }, { status: 400 });
    }

    const locationId = clip(body.location_id, 64) || locationFromBody(body);
    const opens_at = clip(body.opens_at, 16);
    const closes_at = clip(body.closes_at, 16);
    const service_label = clip(body.service_label, 64);
    const notes = clip(body.notes, 500);

    const db = getDb();
    try {
      const info = db
        .prepare(
          `INSERT INTO service_hours
             (location_id, day_of_week, opens_at, closes_at,
              service_label, notes, active, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, NULL)`,
        )
        .run(locationId, dow, opens_at, closes_at, service_label, notes);
      const row = selectOne(db, info.lastInsertRowid);
      return Response.json({ ok: true, row });
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE')) {
        return Response.json(
          { error: 'A row for that day and service already exists' },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/service-hours failed:', err);
    return Response.json({ error: 'Failed to create service hour' }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }

    const db = getDb();
    const existing = selectOne(db, id);
    if (!existing) {
      return Response.json({ error: 'service hour not found' }, { status: 404 });
    }

    const sets = [];
    const vals = [];
    const push = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };

    if ('location_id' in body) {
      // Blank string is an explicit error (don't silently move the row to
      // DEFAULT_LOCATION_ID). Absent key is handled above by the `in` check
      // and falls through to the usual create/edit path.
      if (typeof body.location_id === 'string' && body.location_id.trim() === '') {
        return Response.json({ error: 'location_id cannot be empty' }, { status: 400 });
      }
      const loc = clip(body.location_id, 64) || DEFAULT_LOCATION_ID;
      push('location_id', loc);
    }
    if ('day_of_week' in body) {
      const dow = toDayOfWeek(body.day_of_week);
      if (dow === null || Number.isNaN(dow)) {
        return Response.json(
          { error: 'day_of_week must be an integer 0-6 (0=Sunday)' },
          { status: 400 },
        );
      }
      push('day_of_week', dow);
    }
    if ('opens_at' in body) push('opens_at', clip(body.opens_at, 16));
    if ('closes_at' in body) push('closes_at', clip(body.closes_at, 16));
    if ('service_label' in body) push('service_label', clip(body.service_label, 64));
    if ('notes' in body) push('notes', clip(body.notes, 500));

    if ('active' in body) {
      const act = Number(body.active) === 1 ? 1 : 0;
      push('active', act);
      // Resurrection: active=1 clears archived_at back to NULL.
      // active=0 alone does NOT archive here — use DELETE for that.
      if (act === 1) push('archived_at', null);
    }

    if (sets.length === 0) {
      return Response.json({ error: 'no editable fields supplied' }, { status: 400 });
    }

    vals.push(id);
    try {
      db.prepare(`UPDATE service_hours SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE')) {
        return Response.json(
          { error: 'A row for that day and service already exists' },
          { status: 409 },
        );
      }
      throw err;
    }
    const row = selectOne(db, id);
    return Response.json({ ok: true, row });
  } catch (err) {
    console.error('PATCH /api/service-hours failed:', err);
    return Response.json({ error: 'Failed to update service hour' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }

    const db = getDb();
    const existing = selectOne(db, id);
    if (!existing) {
      return Response.json({ error: 'service hour not found' }, { status: 404 });
    }

    db.prepare(
      `UPDATE service_hours
          SET active = 0,
              archived_at = datetime('now')
        WHERE id = ?`,
    ).run(id);

    const row = selectOne(db, id);
    return Response.json({ ok: true, row });
  } catch (err) {
    console.error('DELETE /api/service-hours failed:', err);
    return Response.json({ error: 'Failed to archive service hour' }, { status: 500 });
  }
}
