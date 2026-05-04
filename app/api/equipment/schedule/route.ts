
import { getDb } from '../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 500;
const MAX_NOTES = 2000;

function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

export async function GET(request: Request) {
  const locationId = locationFromRequest(request);
  const { searchParams } = new URL(request.url);
  const equipmentId = searchParams.get('equipment_id');
  const db = getDb();

  try {
    let q = `SELECT * FROM equipment_maintenance_schedule WHERE location_id = ?`;
    const params: (string | number)[] = [locationId];
    if (equipmentId) {
      q += ` AND equipment_id = ?`;
      params.push(equipmentId);
    }
    q += ` ORDER BY equipment_id, COALESCE(next_due, '9999-12-31')`;
    const rows = db.prepare(q).all(...params);
    return Response.json(rows);
  } catch (err) {
    console.error('GET /api/equipment/schedule failed:', err);
    return Response.json({ error: 'Failed to load schedule' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withIdempotency(request, () => schedulePostHandler(request));
}

async function schedulePostHandler(request: Request) {
  try {
    const body = await request.json();
    const equipment_id = Number(body?.equipment_id);
    const task = clip(body?.task, MAX_TEXT);
    const frequency = clip(body?.frequency, 60);
    if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
      return Response.json({ error: 'equipment_id required' }, { status: 400 });
    }
    if (!task) return Response.json({ error: 'task required' }, { status: 400 });
    if (!frequency) return Response.json({ error: 'frequency required' }, { status: 400 });

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO equipment_maintenance_schedule (
        equipment_id, task, frequency, last_done, next_due, notes, location_id
      )
      VALUES (
        @equipment_id, @task, @frequency, @last_done, @next_due, @notes, @location_id
      )
    `).run({
      equipment_id,
      task,
      frequency,
      last_done: clip(body?.last_done, 32),
      next_due: clip(body?.next_due, 32),
      notes: clip(body?.notes, MAX_NOTES),
      location_id: locationFromBody(body),
    });

    return Response.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/equipment/schedule failed:', err);
    return Response.json({ error: 'Failed to save schedule entry' }, { status: 500 });
  }
}
