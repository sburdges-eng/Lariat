// @ts-check
// FOH dining-room floor plan. Server-rendered: loads the dining_tables
// rows for the current location and today's open (booked, not yet seated)
// reservations so the client can offer "seat a reservation" on each
// open table. The visual + interaction lives in FloorPlan.jsx.
//
// `searchParams.location` follows the standard pattern; default to
// DEFAULT_LOCATION_ID. Tables are ordered by id ASC so consistent
// rendering matches the API GET /api/dining-tables contract.

import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import FloorPlan from './FloorPlan.jsx';

/**
 * dining_tables row shape as selected by this page (see CREATE TABLE in
 * lib/db.ts). Matches the columns read/written by the sibling API routes
 * (app/api/dining-tables/route.js, app/api/dining-tables/[id]/route.js) —
 * same table, same status enum.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   capacity: number,
 *   x: number,
 *   y: number,
 *   w: number,
 *   h: number,
 *   status: 'open' | 'seated' | 'dirty' | 'closed',
 *   notes: string | null,
 *   location_id: string,
 *   created_at: string | null,
 *   updated_at: string | null,
 * }} DiningTableRow
 */

/**
 * reservations row shape for today's still-open (booked) bookings — see
 * CREATE TABLE in lib/db.ts. Matches the columns read/written by the
 * sibling API route (app/api/reservations/[id]/route.js).
 * @typedef {{
 *   id: number,
 *   party_name: string,
 *   party_size: number,
 *   reservation_at: string,
 *   status: string,
 *   table_id: string | null,
 *   phone: string | null,
 *   notes: string | null,
 * }} ReservationRow
 */

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<PageSearchParams> | PageSearchParams }} props */
export default async function FloorPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const db = getDb();

  const tables = /** @type {DiningTableRow[]} */ (
    db
      .prepare(
        `SELECT id, name, capacity, x, y, w, h, status, notes,
              location_id, created_at, updated_at
         FROM dining_tables
        WHERE location_id = ?
        ORDER BY id ASC`,
      )
      .all(loc)
  );

  // Open reservations for today = status='booked', not yet seated.
  // We surface these on each open-table action panel so a host can
  // assign + seat in one click.
  const reservations = /** @type {ReservationRow[]} */ (
    db
      .prepare(
        `SELECT id, party_name, party_size, reservation_at, status, table_id,
              phone, notes
         FROM reservations
        WHERE location_id = ?
          AND status = 'booked'
          AND reservation_at LIKE ?
        ORDER BY reservation_at ASC, id ASC`,
      )
      .all(loc, `${today}%`)
  );

  return (
    <FloorPlan
      tables={tables}
      reservations={reservations}
      locationId={loc}
      today={today}
    />
  );
}
