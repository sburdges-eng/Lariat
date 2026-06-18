// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// TPHC subpage — active time-as-public-health-control batches (§3-501.19).
//
// Reads active rows (discarded_at IS NULL), runs the scan for
// expired/warning/ok status, passes everything to the client board.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  scanActiveTphc,
  TPHC_DISCARD_REASONS,
  TPHC_KINDS,
} from '../../../lib/tphc';
import TphcBoard from './TphcBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function TphcPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const now = new Date().toISOString();

  const db = getDb();
  const active = db
    .prepare(
      `SELECT * FROM tphc_entries WHERE location_id=? AND discarded_at IS NULL
        ORDER BY cutoff_at ASC, id ASC`,
    )
    .all(loc);
  const scan = scanActiveTphc(active, now);
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  const recent = db
    .prepare(
      `SELECT * FROM tphc_entries WHERE location_id=? AND discarded_at IS NOT NULL
        ORDER BY discarded_at DESC LIMIT 20`,
    )
    .all(loc);

  return (
    <TphcBoard
      active={active}
      scan={scanById}
      recent={recent}
      now={now}
      locationId={loc}
      kinds={TPHC_KINDS}
      discardReasons={TPHC_DISCARD_REASONS}
    />
  );
}
