// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb, todayISO } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { getRecipes } from '../../../lib/data';
import { cascadedFromEightySix } from '../../../lib/subRecipeGraph';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const includeResolved = url.searchParams.get('all') === '1';
    const loc = locationFromRequest(req);
    const db = getDb();
    const q = `
      SELECT * FROM eighty_six
      WHERE shift_date = ? AND location_id = ?
      ${includeResolved ? '' : 'AND resolved_at IS NULL'}
      ORDER BY id DESC
    `;
    const rows = db.prepare(q).all(date, loc);
    const activeItems = rows
      .filter((r) => !r.resolved_at)
      .map((r) => r.item)
      .filter(Boolean);
    const cascaded = cascadedFromEightySix(activeItems, getRecipes());
    return Response.json({ active: rows, cascaded });
  } catch (err) {
    console.error('GET /api/eighty-six failed:', err);
    return Response.json({ error: 'Failed to load 86 board' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => eightySixPostHandler(req));
}

async function eightySixPostHandler(req) {
  try {
    const body = await req.json();
    const item = clip(body.item, 300);
    if (!item) return Response.json({ error: 'item required' }, { status: 400 });
    const loc = locationFromBody(body);
    const db = getDb();
    // ACID: 86 actions affect menu availability + COGS — transaction + audit trail.
    const newId = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO eighty_six (shift_date, station_id, item, kind, reason, quantity, cook_id, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clip(body.shift_date, 32) || todayISO(),
        clip(body.station_id, 64),
        item,
        clip(body.kind, 32) || 'item',
        clip(body.reason, 100),
        clip(body.quantity, 64),
        clip(body.cook_id, 64),
        loc,
      );
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'eighty_six', entity_id: id, action: 'insert',
        actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
        location_id: loc, payload: { item, kind: body.kind, reason: body.reason },
      });
      return id;
    })();
    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/eighty-six failed:', err);
    return Response.json({ error: 'Failed to save 86' }, { status: 500 });
  }
}
