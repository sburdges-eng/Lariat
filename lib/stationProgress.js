// @ts-nocheck — pre-#250 baseline, shared by v1 and v2 today pages
import { getLineCheckTemplate } from './data';
import { getDb } from './db';

export function stationProgress(station, date, locationId) {
  if (!station.line_check_key) return null;
  const items = getLineCheckTemplate(station.line_check_key);
  if (!items.length) return null;
  const db = getDb();
  const rows = db.prepare(`
    SELECT item, status, MAX(created_at) as ts
    FROM line_check_entries
    WHERE shift_date = ? AND station_id = ? AND location_id = ?
    GROUP BY item
  `).all(date, station.id, locationId);
  const byItem = new Map(rows.map((r) => [r.item, r]));
  let done = 0;
  let flagged = 0;
  for (const item of items) {
    const r = byItem.get(item);
    if (r) {
      done += 1;
      if (r.status === 'fail') flagged += 1;
    }
  }
  const signoff = db.prepare(
    'SELECT cook_id FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
  ).get(date, station.id, locationId);
  return { total: items.length, done, flagged, signedOff: !!signoff };
}
