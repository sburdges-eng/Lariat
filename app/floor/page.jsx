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

export const dynamic = 'force-dynamic';

export default function FloorPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const db = getDb();

  const tables = db
    .prepare(
      `SELECT id, name, capacity, x, y, w, h, status, notes,
              location_id, created_at, updated_at
         FROM dining_tables
        WHERE location_id = ?
        ORDER BY id ASC`,
    )
    .all(loc);

  // Open reservations for today = status='booked', not yet seated.
  // We surface these on each open-table action panel so a host can
  // assign + seat in one click.
  const reservations = db
    .prepare(
      `SELECT id, party_name, party_size, reservation_at, status, table_id,
              phone, notes
         FROM reservations
        WHERE location_id = ?
          AND status = 'booked'
          AND reservation_at LIKE ?
        ORDER BY reservation_at ASC, id ASC`,
    )
    .all(loc, `${today}%`);

  return (
    <FloorPlan
      tables={tables}
      reservations={reservations}
      locationId={loc}
      today={today}
    />
  );
}
