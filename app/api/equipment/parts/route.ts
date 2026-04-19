import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

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
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id') || 'default';
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
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/equipment/parts failed:', err);
    return NextResponse.json({ error: 'Failed to load parts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const equipment_id = Number(body?.equipment_id);
    const part_number = clip(body?.part_number, MAX_TEXT);
    if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 });
    }
    if (!part_number) {
      return NextResponse.json({ error: 'part_number required' }, { status: 400 });
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
      location_id: clip(body?.location_id, 64) || 'default',
    });

    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/equipment/parts failed:', err);
    return NextResponse.json({ error: 'Failed to save part' }, { status: 500 });
  }
}
