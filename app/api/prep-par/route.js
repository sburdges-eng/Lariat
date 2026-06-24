// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

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
    const station_id = clip(url.searchParams.get('station_id'), 64);
    const loc = locationFromRequest(req);
    const db = getDb();
    const where = ['location_id = ?'];
    const args = [loc];
    if (station_id) {
      where.push('station_id = ?');
      args.push(station_id);
    }
    const rows = db
      .prepare(
        `SELECT id, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note, updated_at
           FROM prep_par
          WHERE ${where.join(' AND ')}
          ORDER BY station_id, sort_order, recipe_slug, ingredient`,
      )
      .all(...args);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/prep-par failed:', err);
    return Response.json({ error: 'Could not load prep par list' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => prepParPostHandler(req));
}

async function prepParPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const station_id = clip(body.station_id, 64) ?? '';
    const recipe_slug = clip(body.recipe_slug, 200) ?? '';
    const ingredient = clip(body.ingredient, 200) ?? '';
    if (recipe_slug === '' && ingredient === '') {
      return Response.json({ error: 'recipe_slug or ingredient required' }, { status: 400 });
    }
    const target_qty = num(body.target_qty);
    const unit = clip(body.unit, 32);
    const sort_order = num(body.sort_order) ?? 0;
    const note = clip(body.note, 500);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id FROM prep_par
            WHERE location_id = ? AND station_id = ? AND recipe_slug = ? AND ingredient = ?`,
        )
        .get(loc, station_id, recipe_slug, ingredient);
      let id;
      if (existing) {
        id = existing.id;
        db.prepare(
          `UPDATE prep_par
              SET target_qty = ?, unit = ?, sort_order = ?, note = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(target_qty, unit, sort_order, note, id);
      } else {
        const info = db
          .prepare(
            `INSERT INTO prep_par
               (location_id, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(loc, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note);
        id = Number(info.lastInsertRowid);
      }
      postAuditEvent({
        entity: 'prep_par', entity_id: id, action: existing ? 'update' : 'insert',
        actor_cook_id: cookId, actor_source: 'api', location_id: loc,
        payload: { station_id, recipe_slug, ingredient, target_qty, unit },
      });
      return { id, isInsert: !existing };
    })();

    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/prep-par failed:', err);
    return Response.json({ error: 'Could not save prep par row' }, { status: 500 });
  }
}

export async function DELETE(req) {
  return withIdempotency(req, () => prepParDeleteHandler(req));
}

async function prepParDeleteHandler(req) {
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
        .prepare(`SELECT id, recipe_slug, ingredient FROM prep_par WHERE id = ? AND location_id = ?`)
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };
      db.prepare(`DELETE FROM prep_par WHERE id = ?`).run(id);
      postAuditEvent({
        entity: 'prep_par', entity_id: id, action: 'delete',
        actor_cook_id: cookId, actor_source: 'api', location_id: loc,
        payload: { recipe_slug: row.recipe_slug, ingredient: row.ingredient },
      });
      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.err }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/prep-par failed:', err);
    return Response.json({ error: 'Could not delete prep par row' }, { status: 500 });
  }
}
