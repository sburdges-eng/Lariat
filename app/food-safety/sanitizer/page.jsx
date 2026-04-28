// Sanitizer subpage — latest ppm reading per point, + a strip entry.
//
// The read side shows "is every bucket in spec right now?" by grouping
// today's readings by point_label and keeping only the latest. The
// write side is a form that accepts a strip reading; out-of-range
// readings get a required corrective-action field inline.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { DEFAULT_POINTS } from '../../../lib/sanitizer';
import SanitizerBoard from './SanitizerBoard.jsx';

export const dynamic = 'force-dynamic';

export default function SanitizerPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM sanitizer_checks WHERE location_id=? AND shift_date=?
        ORDER BY created_at ASC`,
    )
    .all(loc, today);

  const latestByPoint = new Map();
  for (const r of rows) latestByPoint.set(r.point_label, r);
  const latest = Array.from(latestByPoint.values()).sort(
    (a, b) => (a.point_label < b.point_label ? -1 : 1),
  );

  return (
    <SanitizerBoard
      rows={rows}
      latest={latest}
      knownPoints={DEFAULT_POINTS}
      locationId={loc}
      date={today}
    />
  );
}
