// @ts-check
// Date-marks subpage — active batches + expiring scan.
//
// Walk-in-facing board. Reads today's active date marks, then sorts:
// expired first, due-today next, future last. Cooks open this before
// service to clear anything past its 7-day window.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { scanExpiringBatches } from '../../../lib/dateMarks';
import DateMarkBoard from './DateMarkBoard.jsx';

/**
 * @typedef {{
 *   id: number,
 *   location_id: string,
 *   item: string,
 *   batch_ref: string | null,
 *   prepared_on: string,
 *   discard_on: string,
 *   discarded_at: string | null,
 *   discarded_by_cook_id: string | null,
 *   discard_reason: string | null,
 *   cook_id: string | null,
 *   created_at: string,
 * }} DateMarkRow
 */
/** @typedef {DateMarkRow & { discarded_at: string, discard_reason: string }} DiscardedMark */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function DateMarksPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const active = /** @type {DateMarkRow[]} */ (
    db
      .prepare(
        `SELECT * FROM date_marks WHERE location_id=? AND discarded_at IS NULL
        ORDER BY discard_on ASC, id ASC`,
      )
      .all(loc)
  );
  const scan = scanExpiringBatches(active, today);
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  // WHERE discarded_at IS NOT NULL guarantees discarded_at/discard_reason
  // are always populated for these rows.
  const recentDiscards = /** @type {DiscardedMark[]} */ (
    db
      .prepare(
        `SELECT * FROM date_marks WHERE location_id=? AND discarded_at IS NOT NULL
        ORDER BY discarded_at DESC LIMIT 20`,
      )
      .all(loc)
  );

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
