import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { validateSds } from '../../../lib/sds';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s: string | unknown, max: number) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validateSds(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const location_id = locationFromBody(body);
    const product_name = clip(body.product_name, 200);
    const manufacturer = clip(body.manufacturer, 200);
    const hazard_class = clip(body.hazard_class, 100);
    const storage_location = clip(body.storage_location, 200);
    const pdf_path = clip(body.pdf_path, 300);
    const url_external = clip(body.url, 300);
    const last_reviewed = clip(body.last_reviewed, 32) || todayISO();
    const cook_id = clip(body.cook_id, 64);
    const active = body.active !== undefined ? (body.active ? 1 : 0) : 1;

    const db = getDb();
    
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO sds_registry
          (location_id, product_name, manufacturer, hazard_class, storage_location, pdf_path, url, last_reviewed, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(location_id, product_name, manufacturer, hazard_class, storage_location, pdf_path, url_external, last_reviewed, active);

      const row = db.prepare('SELECT * FROM sds_registry WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'sds_registry',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        location_id,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/sds failed:', err);
    return Response.json({ error: 'Failed to save SDS entry' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const location_id = locationFromRequest(req as any) || DEFAULT_LOCATION_ID;

    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM sds_registry
       WHERE location_id=? AND active=1
       ORDER BY product_name ASC
    `).all(location_id);

    return Response.json({ location_id, rows });
  } catch (err) {
    console.error('GET /api/sds failed:', err);
    return Response.json({ error: 'Failed to load SDS registry' }, { status: 500 });
  }
}
