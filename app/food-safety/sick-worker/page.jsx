// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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
import { pinCookieValueAuthorized } from '../../../lib/pin';
import SickWorkerBoard from './SickWorkerBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function SickWorkerPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  // Authorize via the DB-checked path (audit P0-1): this page renders
  // PHI server-side, so a disabled manager's cookie must not outlive the
  // disable. (Historical: the pre-2026-05-08 raw `=== '1'` compare was
  // always false with LARIAT_PIN_SECRET set, hiding the PIC history
  // block + form from authenticated managers. POST gates are separate.)
  const jar = cookies();
  const pinOk = await pinCookieValueAuthorized(jar.get('lariat_pin_ok')?.value);

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
