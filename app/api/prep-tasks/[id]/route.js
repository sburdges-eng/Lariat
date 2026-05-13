// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { locationFromBody } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';
import { clip } from '../../../../lib/clip';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['todo', 'in_progress', 'done', 'skipped']);

function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// 0 normal, 1 high, 2 rush. Anything else collapses to normal.
// Matches the helper in app/api/prep-tasks/route.js — kept as a local
// duplicate to follow the same per-route helper convention used by
// `clip` across the codebase, instead of carving out a shared module
// for a four-line normalizer.
function asPriority(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n === 1 || n === 2 ? n : 0;
}

/**
 * PATCH transitions:
 *   - { claim: true, cook_id }            → assigns + sets in_progress + started_at if not yet
 *   - { release: true }                   → clears assignee, status back to todo, started_at preserved
 *   - { status: 'done', cook_id }         → done + done_at + done_by
 *   - { status: 'skipped', cook_id }      → skipped + done_at (closes the row)
 *   - { status: 'in_progress', cook_id }  → manual start
 *   - { status: 'todo' }                  → manual reset (clears done/started)
 *   - { task, qty, notes, priority, station_id }
 *                                         → field edits, allowed in ANY state
 *                                           (kitchen managers fix typos and line
 *                                           cooks add post-prep notes regardless
 *                                           of where the row is in its lifecycle).
 *                                           Field edits compose with transitions
 *                                           in the same PATCH.
 */
export async function PATCH(req, ctx) {
  return withIdempotency(req, () => prepTaskPatchHandler(req, ctx));
}

async function prepTaskPatchHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const row = db
        .prepare(`SELECT * FROM prep_tasks WHERE id = ? AND location_id = ?`)
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };

      // Resolve a target status from the action verbs OR explicit status.
      let nextStatus = row.status;
      let updateAssignee = false;
      let nextAssignee = row.assigned_cook_id;
      let setStartedAt = false;
      let setDoneAt = false;
      let clearStarted = false;
      let clearDone = false;

      if (body.claim === true) {
        nextStatus = 'in_progress';
        updateAssignee = true;
        nextAssignee = cookId;
        if (!row.started_at) setStartedAt = true;
      } else if (body.release === true) {
        nextStatus = 'todo';
        updateAssignee = true;
        nextAssignee = null;
      } else if (typeof body.status === 'string') {
        if (!STATUSES.has(body.status)) {
          return { ok: false, status: 400, err: 'bad status' };
        }
        nextStatus = body.status;
        if (nextStatus === 'in_progress' && !row.started_at) setStartedAt = true;
        if (nextStatus === 'done' || nextStatus === 'skipped') setDoneAt = true;
        if (nextStatus === 'todo') {
          clearStarted = true;
          clearDone = true;
          updateAssignee = true;
          nextAssignee = null;
        }
      }

      // Field edits compose with transition verbs in the same PATCH and
      // are allowed regardless of current status — line cooks add
      // "subbed scallions" notes after the fact and managers fix typos
      // mid-prep.
      const taskEdit =
        body.task !== undefined ? clip(body.task, 300) : undefined;
      const qtyEdit = body.qty !== undefined ? clip(body.qty, 64) : undefined;
      const notesEdit =
        body.notes !== undefined ? clip(body.notes, 1000) : undefined;
      const priorityEdit =
        body.priority !== undefined ? asPriority(body.priority) : undefined;
      const stationEdit =
        body.station_id !== undefined ? clip(body.station_id, 64) : undefined;

      const sets = [];
      const args = [];
      if (nextStatus !== row.status) {
        sets.push('status = ?');
        args.push(nextStatus);
      }
      if (updateAssignee) {
        sets.push('assigned_cook_id = ?');
        args.push(nextAssignee);
      }
      if (setStartedAt) sets.push("started_at = datetime('now')");
      if (clearStarted) sets.push('started_at = NULL');
      if (setDoneAt) {
        sets.push("done_at = datetime('now')");
        sets.push('done_by = ?');
        args.push(cookId || row.assigned_cook_id);
      }
      if (clearDone) {
        sets.push('done_at = NULL');
        sets.push('done_by = NULL');
      }
      if (taskEdit !== undefined && taskEdit !== null && taskEdit !== row.task) {
        sets.push('task = ?');
        args.push(taskEdit);
      }
      if (qtyEdit !== undefined && qtyEdit !== row.qty) {
        sets.push('qty = ?');
        args.push(qtyEdit);
      }
      if (notesEdit !== undefined && notesEdit !== row.notes) {
        sets.push('notes = ?');
        args.push(notesEdit);
      }
      if (priorityEdit !== undefined && priorityEdit !== row.priority) {
        sets.push('priority = ?');
        args.push(priorityEdit);
      }
      if (stationEdit !== undefined && stationEdit !== row.station_id) {
        sets.push('station_id = ?');
        args.push(stationEdit);
      }
      if (sets.length === 0) return { ok: false, status: 400, err: 'no change' };

      sets.push("updated_at = datetime('now')");
      args.push(id);
      db.prepare(`UPDATE prep_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);

      postAuditEvent({
        entity: 'prep_tasks',
        entity_id: id,
        action: 'update',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {
          from_status: row.status,
          to_status: nextStatus,
          claim: body.claim === true || undefined,
          release: body.release === true || undefined,
        },
      });
      return { ok: true };
    })();

    if (!result.ok) return Response.json({ error: result.err }, { status: result.status });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/prep-tasks/[id] failed:', err);
    return Response.json({ error: 'Could not update task' }, { status: 500 });
  }
}

export async function DELETE(req, ctx) {
  return withIdempotency(req, () => prepTaskDeleteHandler(req, ctx));
}

async function prepTaskDeleteHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const url = new URL(req.url);
    const loc =
      url.searchParams.get('location') ||
      url.searchParams.get('location_id') ||
      'default';
    const cookId = clip(url.searchParams.get('cook_id'), 64);
    const db = getDb();
    const result = db.transaction(() => {
      const info = db
        .prepare(`DELETE FROM prep_tasks WHERE id = ? AND location_id = ?`)
        .run(id, loc);
      if (info.changes === 0) return { ok: false };
      postAuditEvent({
        entity: 'prep_tasks',
        entity_id: id,
        action: 'delete',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {},
      });
      return { ok: true };
    })();
    if (!result.ok) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/prep-tasks/[id] failed:', err);
    return Response.json({ error: 'Could not delete task' }, { status: 500 });
  }
}
