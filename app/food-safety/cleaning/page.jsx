// Cleaning board — today's cleaning-log entries + a strip-form to log
// a completed task. Backed by /api/cleaning (POST insert, GET list).
//
// Citations: FDA §4-602.11 (food-contact frequency), §4-602.13 (non-FCS).

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { CLEANING_CITATION } from '../../../lib/cleaning';
import CleaningBoard from './CleaningBoard.jsx';

export const dynamic = 'force-dynamic';

export default function CleaningPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM cleaning_log
        WHERE location_id=? AND shift_date=?
        ORDER BY completed_at DESC`,
    )
    .all(loc, today);

  return (
    <CleaningBoard
      rows={rows}
      locationId={loc}
      date={today}
      citation={CLEANING_CITATION}
    />
  );
}
