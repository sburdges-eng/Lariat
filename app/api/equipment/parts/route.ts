
import { getDb } from '../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';

const MAX_TEXT = 500;
const MAX_NOTES = 2000;

function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request) {
  const locationId = locationFromRequest(request);
  const { searchParams } = new URL(request.url);
  const equipmentId = searchParams.get('equipment_id');
  const db = getDb();

  try {
    let q = `SELECT * FROM equipment_parts WHERE location_id = ?`;
    const params: (string | number)[] = [locationId];
    if (equipmentId) {
      q += ` AND equipment_id = ?`;
      params.push(equipmentId);
    }
    q += ` ORDER BY equipment_id, part_number`;
    const rows = db.prepare(q).all(...params);
    return Response.json(rows);
  } catch (err) {
    console.error('GET /api/equipment/parts failed:', err);
    return Response.json({ error: 'Failed to load parts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withIdempotency(request, () => partsPostHandler(request));
}

async function partsPostHandler(request: Request) {
  try {
    const body = await request.json();
    const equipment_id = Number(body?.equipment_id);
    const part_number = clip(body?.part_number, MAX_TEXT);
    if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
      return Response.json({ error: 'equipment_id required' }, { status: 400 });
    }
    if (!part_number) {
      return Response.json({ error: 'part_number required' }, { status: 400 });
    }

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO equipment_parts (
        equipment_id, part_number, description, vendor, unit_price,
        qty_on_hand, last_ordered, last_order_ref, notes, location_id
      )
      VALUES (
        @equipment_id, @part_number, @description, @vendor, @unit_price,
        @qty_on_hand, @last_ordered, @last_order_ref, @notes, @location_id
      )
    `).run({
      equipment_id,
      part_number,
      description: clip(body?.description, MAX_TEXT),
      vendor: clip(body?.vendor, MAX_TEXT),
      unit_price: toNum(body?.unit_price),
      qty_on_hand: toNum(body?.qty_on_hand),
      last_ordered: clip(body?.last_ordered, 32),
      last_order_ref: clip(body?.last_order_ref, MAX_TEXT),
      notes: clip(body?.notes, MAX_NOTES),
      location_id: locationFromBody(body),
    });

    return Response.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/equipment/parts failed:', err);
    return Response.json({ error: 'Failed to save part' }, { status: 500 });
  }
}
