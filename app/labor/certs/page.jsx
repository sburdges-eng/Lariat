// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Cert expiry dashboard — CFPM, food-handler, alcohol-service.
//
// Colorado (6 CCR 1010-2 §2-102) requires a Certified Food Protection
// Manager present; local AHJs (Denver, Boulder, El Paso County) add
// food-handler cards. Alcohol service is TIPS / SafeServ. A lapsed CFPM
// on the day of inspection is a citation, not a warning — so expiry
// inside 30 days turns amber and the day it lapses turns red.

import { cookies } from 'next/headers';
import { getDb, todayISO } from '../../../lib/db';
import { getStaff } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { pinCookieValueAuthorized } from '../../../lib/pin';
import CertBoard from './CertBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function CertsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  // Authorize via the DB-checked path (audit P0-1) so a disabled
  // manager's cookie doesn't outlive the disable. (Historical: the
  // pre-2026-05-08 raw `=== '1'` compare was always false with
  // LARIAT_PIN_SECRET set, hiding the PIC-only renew form from
  // authenticated managers.)
  const jar = await cookies();
  const pinOk = await pinCookieValueAuthorized(jar.get('lariat_pin_ok')?.value);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM staff_certifications WHERE location_id=?
        ORDER BY expires_on IS NULL, expires_on ASC, id ASC`,
    )
    .all(loc);

  const staff = getStaff().filter((s) => s.active !== false);

  return (
    <CertBoard
      rows={rows}
      staff={staff}
      today={today}
      locationId={loc}
      pinOk={pinOk}
    />
  );
}
