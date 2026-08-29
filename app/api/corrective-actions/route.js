// Corrective-action read view — F13 (FDA 2022 §8-405.11).
//
// GET /api/corrective-actions?date=YYYY-MM-DD&location=…&station_id=…
//   → { date, location_id, station_id, entries: CorrectiveActionEntry[] }
//
// Aggregates every table that stores a corrective action into a single
// chronological feed:
//   - temp_log rows where corrective_action is non-empty
//   - line_check_entries rows where status='fail' AND note is non-empty
//   - cooling_log rows where corrective_action is non-empty
//   - sanitizer_checks rows where corrective_action is non-empty
//   - receiving_log rows where rejection_reason is non-empty
//   - pest_control_log rows where corrective_action is non-empty
//
// All are pre-existing tables that this route does NOT write to. Each is
// a place a route already REFUSED the write until the cook documented
// the fix, so the record exists by construction.
//
// This header used to claim the cooling route wrote its corrections into
// temp_log. It does not — app/api/temp-log/route.js is the only writer of
// that table, and cooling stores its note on cooling_log. Reading only
// two of the six meant a shift that blew a cooling window printed a HACCP
// plan claiming no corrective actions were recorded.
//
// No PIN gate: this is an informational read for the cook on shift.
// GET is idempotent by definition; we don't wrap with withIdempotency
// (that wrapper is for writes).

// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import { mergeCorrectiveActions } from '../../../lib/correctiveActions';
import { serviceDate } from '../../../lib/serviceDate';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateRaw = url.searchParams.get('date');
    const date = dateRaw && ISO_DATE.test(dateRaw) ? dateRaw : serviceDate();
    const station_id = (url.searchParams.get('station_id') || '').trim() || null;
    const location_id = locationFromRequest(req);

    const db = getDb();

    // station_id filter semantics: when present, narrow to line_check
    // rows scoped to that station AND drop the temp_log union (temp_log
    // rows aren't station-bound — surfacing them under a station filter
    // would give a misleading "this station has corrections" answer).
    // When absent, return both sources for the day.
    const tempLogRows = /** @type {import('../../../lib/correctiveActions').TempLogCorrectiveRow[]} */ (station_id
      ? []
      : db.prepare(`
          SELECT id, shift_date, point_id, corrective_action, cook_id, created_at
            FROM temp_log
           WHERE shift_date = ?
             AND location_id = ?
             AND corrective_action IS NOT NULL
             AND TRIM(corrective_action) != ''
           ORDER BY created_at DESC
        `).all(date, location_id));

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
    const lineCheckRows = /** @type {import('../../../lib/correctiveActions').LineCheckCorrectiveRow[]} */ (
      db.prepare(lineCheckSql).all(...lineCheckParams));

    // cooling_log and sanitizer_checks carry station_id, so a station
    // filter narrows them the way it narrows line checks. receiving and
    // pest have no station — a delivery lands at the door and a sighting
    // is a room — so they drop out under a station filter for the same
    // reason temp_log does: surfacing them would answer "this station has
    // corrections" with something that was never station-bound.
    const coolingRows = station_id
      ? db.prepare(`
          SELECT id, shift_date, station_id, item, corrective_action, cook_id,
                 COALESCE(stage2_at, stage1_at, created_at) AS corrected_at
            FROM cooling_log
           WHERE shift_date = ? AND location_id = ? AND station_id = ?
             AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
           ORDER BY corrected_at DESC
        `).all(date, location_id, station_id)
      : db.prepare(`
          SELECT id, shift_date, station_id, item, corrective_action, cook_id,
                 COALESCE(stage2_at, stage1_at, created_at) AS corrected_at
            FROM cooling_log
           WHERE shift_date = ? AND location_id = ?
             AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
           ORDER BY corrected_at DESC
        `).all(date, location_id);

    const sanitizerRows = station_id
      ? db.prepare(`
          SELECT id, shift_date, station_id, point_label, corrective_action, cook_id, created_at
            FROM sanitizer_checks
           WHERE shift_date = ? AND location_id = ? AND station_id = ?
             AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
           ORDER BY created_at DESC
        `).all(date, location_id, station_id)
      : db.prepare(`
          SELECT id, shift_date, station_id, point_label, corrective_action, cook_id, created_at
            FROM sanitizer_checks
           WHERE shift_date = ? AND location_id = ?
             AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
           ORDER BY created_at DESC
        `).all(date, location_id);

    const receivingRows = station_id
      ? []
      : db.prepare(`
          SELECT id, shift_date, vendor, item, category, rejection_reason, cook_id, created_at
            FROM receiving_log
           WHERE shift_date = ? AND location_id = ?
             AND rejection_reason IS NOT NULL AND TRIM(rejection_reason) != ''
           ORDER BY created_at DESC
        `).all(date, location_id);

    const pestRows = station_id
      ? []
      : db.prepare(`
          SELECT id, shift_date, entry_type, pest, corrective_action, cook_id, created_at
            FROM pest_control_log
           WHERE shift_date = ? AND location_id = ?
             AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
           ORDER BY created_at DESC
        `).all(date, location_id);

    const entries = mergeCorrectiveActions(tempLogRows, lineCheckRows, {
      coolingRows: /** @type {import('../../../lib/correctiveActions').CoolingCorrectiveRow[]} */ (coolingRows),
      sanitizerRows: /** @type {import('../../../lib/correctiveActions').SanitizerCorrectiveRow[]} */ (sanitizerRows),
      receivingRows: /** @type {import('../../../lib/correctiveActions').ReceivingCorrectiveRow[]} */ (receivingRows),
      pestRows: /** @type {import('../../../lib/correctiveActions').PestCorrectiveRow[]} */ (pestRows),
    });

    return Response.json({ date, location_id, station_id, entries });
  } catch (err) {
    console.error('GET /api/corrective-actions failed:', err);
    return Response.json({ error: 'Failed to load corrective actions' }, { status: 500 });
  }
}
