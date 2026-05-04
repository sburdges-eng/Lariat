import { getDb } from '../../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const category = clip(url.searchParams.get('category'), 64);
    const loc = locationFromRequest(req);
    const db = getDb();
    const where = ['location_id = ?'];
    const args = [loc];
    if (category) {
      where.push('category = ?');
      args.push(category);
    }
    const rows = db
      .prepare(
        `SELECT id, vendor, ingredient, sku, par_qty, par_unit, pack_size, pack_unit,
                category, note, updated_at
           FROM inventory_par
          WHERE ${where.join(' AND ')}
          ORDER BY category, ingredient`,
      )
      .all(...args);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/inventory/par failed:', err);
    return Response.json({ error: 'Could not load par list' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => inventoryParPostHandler(req));
}

async function inventoryParPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const ingredient = clip(body.ingredient, 200);
    if (!ingredient) {
      return Response.json({ error: 'ingredient required' }, { status: 400 });
    }
    const sku = clip(body.sku, 80) ?? '';
    const vendor = clip(body.vendor, 120);
    const par_qty = num(body.par_qty);
    const par_unit = clip(body.par_unit, 32);
    const pack_size = clip(body.pack_size, 64);
    const pack_unit = clip(body.pack_unit, 32);
    const category = clip(body.category, 64);
    const note = clip(body.note, 500);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id FROM inventory_par
            WHERE location_id = ? AND ingredient = ? AND sku = ?`,
        )
        .get(loc, ingredient, sku);
      let id;
      if (existing) {
        id = existing.id;
        db.prepare(
          `UPDATE inventory_par
              SET vendor = ?, par_qty = ?, par_unit = ?,
                  pack_size = ?, pack_unit = ?, category = ?, note = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(vendor, par_qty, par_unit, pack_size, pack_unit, category, note, id);
      } else {
        const info = db
          .prepare(
            `INSERT INTO inventory_par
               (vendor, ingredient, sku, par_qty, par_unit, pack_size, pack_unit,
                category, note, location_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(vendor, ingredient, sku, par_qty, par_unit, pack_size, pack_unit, category, note, loc);
        id = Number(info.lastInsertRowid);
      }
      postAuditEvent({
        entity: 'inventory_par', entity_id: id, action: existing ? 'update' : 'insert',
        actor_cook_id: cookId, actor_source: 'api', location_id: loc,
        payload: { ingredient, sku, vendor, par_qty, par_unit, category },
      });
      return { id, isInsert: !existing };
    })();

    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/inventory/par failed:', err);
    return Response.json({ error: 'Could not save par row' }, { status: 500 });
  }
}

export async function DELETE(req) {
  return withIdempotency(req, () => inventoryParDeleteHandler(req));
}

async function inventoryParDeleteHandler(req) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'bad id' }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body) || locationFromRequest(req);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const row = db
        .prepare(`SELECT id, ingredient, sku FROM inventory_par WHERE id = ? AND location_id = ?`)
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };
      db.prepare(`DELETE FROM inventory_par WHERE id = ?`).run(id);
      postAuditEvent({
        entity: 'inventory_par', entity_id: id, action: 'delete',
        actor_cook_id: cookId, actor_source: 'api', location_id: loc,
        payload: { ingredient: row.ingredient, sku: row.sku },
      });
      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.err }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/inventory/par failed:', err);
    return Response.json({ error: 'Could not delete par row' }, { status: 500 });
  }
}
