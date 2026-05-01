// Pest-control board — recent service visits / sightings / trap checks,
// plus a strip-form to log a new entry. Backed by /api/pest.
//
// Citation: FDA §6-501.111 — controlling pests, and §6-202.15 (openings
// to outer air sealed) make pest activity itself a finding even if no
// food contact occurs.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import PestBoard from './PestBoard.jsx';

export const dynamic = 'force-dynamic';

export default function PestPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM pest_control_log
        WHERE location_id=?
        ORDER BY created_at DESC
        LIMIT 100`,
    )
    .all(loc);

  return <PestBoard rows={rows} locationId={loc} />;
}
