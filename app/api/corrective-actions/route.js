// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Corrective-action read view — F13 (FDA 2022 §8-405.11).
//
// GET /api/corrective-actions?date=YYYY-MM-DD&location=…&station_id=…
//   → { date, location_id, station_id, entries: CorrectiveActionEntry[] }
//
// Aggregates two existing sources into a single chronological feed:
//   - temp_log rows where corrective_action is non-empty
//   - line_check_entries rows where status='fail' AND note is non-empty
//
// Both sources are pre-existing tables that this route does NOT
// write to — F13 was originally specced as a "wired-to-DB" surface
// for `food_safety/corrective_actions.csv`, but the data already
// lives in the two HACCP write paths (cooling/temp routes write
// temp_log corrections; line_check writers note the fix). The view
// is the missing piece.
//
// No PIN gate: this is an informational read for the cook on shift.
// GET is idempotent by definition; we don't wrap with withIdempotency
// (that wrapper is for writes).

import { getDb, todayISO } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import { mergeCorrectiveActions } from '../../../lib/correctiveActions';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateRaw = url.searchParams.get('date');
    const date = dateRaw && ISO_DATE.test(dateRaw) ? dateRaw : todayISO();
    const station_id = (url.searchParams.get('station_id') || '').trim() || null;
    const location_id = locationFromRequest(req);

    const db = getDb();

    // station_id filter semantics: when present, narrow to line_check
    // rows scoped to that station AND drop the temp_log union (temp_log
    // rows aren't station-bound — surfacing them under a station filter
    // would give a misleading "this station has corrections" answer).
    // When absent, return both sources for the day.
    const tempLogRows = station_id
      ? []
      : db.prepare(`
          SELECT id, shift_date, point_id, corrective_action, cook_id, created_at
            FROM temp_log
           WHERE shift_date = ?
             AND location_id = ?
             AND corrective_action IS NOT NULL
             AND TRIM(corrective_action) != ''
           ORDER BY created_at DESC
        `).all(date, location_id);

    let lineCheckSql = `
      SELECT id, shift_date, station_id, item, note, cook_id, created_at
        FROM line_check_entries
       WHERE shift_date = ?
         AND location_id = ?
         AND status = 'fail'
         AND note IS NOT NULL
         AND TRIM(note) != ''
    `;
    const lineCheckParams = [date, location_id];
    if (station_id) {
      lineCheckSql += ' AND station_id = ?';
      lineCheckParams.push(station_id);
    }
    lineCheckSql += ' ORDER BY created_at DESC';
    const lineCheckRows = db.prepare(lineCheckSql).all(...lineCheckParams);

    const entries = mergeCorrectiveActions(tempLogRows, lineCheckRows);

    return Response.json({ date, location_id, station_id, entries });
  } catch (err) {
    console.error('GET /api/corrective-actions failed:', err);
    return Response.json({ error: 'Failed to load corrective actions' }, { status: 500 });
  }
}
