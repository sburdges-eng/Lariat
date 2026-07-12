// @ts-check
// SDS-registry board — every chemical product on site, with add-form.
// Backed by /api/sds. Citation: OSHA 29 CFR 1910.1200 (HazCom — SDS
// must be on hand and accessible to employees on every shift).

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { SDS_CITATION } from '../../../lib/sds';
import SdsBoard from './SdsBoard.jsx';

/**
 * Full sds_registry row shape (SELECT * — every column). hazard_class is
 * stored as free TEXT (the GHS enum is enforced by lib/sds.ts::validateSds
 * on write, not by a DB-level CHECK), so it is typed as a plain nullable
 * string here rather than the narrower GhsHazardClass union.
 * @typedef {{
 *   id: number,
 *   location_id: string,
 *   product_name: string,
 *   manufacturer: string | null,
 *   hazard_class: string | null,
 *   storage_location: string | null,
 *   pdf_path: string | null,
 *   url: string | null,
 *   last_reviewed: string | null,
 *   active: number,
 *   notes: string | null,
 *   created_at: string,
 * }} SdsRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function SdsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const rows = /** @type {SdsRow[]} */ (
    db
      .prepare(
        `SELECT * FROM sds_registry
          WHERE location_id=? AND active=1
          ORDER BY product_name ASC`,
      )
      .all(loc)
  );

  return <SdsBoard rows={rows} locationId={loc} citation={SDS_CITATION} />;
}
