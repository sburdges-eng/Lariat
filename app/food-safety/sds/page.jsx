// SDS-registry board — every chemical product on site, with add-form.
// Backed by /api/sds. Citation: OSHA 29 CFR 1910.1200 (HazCom — SDS
// must be on hand and accessible to employees on every shift).

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { SDS_CITATION } from '../../../lib/sds';
import SdsBoard from './SdsBoard.jsx';

export const dynamic = 'force-dynamic';

export default function SdsPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM sds_registry
        WHERE location_id=? AND active=1
        ORDER BY product_name ASC`,
    )
    .all(loc);

  return <SdsBoard rows={rows} locationId={loc} citation={SDS_CITATION} />;
}
