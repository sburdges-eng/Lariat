
import { getDb } from '../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../lib/location';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const locationId = locationFromRequest(request);
  const db = getDb();

  try {
    const rows = db.prepare(`
      SELECT
        e.*,
        COALESCE((SELECT SUM(cost) FROM equipment_maintenance m WHERE m.equipment_id = e.id), 0) as maintenance_cost
      FROM equipment e
      WHERE e.location_id = ?
      ORDER BY e.category, e.name
    `).all(locationId);

    return Response.json(rows);
  } catch (err) {
    console.error('GET /api/equipment failed:', err);
    return Response.json({ error: 'Failed to load equipment' }, { status: 500 });
  }
}

const MAX_NAME = 200;
const MAX_TEXT = 500;
const MAX_NOTES = 2000;

function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function toMoney(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  return withIdempotency(request, () => equipmentPostHandler(request));
}

async function equipmentPostHandler(request: Request) {
  try {
    const body = await request.json();
    const name = clip(body?.name, MAX_NAME);
    if (!name) return Response.json({ error: 'name required' }, { status: 400 });

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO equipment (
        name, category, make_model, model_number, serial_number,
        purchase_date, warranty_expiration, purchase_cost,
        vendor, vendor_order_ref, manual_path, notes,
        status, location_id
      )
      VALUES (
        @name, @category, @make_model, @model_number, @serial_number,
        @purchase_date, @warranty_expiration, @purchase_cost,
        @vendor, @vendor_order_ref, @manual_path, @notes,
        @status, @location_id
      )
    `).run({
      name,
      category: clip(body?.category, 60) || 'Uncategorized',
      make_model: clip(body?.make_model, MAX_TEXT),
      model_number: clip(body?.model_number, MAX_TEXT),
      serial_number: clip(body?.serial_number, MAX_TEXT),
      purchase_date: clip(body?.purchase_date, 32),
      warranty_expiration: clip(body?.warranty_expiration, 32),
      purchase_cost: toMoney(body?.purchase_cost),
      vendor: clip(body?.vendor, MAX_TEXT),
      vendor_order_ref: clip(body?.vendor_order_ref, MAX_TEXT),
      manual_path: clip(body?.manual_path, MAX_TEXT),
      notes: clip(body?.notes, MAX_NOTES),
      status: clip(body?.status, 32) || 'active',
      location_id: locationFromBody(body),
    });

    return Response.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/equipment failed:', err);
    return Response.json({ error: 'Failed to save equipment' }, { status: 500 });
  }
}
