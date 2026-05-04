import { getDb } from '../../../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../../../lib/location';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../lib/idempotency';
import { clip } from '../../../../../lib/clip';

export const dynamic = 'force-dynamic';

function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  const loc = locationFromRequest(req);
  const db = getDb();
  const head = db
    .prepare(
      `SELECT id, count_date, label, opened_at, closed_at, cook_id, location_id
         FROM inventory_counts WHERE id = ? AND location_id = ?`,
    )
    .get(id, loc);
  if (!head) return Response.json({ error: 'not found' }, { status: 404 });
  const lines = db
    .prepare(
      `SELECT id, vendor, ingredient, sku, on_hand_qty, unit, par_qty, par_unit,
              note, counted_by, counted_at
         FROM inventory_count_lines
        WHERE count_id = ?
        ORDER BY ingredient ASC`,
    )
    .all(id);
  return Response.json({ count: head, lines });
}

export async function PATCH(req, ctx) {
  return withIdempotency(req, () => inventoryCountPatchHandler(req, ctx));
}

async function inventoryCountPatchHandler(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const close = body.close === true;
    const reopen = body.reopen === true;
    const db = getDb();

    const result = db.transaction(() => {
      const row = db
        .prepare(`SELECT id, closed_at FROM inventory_counts WHERE id = ? AND location_id = ?`)
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };
      if (close) {
        if (row.closed_at) return { ok: false, status: 409, err: 'already closed' };
        db.prepare(
          `UPDATE inventory_counts SET closed_at = datetime('now') WHERE id = ?`,
        ).run(id);
        postAuditEvent({
          entity: 'inventory_counts', entity_id: id, action: 'update',
          actor_cook_id: cookId, actor_source: 'api', location_id: loc,
          payload: { transition: 'close' },
        });
      } else if (reopen) {
        db.prepare(`UPDATE inventory_counts SET closed_at = NULL WHERE id = ?`).run(id);
        postAuditEvent({
          entity: 'inventory_counts', entity_id: id, action: 'update',
          actor_cook_id: cookId, actor_source: 'api', location_id: loc,
          payload: { transition: 'reopen' },
        });
      } else {
        return { ok: false, status: 400, err: 'no action' };
      }
      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.err }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/inventory/counts/[id] failed:', err);
    return Response.json({ error: 'Could not update count' }, { status: 500 });
  }
}
