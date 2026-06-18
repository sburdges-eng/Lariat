// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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

export default async function SanitizerPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
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
      latest={latest}
      knownPoints={DEFAULT_POINTS}
      locationId={loc}
      date={today}
    />
  );
}
