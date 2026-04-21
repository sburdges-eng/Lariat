import { getStations, getLineCheckTemplate } from '../../../lib/data';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const loc = url.searchParams.get('location')?.trim() || DEFAULT_LOCATION_ID;
  const date = todayISO();

  const db = getDb();
  const stations = getStations();

  const result = stations.map((s) => {
    let prog = null;
    if (s.line_check_key) {
      const items = getLineCheckTemplate(s.line_check_key);
      if (items.length) {
        // Pick the latest row per (item, station, date, location) using
        // MAX(id) as the tie-break — line_check_entries.id is
        // INTEGER PRIMARY KEY AUTOINCREMENT, so MAX(id) is the most recent
        // insert. GROUP BY item with a bare `status` column paired to
        // MAX(created_at) is undefined behavior per SQL spec and returned
        // an arbitrary status on re-logged items.
        const rows = db.prepare(`
          SELECT lce.item, lce.status, lce.created_at AS ts
            FROM line_check_entries lce
           WHERE lce.shift_date = ?
             AND lce.station_id = ?
             AND lce.location_id = ?
             AND lce.id = (
               SELECT MAX(id) FROM line_check_entries
                WHERE item = lce.item
                  AND shift_date = lce.shift_date
                  AND station_id = lce.station_id
                  AND location_id = lce.location_id
             )
        `).all(date, s.id, loc);
        const byItem = new Map(rows.map((r) => [r.item, r]));
        let done = 0, flagged = 0;
        for (const item of items) {
          const r = byItem.get(item);
          if (r) { done++; if (r.status === 'fail') flagged++; }
        }
        const signoff = db.prepare(
          'SELECT cook_id FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
        ).get(date, s.id, loc);
        prog = {
          total: items.length,
          done,
          flagged,
          signedOff: !!signoff,
        };
      }
    }
    return {
      id: s.id,
      name: s.name,
      line: s.line || null,
      prog,
    };
  });

  return Response.json(result);
}
