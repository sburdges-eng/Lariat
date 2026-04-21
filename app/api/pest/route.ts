import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { validatePestControl } from '../../../lib/pestControl';
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
    const v = validatePestControl(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const entry_type = clip(body.entry_type, 64);
    const vendor = clip(body.vendor, 100);
    const technician = clip(body.technician, 100);
    const findings = typeof body.findings === 'string' ? body.findings.trim().slice(0, 1000) : null;
    const pest = clip(body.pest, 64);
    const severity = clip(body.severity, 64);
    const corrective_action = typeof body.corrective_action === 'string' ? body.corrective_action.trim().slice(0, 500) : null;
    const report_path = clip(body.report_path, 300);
    const cook_id = clip(body.cook_id, 64);

    const db = getDb();
    
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO pest_control_log
          (shift_date, location_id, entry_type, vendor, technician, findings, pest, severity, corrective_action, report_path, cook_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(shift_date, location_id, entry_type, vendor, technician, findings, pest, severity, corrective_action, report_path, cook_id);

      const row = db.prepare('SELECT * FROM pest_control_log WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'pest_control_log',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/pest failed:', err);
    return Response.json({ error: 'Failed to save pest control log' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const location_id = locationFromRequest(req as any) || DEFAULT_LOCATION_ID;

    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM pest_control_log
       WHERE location_id=?
       ORDER BY created_at DESC LIMIT 100
    `).all(location_id);

    return Response.json({ location_id, rows });
  } catch (err) {
    console.error('GET /api/pest failed:', err);
    return Response.json({ error: 'Failed to load pest control log' }, { status: 500 });
  }
}
