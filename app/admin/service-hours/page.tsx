import { getDb } from '../../../lib/db';
import ServiceHoursEditor from './ServiceHoursEditor';

export const dynamic = 'force-dynamic';

interface LocationRow {
  id: string;
  name: string;
}

interface ServiceHourRow {
  id: number;
  location_id: string;
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  service_label: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  archived_at: string | null;
}

export default function ServiceHoursAdminPage() {
  const db = getDb();

  const locations = db
    .prepare(`SELECT id, name FROM locations ORDER BY id`)
    .all() as LocationRow[];

  // Preload LIVE rows per location. Client fetches archived rows on demand.
  const rowsByLocation: Record<string, ServiceHourRow[]> = {};
  for (const loc of locations) {
    rowsByLocation[loc.id] = db
      .prepare(
        `SELECT id, location_id, day_of_week, opens_at, closes_at,
                service_label, notes, active, created_at, archived_at
           FROM service_hours
          WHERE location_id = ? AND archived_at IS NULL
          ORDER BY day_of_week, service_label, id`,
      )
      .all(loc.id) as ServiceHourRow[];
  }

  return (
    <div>
      <h1>Service Hours</h1>
      <p className="subtitle">
        Per-location opening hours by day. Archived rows are hidden by default; toggle
        &quot;Show archived&quot; to see retired entries and restore them. Soft-delete only —
        history is never destroyed.
      </p>

      {locations.length === 0 ? (
        <div className="card">
          <p className="meta">No locations found. Seed runs on first boot — restart the server.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {locations.map((loc) => (
            <ServiceHoursEditor
              key={loc.id}
              location={loc}
              initialRows={rowsByLocation[loc.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
