import { getDb, todayISO } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { clip } from '../../../lib/clip';

export const dynamic = 'force-dynamic';

function asPriority(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // 0 normal, 1 high, 2 rush. Anything else collapses to normal.
  return n === 1 || n === 2 ? n : 0;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const loc = locationFromRequest(req);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, shift_date, station_id, task, qty, recipe_slug, notes,
                priority, assigned_cook_id, status, started_at, done_at, done_by,
                source, source_ref, sort_order, created_at, updated_at
           FROM prep_tasks
          WHERE shift_date = ? AND location_id = ?
          ORDER BY priority DESC, sort_order ASC, id ASC`,
      )
      .all(date, loc);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/prep-tasks failed:', err);
    return Response.json({ error: 'Could not load prep board' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const task = clip(body.task, 300);
    if (!task) return Response.json({ error: 'task required' }, { status: 400 });
    const loc = locationFromBody(body);
    const db = getDb();

    const newId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO prep_tasks
             (shift_date, station_id, task, qty, recipe_slug, notes, priority,
              assigned_cook_id, source, source_ref, sort_order, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          clip(body.shift_date, 32) || todayISO(),
          clip(body.station_id, 64),
          task,
          clip(body.qty, 64),
          clip(body.recipe_slug, 200),
          clip(body.notes, 1000),
          asPriority(body.priority),
          clip(body.assigned_cook_id, 64),
          clip(body.source, 32) || 'manual',
          clip(body.source_ref, 200),
          Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
          loc,
        );
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'prep_tasks', entity_id: id, action: 'insert',
        actor_cook_id: clip(body.assigned_cook_id, 64),
        actor_source: 'api',
        location_id: loc,
        payload: { task, station_id: clip(body.station_id, 64), source: body.source || 'manual' },
      });
      return id;
    })();

    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/prep-tasks failed:', err);
    return Response.json({ error: 'Could not save task' }, { status: 500 });
  }
}
