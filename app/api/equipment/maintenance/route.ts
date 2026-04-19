import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id') || 'default';
  const equipmentId = searchParams.get('equipment_id');
  const db = getDb();

  try {
    let q = `SELECT * FROM equipment_maintenance WHERE location_id = ?`;
    const params: any[] = [locationId];
    if (equipmentId) {
      q += ` AND equipment_id = ?`;
      params.push(equipmentId);
    }
    q += ` ORDER BY service_date DESC, id DESC`;

    const rows = db.prepare(q).all(...params);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/equipment/maintenance failed:', err);
    return NextResponse.json({ error: 'Failed to load maintenance' }, { status: 500 });
  }
}

const MAX_NOTE = 1000;
const MAX_REF = 500;

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
  try {
    const body = await request.json();
    const equipment_id = Number(body?.equipment_id);
    const service_date = clip(body?.service_date, 32);
    if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 });
    }
    if (!service_date) {
      return NextResponse.json({ error: 'service_date required' }, { status: 400 });
    }

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO equipment_maintenance (equipment_id, service_date, type, cost, notes, receipt_reference, cook_id, location_id)
      VALUES (@equipment_id, @service_date, @type, @cost, @notes, @receipt_reference, @cook_id, @location_id)
    `).run({
      equipment_id,
      service_date,
      type: clip(body?.type, 32) || 'Routine',
      cost: toMoney(body?.cost),
      notes: clip(body?.notes, MAX_NOTE),
      receipt_reference: clip(body?.receipt_reference, MAX_REF),
      cook_id: clip(body?.cook_id, 64),
      location_id: clip(body?.location_id, 64) || 'default',
    });

    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/equipment/maintenance failed:', err);
    return NextResponse.json({ error: 'Failed to save maintenance' }, { status: 500 });
  }
}
