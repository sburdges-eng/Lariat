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

export const dynamic = 'force-dynamic';

export default function ReservationsPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const view = searchParams?.view === 'upcoming' ? 'upcoming' : 'today';
  const date = todayISO();
  const db = getDb();

  let rows;
  if (view === 'upcoming') {
    rows = db
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
      .all(loc, date);
  } else {
    rows = db
      .prepare(
        `SELECT id, party_name, party_size, reservation_at, status, table_id,
                phone, email, notes, source, source_ref,
                seated_at, completed_at, cook_id, created_at, updated_at
           FROM reservations
          WHERE location_id = ?
            AND reservation_at LIKE ?
          ORDER BY reservation_at ASC, id ASC`,
      )
      .all(loc, `${date}%`);
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
