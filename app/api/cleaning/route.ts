import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { validateCleaningLog } from '../../../lib/cleaning';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s: string | unknown, max: number) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/cleaning ────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validateCleaningLog(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const schedule_id = body.schedule_id ? Number(body.schedule_id) : null;
    const area = clip(body.area, 100) || 'General';
    const task = clip(body.item || body.task, 200) || 'Cleaning';
    const completed_at = clip(body.completed_at, 40) || new Date().toISOString();
    const cook_id = clip(body.cook_id, 64);
    const verified_by_cook_id = clip(body.verified_by_cook_id, 64);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;

    const db = getDb();
    
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO cleaning_log (shift_date, location_id, schedule_id, area, task, completed_at, cook_id, verified_by_cook_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(shift_date, location_id, schedule_id, area, task, completed_at, cook_id, verified_by_cook_id, notes);

      const row = db.prepare('SELECT * FROM cleaning_log WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'cleaning_log',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id || verified_by_cook_id,
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
    console.error('POST /api/cleaning failed:', err);
    return Response.json({ error: 'Failed to save cleaning log' }, { status: 500 });
  }
}

// ── GET /api/cleaning ─────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req as any) || DEFAULT_LOCATION_ID;
    const date = url.searchParams.get('date') || todayISO();

    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM cleaning_log
       WHERE location_id=? AND shift_date=?
       ORDER BY completed_at DESC
    `).all(location_id, date);

    return Response.json({ location_id, date, rows });
  } catch (err) {
    console.error('GET /api/cleaning failed:', err);
    return Response.json({ error: 'Failed to load cleaning log' }, { status: 500 });
  }
}
