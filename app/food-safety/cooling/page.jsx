// @ts-check
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

/** @typedef {import('../../../lib/db').CoolingLogEntry} CoolingRow */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function CoolingPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const open = /** @type {CoolingRow[]} */ (
    db
      .prepare(
        `SELECT * FROM cooling_log WHERE location_id=? AND status='in_progress' ORDER BY started_at ASC`,
      )
      .all(loc)
  );
  const scan = scanOpenBatches(open, Date.now());
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  const closed = /** @type {CoolingRow[]} */ (
    db
      .prepare(
        `SELECT * FROM cooling_log WHERE location_id=? AND shift_date=? AND status != 'in_progress'
          ORDER BY id DESC LIMIT 30`,
      )
      .all(loc, today)
  );

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
