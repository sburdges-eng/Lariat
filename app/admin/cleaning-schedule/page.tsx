import { getDb } from '../../../lib/db';
import CleaningScheduleEditor from './CleaningScheduleEditor';

export const dynamic = 'force-dynamic';

interface LocationRow {
  id: string;
  name: string;
}

interface CleaningScheduleRow {
  id: number;
  location_id: string;
  area: string;
  task: string;
  frequency: string;
  last_done: string | null;
  next_due: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  archived_at: string | null;
}

export default function CleaningScheduleAdminPage() {
  const db = getDb();

  const locations = db
    .prepare(`SELECT id, name FROM locations ORDER BY id`)
    .all() as LocationRow[];

  // Preload LIVE rows per location. Client fetches archived rows on demand.
  const rowsByLocation: Record<string, CleaningScheduleRow[]> = {};
  for (const loc of locations) {
    rowsByLocation[loc.id] = db
      .prepare(
        `SELECT id, location_id, area, task, frequency, last_done, next_due,
                notes, active, created_at, archived_at
           FROM cleaning_schedule
          WHERE location_id = ? AND archived_at IS NULL
          ORDER BY area, task, id`,
      )
      .all(loc.id) as CleaningScheduleRow[];
  }

  return (
    <div>
      <h1>Cleaning Schedule</h1>
      <p className="subtitle">
        Per-location cleaning tasks with frequency and due dates. Archived rows are hidden
        by default; toggle &quot;Show archived&quot; to see retired entries and restore them.
        Soft-delete only — history is never destroyed.
      </p>

      {locations.length === 0 ? (
        <div className="card">
          <p className="meta">No locations found. Seed runs on first boot — restart the server.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {locations.map((loc) => (
            <CleaningScheduleEditor
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
