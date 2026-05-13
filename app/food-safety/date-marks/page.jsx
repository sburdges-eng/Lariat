// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Date-marks subpage — active batches + expiring scan.
//
// Walk-in-facing board. Reads today's active date marks, then sorts:
// expired first, due-today next, future last. Cooks open this before
// service to clear anything past its 7-day window.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { scanExpiringBatches } from '../../../lib/dateMarks';
import DateMarkBoard from './DateMarkBoard.jsx';

export const dynamic = 'force-dynamic';

export default function DateMarksPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const active = db
    .prepare(
      `SELECT * FROM date_marks WHERE location_id=? AND discarded_at IS NULL
        ORDER BY discard_on ASC, id ASC`,
    )
    .all(loc);
  const scan = scanExpiringBatches(active, today);
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  const recentDiscards = db
    .prepare(
      `SELECT * FROM date_marks WHERE location_id=? AND discarded_at IS NOT NULL
        ORDER BY discarded_at DESC LIMIT 20`,
    )
    .all(loc);

  return (
    <DateMarkBoard
      active={active}
      scan={scanById}
      recent={recentDiscards}
      today={today}
      locationId={loc}
    />
  );
}
