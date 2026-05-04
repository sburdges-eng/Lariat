import { getDb } from '../../../../lib/db';
import { locationFromBody } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'seated', 'dirty', 'closed'];

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

function parseId(params) {
  const raw = params?.id;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, 32) : null;
}

/**
 * PATCH /api/dining-tables/:id
 *
 * Status update:    { status: 'open'|'seated'|'dirty'|'closed' }
 * Field edits:      name, capacity, x, y, w, h, notes (any subset)
 *
 * 400 if no fields would change. 404 if not at this location.
 */
export async function PATCH(req, ctx) {
  return withIdempotency(req, () => diningTablePatchHandler(req, ctx));
}

async function diningTablePatchHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.status !== undefined && !STATUSES.includes(String(body.status))) {
      return Response.json({ error: 'bad status' }, { status: 400 });
    }
    if (body.capacity !== undefined && body.capacity !== null) {
      const n = Number(body.capacity);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return Response.json({ error: 'capacity must be 1..50' }, { status: 400 });
      }
    }

    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const row = db
        .prepare(
          `SELECT * FROM dining_tables WHERE id = ? AND location_id = ?`,
        )
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };

      const sets = [];
      const args = [];
      let nextStatus = row.status;

      if (body.status !== undefined) {
        const s = String(body.status);
        if (s !== row.status) {
          sets.push('status = ?');
          args.push(s);
          nextStatus = s;
        }
      }
      if (body.name !== undefined) {
        const v = clip(body.name, 100);
        if (v !== null && v !== row.name) {
          sets.push('name = ?');
          args.push(v);
        }
      }
      if (body.capacity !== undefined && body.capacity !== null) {
        const n = Number(body.capacity);
        if (Number.isInteger(n) && n >= 1 && n <= 50 && n !== row.capacity) {
          sets.push('capacity = ?');
          args.push(n);
        }
      }
      if (body.x !== undefined && body.x !== null) {
        const n = Number(body.x);
        if (Number.isFinite(n) && n !== row.x) {
          sets.push('x = ?');
          args.push(n);
        }
      }
      if (body.y !== undefined && body.y !== null) {
        const n = Number(body.y);
        if (Number.isFinite(n) && n !== row.y) {
          sets.push('y = ?');
          args.push(n);
        }
      }
      if (body.w !== undefined && body.w !== null) {
        const n = Number(body.w);
        if (Number.isFinite(n) && n !== row.w) {
          sets.push('w = ?');
          args.push(n);
        }
      }
      if (body.h !== undefined && body.h !== null) {
        const n = Number(body.h);
        if (Number.isFinite(n) && n !== row.h) {
          sets.push('h = ?');
          args.push(n);
        }
      }
      if (body.notes !== undefined) {
        const v = body.notes === null ? null : clip(body.notes, 500);
        if (v !== row.notes) {
          sets.push('notes = ?');
          args.push(v);
        }
      }

      if (sets.length === 0) return { ok: false, status: 400, err: 'no change' };

      sets.push("updated_at = datetime('now')");
      args.push(id, loc);
      db.prepare(
        `UPDATE dining_tables SET ${sets.join(', ')}
          WHERE id = ? AND location_id = ?`,
      ).run(...args);

      postAuditEvent({
        entity: 'dining_tables',
        entity_id: 0,
        action: 'update',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {
          id,
          from_status: row.status,
          to_status: nextStatus,
        },
      });
      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.err }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/dining-tables/[id] failed:', err);
    return Response.json({ error: 'Could not update dining table' }, { status: 500 });
  }
}

export async function DELETE(req, ctx) {
  return withIdempotency(req, () => diningTableDeleteHandler(req, ctx));
}

async function diningTableDeleteHandler(req, { params }) {
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
        .prepare(
          `DELETE FROM dining_tables WHERE id = ? AND location_id = ?`,
        )
        .run(id, loc);
      if (info.changes === 0) return { ok: false };
      postAuditEvent({
        entity: 'dining_tables',
        entity_id: 0,
        action: 'delete',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: { id },
      });
      return { ok: true };
    })();
    if (!result.ok) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/dining-tables/[id] failed:', err);
    return Response.json({ error: 'Could not delete dining table' }, { status: 500 });
  }
}
