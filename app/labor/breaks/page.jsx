// @ts-check
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

/**
 * Full row shape for `shift_breaks` (see CREATE TABLE in lib/db.ts).
 * Matches the local `BreakRow` type in app/api/breaks/route.js — same
 * table, same `SELECT *`.
 * @typedef {{
 *   id: number,
 *   shift_date: string,
 *   location_id: string,
 *   cook_id: string,
 *   kind: 'meal' | 'rest',
 *   started_at: string,
 *   ended_at: string | null,
 *   duration_min: number | null,
 *   waived: number,
 *   waiver_ref: string | null,
 *   note: string | null,
 *   created_at: string | null,
 * }} BreakRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function BreaksPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = /** @type {BreakRow[]} */ (
    db
      .prepare(
        `SELECT * FROM shift_breaks WHERE location_id=? AND shift_date=? ORDER BY started_at ASC`,
      )
      .all(loc, today)
  );

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
