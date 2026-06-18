// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Breaks subpage — start/end meal & rest breaks, COMPS #39 evaluator.
//
// Two roles: cooks start and end their own breaks here (writes); the
// PIC reviews today's roll-up and any missed-break pay-out liability.
// Waived meal-break entries require a waiver_ref (a doc signed under
// COMPS #39, usually the new-hire packet).

import { getDb, todayISO } from '../../../lib/db';
import { getStaff } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import BreakBoard from './BreakBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function BreaksPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM shift_breaks WHERE location_id=? AND shift_date=? ORDER BY started_at ASC`,
    )
    .all(loc, today);

  const staff = getStaff().filter((s) => s.active !== false);

  return (
    <BreakBoard
      rows={rows}
      staff={staff}
      date={today}
      locationId={loc}
    />
  );
}
