import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 200;
const MAX_TASK = 500;
const MAX_NOTES = 2000;

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function GET(req) {
  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const db = getDb();
    const events = db.prepare(`SELECT * FROM beo_events WHERE location_id = ? ORDER BY event_date DESC, id DESC`).all(loc);
    const tasks = db.prepare(`SELECT * FROM beo_prep_tasks WHERE location_id = ? ORDER BY event_id, sort_order, id`).all(loc);
    return Response.json({ location_id: loc, events, prep_tasks: tasks });
  } catch (err) {
    console.error('GET /api/beo failed:', err);
    return Response.json({ error: 'Failed to load BEO' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const loc = body.location_id || DEFAULT_LOCATION_ID;
    const db = getDb();

    if (body.action === 'event') {
      const title = clip(body.title, MAX_TITLE);
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const gc = body.guest_count == null ? null : Number(body.guest_count);
      const info = db
        .prepare(
          `INSERT INTO beo_events (title, event_date, guest_count, notes, status, location_id) VALUES (?,?,?,?,?,?)`
        )
        .run(
          title,
          clip(body.event_date, 32) || todayISO(),
          Number.isFinite(gc) ? gc : null,
          clip(body.notes, MAX_NOTES),
          clip(body.status, 32) || 'planned',
          loc,
        );
      return Response.json({ ok: true, id: info.lastInsertRowid });
    }

    if (body.action === 'prep') {
      const event_id = Number(body.event_id);
      const task = clip(body.task, MAX_TASK);
      if (!Number.isInteger(event_id) || !task) {
        return Response.json({ error: 'event_id and task required' }, { status: 400 });
      }
      const info = db
        .prepare(
          `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id) VALUES (?,?,?,?,?,?)`
        )
        .run(event_id, task, clip(body.due_date, 32), 0, Number(body.sort_order) || 0, loc);
      return Response.json({ ok: true, id: info.lastInsertRowid });
    }

    if (body.action === 'prep_done') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.prepare(`UPDATE beo_prep_tasks SET done = ? WHERE id = ?`).run(body.done ? 1 : 0, id);
      return Response.json({ ok: true });
    }

    if (body.action === 'delete_event') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.prepare(`DELETE FROM beo_prep_tasks WHERE event_id = ?`).run(id);
      db.prepare(`DELETE FROM beo_events WHERE id = ?`).run(id);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/beo failed:', err);
    return Response.json({ error: 'Failed to save BEO change' }, { status: 500 });
  }
}
