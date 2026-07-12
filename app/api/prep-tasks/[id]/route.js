// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../lib/db';
import { locationFromBodyOrRequest } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

/** @typedef {{ params?: Promise<{ id?: unknown }> | { id?: unknown } }} RouteCtx */
/**
 * The prep_tasks row shape this handler reads (full SELECT; only
 * shift_date is accessed by name).
 * @typedef {{ shift_date: string } & Record<string, unknown>} PrepTaskRow
 */

const STATUSES = new Set(['todo', 'in_progress', 'done', 'skipped']);

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

/** @param {RouteCtx | null | undefined} ctx */
async function readId(ctx) {
  const params = await Promise.resolve(ctx?.params || {});
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {number} id
 * @param {string} loc
 * @returns {PrepTaskRow | undefined}
 */
function readTask(db, id, loc) {
  return /** @type {PrepTaskRow | undefined} */ (db
    .prepare(
      `SELECT id, shift_date, station_id, task, qty, recipe_slug, notes,
              priority, assigned_cook_id, status, started_at, done_at, done_by,
              source, source_ref, sort_order, location_id, created_at, updated_at
         FROM prep_tasks
        WHERE id = ? AND location_id = ?`,
    )
    .get(id, loc));
}

/**
 * @param {string[]} updates
 * @param {unknown[]} values
 * @param {string} column
 * @param {unknown} value
 */
function addSet(updates, values, column, value) {
  updates.push(`${column} = ?`);
  values.push(value);
}

/** @param {object} body @param {string} key */
function hasOwn(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function PATCH(req, ctx) {
  return withIdempotency(req, () => prepTaskPatchHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function prepTaskPatchHandler(req, ctx) {
  try {
    const id = await readId(ctx);
    if (!id) return Response.json({ error: 'bad id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const loc = locationFromBodyOrRequest(body, req);
    const cookId = clip(body.cook_id, 64) || clip(body.assigned_cook_id, 64);
    /** @type {string[]} */
    const updates = [];
    /** @type {unknown[]} */
    const values = [];

    if (body.claim === true && body.release === true) {
      return Response.json({ error: 'pick claim or release' }, { status: 400 });
    }
    if (body.claim === true) {
      if (!cookId) return Response.json({ error: 'cook required' }, { status: 400 });
      addSet(updates, values, 'assigned_cook_id', cookId);
    }
    if (body.release === true) {
      updates.push('assigned_cook_id = NULL');
    }

    if (hasOwn(body, 'status')) {
      const status = clip(body.status, 32);
      if (!status || !STATUSES.has(status)) {
        return Response.json({ error: 'bad status' }, { status: 400 });
      }
      addSet(updates, values, 'status', status);
      if (status === 'in_progress') {
        updates.push("started_at = COALESCE(started_at, datetime('now'))");
        updates.push('done_at = NULL');
        updates.push('done_by = NULL');
      } else if (status === 'done' || status === 'skipped') {
        updates.push("started_at = COALESCE(started_at, datetime('now'))");
        updates.push("done_at = datetime('now')");
        addSet(updates, values, 'done_by', cookId);
      } else {
        updates.push('started_at = NULL');
        updates.push('done_at = NULL');
        updates.push('done_by = NULL');
      }
    }

    if (hasOwn(body, 'task')) {
      const task = clip(body.task, 300);
      if (!task) return Response.json({ error: 'task required' }, { status: 400 });
      addSet(updates, values, 'task', task);
    }
    if (hasOwn(body, 'station_id')) addSet(updates, values, 'station_id', clip(body.station_id, 80));
    if (hasOwn(body, 'qty')) addSet(updates, values, 'qty', clip(body.qty, 80));
    if (hasOwn(body, 'recipe_slug')) addSet(updates, values, 'recipe_slug', clip(body.recipe_slug, 160));
    if (hasOwn(body, 'notes')) addSet(updates, values, 'notes', clip(body.notes, 1000));
    if (hasOwn(body, 'priority')) addSet(updates, values, 'priority', cleanPriority(body.priority));
    if (hasOwn(body, 'assigned_cook_id') && body.claim !== true) {
      addSet(updates, values, 'assigned_cook_id', clip(body.assigned_cook_id, 64));
    }
    if (hasOwn(body, 'sort_order')) addSet(updates, values, 'sort_order', cleanInt(body.sort_order, 0));

    if (updates.length === 0) {
      return Response.json({ error: 'nothing to save' }, { status: 400 });
    }

    const db = getDb();
    const result = db.transaction(() => {
      const before = readTask(db, id, loc);
      if (!before) return { ok: false, status: 404, error: 'not found' };

      db.prepare(
        `UPDATE prep_tasks
            SET ${updates.join(', ')},
                updated_at = datetime('now')
          WHERE id = ? AND location_id = ?`,
      ).run(...values, id, loc);

      // The row was verified to exist above and the UPDATE can't delete it.
      const after = /** @type {PrepTaskRow} */ (readTask(db, id, loc));
      postAuditEvent({
        entity: 'prep_tasks',
        entity_id: id,
        action: 'update',
        actor_cook_id: cookId,
        actor_source: 'cook_ui',
        shift_date: after.shift_date,
        location_id: loc,
        payload: { before, after },
      });
      return { ok: true, task: after };
    })();

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true, task: result.task });
  } catch (err) {
    console.error('PATCH /api/prep-tasks/:id failed:', err);
    return Response.json({ error: 'Could not save prep task' }, { status: 500 });
  }
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function DELETE(req, ctx) {
  return withIdempotency(req, () => prepTaskDeleteHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function prepTaskDeleteHandler(req, ctx) {
  try {
    const id = await readId(ctx);
    if (!id) return Response.json({ error: 'bad id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const loc = locationFromBodyOrRequest(body, req);
    const cookId = clip(body.cook_id, 64) || clip(url.searchParams.get('cook_id'), 64);
    const db = getDb();

    const result = db.transaction(() => {
      const before = readTask(db, id, loc);
      if (!before) return { ok: false, status: 404, error: 'not found' };

      db.prepare(`DELETE FROM prep_tasks WHERE id = ? AND location_id = ?`).run(id, loc);
      postAuditEvent({
        entity: 'prep_tasks',
        entity_id: id,
        action: 'delete',
        actor_cook_id: cookId,
        actor_source: 'cook_ui',
        shift_date: before.shift_date,
        location_id: loc,
        payload: before,
      });
      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true, id });
  } catch (err) {
    console.error('DELETE /api/prep-tasks/:id failed:', err);
    return Response.json({ error: 'Could not delete prep task' }, { status: 500 });
  }
}
