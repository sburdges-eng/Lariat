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
import CertBoard from './CertBoard.jsx';

export const dynamic = 'force-dynamic';

export default function CertsPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const jar = cookies();
  const pinOk = jar.get('lariat_pin_ok')?.value === '1';

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
