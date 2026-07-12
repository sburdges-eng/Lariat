// @ts-check
// Cleaning board — today's cleaning-log entries + a strip-form to log
// a completed task. Backed by /api/cleaning (POST insert, GET list).
//
// Citations: FDA §4-602.11 (food-contact frequency), §4-602.13 (non-FCS).

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { CLEANING_CITATION } from '../../../lib/cleaning';
import CleaningBoard from './CleaningBoard.jsx';

/**
 * @typedef {{
 *   id: number,
 *   shift_date: string,
 *   location_id: string,
 *   schedule_id: number | null,
 *   area: string,
 *   task: string,
 *   completed_at: string,
 *   cook_id: string | null,
 *   verified_by_cook_id: string | null,
 *   notes: string | null,
 *   created_at: string,
 * }} CleaningLogRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function CleaningPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = /** @type {CleaningLogRow[]} */ (
    db
      .prepare(
        `SELECT * FROM cleaning_log
        WHERE location_id=? AND shift_date=?
        ORDER BY completed_at DESC`,
      )
      .all(loc, today)
  );

  return (
    <CleaningBoard
      rows={rows}
      locationId={loc}
      date={today}
      citation={CLEANING_CITATION}
    />
  );
}
