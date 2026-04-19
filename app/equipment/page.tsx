import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import EquipmentBoard from './EquipmentBoard';
import type { Equipment, EquipmentPart, EquipmentMaintenanceSchedule } from '../../lib/db';

export const dynamic = 'force-dynamic';

export default function EquipmentPage({ searchParams }: { searchParams?: { location?: string } }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  let equipment: (Equipment & { maintenance_cost: number })[] = [];
  let parts: EquipmentPart[] = [];
  let schedule: EquipmentMaintenanceSchedule[] = [];
  try {
    equipment = db.prepare(`
      SELECT e.*, COALESCE((SELECT SUM(cost) FROM equipment_maintenance m WHERE m.equipment_id = e.id), 0) as maintenance_cost
      FROM equipment e
      WHERE e.location_id = ?
      ORDER BY e.category, e.name
    `).all(loc) as (Equipment & { maintenance_cost: number })[];

    parts = db.prepare(`
      SELECT * FROM equipment_parts WHERE location_id = ?
      ORDER BY equipment_id, part_number
    `).all(loc) as EquipmentPart[];

    schedule = db.prepare(`
      SELECT * FROM equipment_maintenance_schedule WHERE location_id = ?
      ORDER BY equipment_id, COALESCE(next_due, '9999-12-31')
    `).all(loc) as EquipmentMaintenanceSchedule[];
  } catch (err) {
    console.error("Failed to load equipment:", err);
  }

  return <EquipmentBoard equipment={equipment} parts={parts} schedule={schedule} locationId={loc} />;
}
