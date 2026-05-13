// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Cooling log subpage — open batches + new batch button.
//
// The core UX is "a cooling stopwatch per batch" — once a cook drops a
// hot batch in the walk-in and opens a row here, the tile counts down
// to the stage-1 deadline (2h to 70°F) and then stage-2 deadline (4h
// more to 41°F). Red means the clock is actually up, not just close.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { scanOpenBatches } from '../../../lib/cooling';
import CoolingBoard from './CoolingBoard.jsx';

export const dynamic = 'force-dynamic';

export default function CoolingPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const open = db
    .prepare(
      `SELECT * FROM cooling_log WHERE location_id=? AND status='in_progress' ORDER BY started_at ASC`,
    )
    .all(loc);
  const scan = scanOpenBatches(open, Date.now());
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  const closed = db
    .prepare(
      `SELECT * FROM cooling_log WHERE location_id=? AND shift_date=? AND status != 'in_progress'
        ORDER BY id DESC LIMIT 30`,
    )
    .all(loc, today);

  return (
    <CoolingBoard
      open={open}
      scan={scanById}
      closed={closed}
      date={today}
      locationId={loc}
    />
  );
}
