// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb, todayISO } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

/** @param {unknown} v @param {number} max @returns {string | null} */
const clip = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** @param {unknown} v @param {number} [fallback] @returns {number} */
const cleanInt = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** @param {unknown} v */
const cleanPriority = (v) => Math.max(0, Math.min(2, cleanInt(v, 0)));

/** @param {ReturnType<typeof getDb>} db @param {number | bigint} id */
function readTask(db, id) {
  return db
    .prepare(
      `SELECT id, shift_date, station_id, task, qty, recipe_slug, notes,
              priority, assigned_cook_id, status, started_at, done_at, done_by,
              source, source_ref, sort_order, location_id, created_at, updated_at
         FROM prep_tasks
        WHERE id = ?`,
    )
    .get(id);
}

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const loc = locationFromRequest(req);
    const shiftDate = clip(url.searchParams.get('date'), 32) || todayISO();
    const stationId = clip(url.searchParams.get('station_id'), 80);
    const status = clip(url.searchParams.get('status'), 32);
    const where = ['location_id = ?', 'shift_date = ?'];
    const args = [loc, shiftDate];
    if (stationId) {
      where.push('station_id = ?');
      args.push(stationId);
    }
    if (status) {
      where.push('status = ?');
      args.push(status);
    }

    const rows = getDb()
      .prepare(
        `SELECT id, shift_date, station_id, task, qty, recipe_slug, notes,
                priority, assigned_cook_id, status, started_at, done_at, done_by,
                source, source_ref, sort_order, location_id, created_at, updated_at
           FROM prep_tasks
          WHERE ${where.join(' AND ')}
          ORDER BY status = 'done', priority DESC, sort_order ASC, created_at ASC, id ASC`,
      )
      .all(...args);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/prep-tasks failed:', err);
    return Response.json({ error: 'Could not load prep tasks' }, { status: 500 });
  }
}

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => prepTaskPostHandler(req));
}

/** @param {Request} req */
async function prepTaskPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const shiftDate = clip(body.shift_date, 32) || todayISO();
    const stationId = clip(body.station_id, 80);
    const task = clip(body.task, 300);
    if (!task) {
      return Response.json({ error: 'task required' }, { status: 400 });
    }

    const qty = clip(body.qty, 80);
    const recipeSlug = clip(body.recipe_slug, 160);
    const notes = clip(body.notes, 1000);
    const priority = cleanPriority(body.priority);
    const assignedCookId = clip(body.assigned_cook_id, 64);
    const source = clip(body.source, 80) || 'manual';
    const sourceRef = clip(body.source_ref, 160);
    const sortOrder = cleanInt(body.sort_order, 0);
    const actorCookId = clip(body.cook_id, 64) || assignedCookId;
    const db = getDb();

    const taskRow = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO prep_tasks
             (shift_date, station_id, task, qty, recipe_slug, notes,
              priority, assigned_cook_id, status, source, source_ref,
              sort_order, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)`,
        )
        .run(
          shiftDate,
          stationId,
          task,
          qty,
          recipeSlug,
          notes,
          priority,
          assignedCookId,
          source,
          sourceRef,
          sortOrder,
          loc,
        );
      const id = Number(info.lastInsertRowid);
      const row = readTask(db, id);
      postAuditEvent({
        entity: 'prep_tasks',
        entity_id: id,
        action: 'insert',
        actor_cook_id: actorCookId,
        actor_source: 'cook_ui',
        shift_date: shiftDate,
        location_id: loc,
        payload: row,
      });
      return row;
    })();

    return Response.json({ ok: true, task: taskRow });
  } catch (err) {
    console.error('POST /api/prep-tasks failed:', err);
    return Response.json({ error: 'Could not save prep task' }, { status: 500 });
  }
}
