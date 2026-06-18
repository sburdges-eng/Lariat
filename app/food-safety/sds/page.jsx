// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// SDS-registry board — every chemical product on site, with add-form.
// Backed by /api/sds. Citation: OSHA 29 CFR 1910.1200 (HazCom — SDS
// must be on hand and accessible to employees on every shift).

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { SDS_CITATION } from '../../../lib/sds';
import SdsBoard from './SdsBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function SdsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
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
