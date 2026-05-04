import { getDb, todayISO } from '../../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';
import { clip } from '../../../../lib/clip';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const open = url.searchParams.get('open');
    const loc = locationFromRequest(req);
    const db = getDb();
    const where = open === '1' ? 'AND closed_at IS NULL' : '';
    const rows = db
      .prepare(
        `SELECT c.id, c.count_date, c.label, c.opened_at, c.closed_at, c.cook_id,
                (SELECT COUNT(*) FROM inventory_count_lines l WHERE l.count_id = c.id) AS line_count
           FROM inventory_counts c
          WHERE c.location_id = ? ${where}
          ORDER BY c.opened_at DESC
          LIMIT 50`,
      )
      .all(loc);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/inventory/counts failed:', err);
    return Response.json({ error: 'Could not load counts' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => inventoryCountsPostHandler(req));
}

async function inventoryCountsPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const label = clip(body.label, 100);
    const cookId = clip(body.cook_id, 64);
    const countDate = clip(body.count_date, 32) || todayISO();
    const db = getDb();

    const newId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO inventory_counts (count_date, label, cook_id, location_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run(countDate, label, cookId, loc);
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'inventory_counts', entity_id: id, action: 'insert',
        actor_cook_id: cookId, actor_source: 'api',
        location_id: loc,
        payload: { count_date: countDate, label },
      });
      return id;
    })();

    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/inventory/counts failed:', err);
    return Response.json({ error: 'Could not start count' }, { status: 500 });
  }
}
