// @ts-check
// FOH reservations book. Server-rendered list of today's (or upcoming)
// reservations from the reservations table; the client board handles
// add/seat/complete/cancel/no_show/delete.
//
// Two views:
//   - today    → rows where reservation_at LIKE '<today>%'
//   - upcoming → rows where reservation_at >= today and status not in
//                ('cancelled','completed','no_show')
//
// `searchParams.location` follows the standard pattern; default to
// DEFAULT_LOCATION_ID. /reservations is NOT in middleware's gated set
// (it's a regular line-of-service tool, not a financial / sensitive page).

import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import ReservationsBoard from './ReservationsBoard.jsx';

/**
 * Full row shape read from `reservations` (see CREATE TABLE in lib/db.ts).
 * Matches the column list selected by both queries below and by the
 * sibling API routes (app/api/reservations/route.js GET,
 * app/api/reservations/[id]/route.js PATCH's `SELECT *`).
 * @typedef {{
 *   id: number,
 *   party_name: string,
 *   party_size: number,
 *   reservation_at: string,
 *   status: 'booked' | 'seated' | 'completed' | 'cancelled' | 'no_show',
 *   table_id: string | null,
 *   phone: string | null,
 *   email: string | null,
 *   notes: string | null,
 *   source: string | null,
 *   source_ref: string | null,
 *   seated_at: string | null,
 *   completed_at: string | null,
 *   cook_id: string | null,
 *   created_at: string | null,
 *   updated_at: string | null,
 * }} ReservationRow
 */

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<PageSearchParams> | PageSearchParams }} props */
export default async function ReservationsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const view = sp?.view === 'upcoming' ? 'upcoming' : 'today';
  const date = todayISO();
  const db = getDb();

  /** @type {ReservationRow[]} */
  let rows;
  if (view === 'upcoming') {
    rows = /** @type {ReservationRow[]} */ (
      db
        .prepare(
          `SELECT id, party_name, party_size, reservation_at, status, table_id,
                phone, email, notes, source, source_ref,
                seated_at, completed_at, cook_id, created_at, updated_at
           FROM reservations
          WHERE location_id = ?
            AND reservation_at >= ?
            AND status NOT IN ('cancelled','completed','no_show')
          ORDER BY reservation_at ASC, id ASC
          LIMIT 100`,
        )
        .all(loc, date)
    );
  } else {
    rows = /** @type {ReservationRow[]} */ (
      db
        .prepare(
          `SELECT id, party_name, party_size, reservation_at, status, table_id,
                phone, email, notes, source, source_ref,
                seated_at, completed_at, cook_id, created_at, updated_at
           FROM reservations
          WHERE location_id = ?
            AND reservation_at LIKE ?
          ORDER BY reservation_at ASC, id ASC`,
        )
        .all(loc, `${date}%`)
    );
  }

  return (
    <ReservationsBoard
      rows={rows}
      date={date}
      view={view}
      locationId={loc}
    />
  );
}
