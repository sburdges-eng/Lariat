// Sick-worker subpage — PIC authority only.
//
// Cooks can't file reports about co-workers — only the PIC. The page
// itself isn't PIN-gated (a cook may land here to see who's excluded),
// but the POST/PATCH endpoints are. The form is hidden unless the PIN
// cookie is present.

import { cookies } from 'next/headers';
import { getDb } from '../../../lib/db';
import { getStaff } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import SickWorkerBoard from './SickWorkerBoard.jsx';

export const dynamic = 'force-dynamic';

export default function SickWorkerPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const jar = cookies();
  const pinOk = jar.get('lariat_pin_ok')?.value === '1';

  const db = getDb();
  const active = db
    .prepare(
      `SELECT id, shift_date, cook_id, action, symptoms, diagnosed_illness, started_at, return_at
         FROM sick_worker_reports
        WHERE location_id=? AND return_at IS NULL
        ORDER BY started_at DESC`,
    )
    .all(loc);

  const history = pinOk
    ? db
        .prepare(
          `SELECT * FROM sick_worker_reports WHERE location_id=? AND return_at IS NOT NULL
            ORDER BY return_at DESC LIMIT 30`,
        )
        .all(loc)
    : [];

  // Staff list for the form — sourced from the file-backed staff
  // roster in data/, not a SQLite table.
  const staff = getStaff().filter((s) => s.active !== false);

  return (
    <SickWorkerBoard
      active={active}
      history={history}
      staff={staff}
      pinOk={pinOk}
      locationId={loc}
    />
  );
}
