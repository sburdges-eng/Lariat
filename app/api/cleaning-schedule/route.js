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

function selectRows(db, locationId, includeArchived) {
  const base = `SELECT id, location_id, area, task, frequency, last_done,
                       next_due, notes, active, created_at, archived_at
                  FROM cleaning_schedule
                 WHERE location_id = ?`;
  const filter = includeArchived ? '' : ' AND archived_at IS NULL';
  const order = ' ORDER BY area, task, id';
  return db.prepare(base + filter + order).all(locationId);
}

function selectOne(db, id) {
  return db
    .prepare(
      `SELECT id, location_id, area, task, frequency, last_done,
              next_due, notes, active, created_at, archived_at
         FROM cleaning_schedule
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
    console.error('GET /api/cleaning-schedule failed:', err);
    return Response.json({ error: 'Failed to load cleaning schedule' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    // If caller supplied location_id as a blank string, treat that as an
    // explicit error rather than silently substituting the default.
    if (
      'location_id' in body &&
      typeof body.location_id === 'string' &&
      body.location_id.trim() === ''
    ) {
      return Response.json({ error: 'location_id cannot be empty' }, { status: 400 });
    }

    const area = clip(body.area, 120);
    if (!area) {
      return Response.json({ error: 'area is required' }, { status: 400 });
    }
    const task = clip(body.task, 240);
    if (!task) {
      return Response.json({ error: 'task is required' }, { status: 400 });
    }
    const frequency = clip(body.frequency, 64);
    if (!frequency) {
      return Response.json({ error: 'frequency is required' }, { status: 400 });
    }

    const locationId = clip(body.location_id, 64) || locationFromBody(body);
    const last_done = clip(body.last_done, 32);
    const next_due = clip(body.next_due, 32);
    const notes = clip(body.notes, 500);

    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO cleaning_schedule
           (location_id, area, task, frequency, last_done, next_due,
            notes, active, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      )
      .run(locationId, area, task, frequency, last_done, next_due, notes);
    const row = selectOne(db, info.lastInsertRowid);
    return Response.json({ ok: true, row });
  } catch (err) {
    console.error('POST /api/cleaning-schedule failed:', err);
    return Response.json({ error: 'Failed to create cleaning schedule row' }, { status: 500 });
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
      return Response.json({ error: 'cleaning schedule row not found' }, { status: 404 });
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
    if ('area' in body) {
      const area = clip(body.area, 120);
      if (!area) {
        return Response.json({ error: 'area cannot be empty' }, { status: 400 });
      }
      push('area', area);
    }
    if ('task' in body) {
      const task = clip(body.task, 240);
      if (!task) {
        return Response.json({ error: 'task cannot be empty' }, { status: 400 });
      }
      push('task', task);
    }
    if ('frequency' in body) {
      const frequency = clip(body.frequency, 64);
      if (!frequency) {
        return Response.json({ error: 'frequency cannot be empty' }, { status: 400 });
      }
      push('frequency', frequency);
    }
    if ('last_done' in body) push('last_done', clip(body.last_done, 32));
    if ('next_due' in body) push('next_due', clip(body.next_due, 32));
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
    db.prepare(`UPDATE cleaning_schedule SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = selectOne(db, id);
    return Response.json({ ok: true, row });
  } catch (err) {
    console.error('PATCH /api/cleaning-schedule failed:', err);
    return Response.json({ error: 'Failed to update cleaning schedule row' }, { status: 500 });
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
      return Response.json({ error: 'cleaning schedule row not found' }, { status: 404 });
    }

    db.prepare(
      `UPDATE cleaning_schedule
          SET active = 0,
              archived_at = datetime('now')
        WHERE id = ?`,
    ).run(id);

    const row = selectOne(db, id);
    return Response.json({ ok: true, row });
  } catch (err) {
    console.error('DELETE /api/cleaning-schedule failed:', err);
    return Response.json({ error: 'Failed to archive cleaning schedule row' }, { status: 500 });
  }
}
