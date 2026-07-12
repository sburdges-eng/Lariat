// @ts-check
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

/**
 * Row shape of tphc_entries per the lib/db.ts CREATE TABLE (NOT NULL
 * columns → plain type, nullable columns → | null).
 * @typedef {{
 *   id: number,
 *   shift_date: string,
 *   location_id: string | null,
 *   station_id: string | null,
 *   item: string,
 *   batch_ref: string | null,
 *   started_at: string,
 *   cutoff_at: string,
 *   discarded_at: string | null,
 *   discard_reason: string | null,
 *   cook_id: string | null,
 *   created_at: string | null,
 * }} TphcEntryRow
 */
/**
 * WHERE discarded_at IS NOT NULL guarantees discarded_at/discard_reason
 * are always populated for these rows.
 * @typedef {TphcEntryRow & { discarded_at: string, discard_reason: string }} TphcDiscardedRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function TphcPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const now = new Date().toISOString();

  const db = getDb();
  const active = /** @type {TphcEntryRow[]} */ (
    db
      .prepare(
        `SELECT * FROM tphc_entries WHERE location_id=? AND discarded_at IS NULL
        ORDER BY cutoff_at ASC, id ASC`,
      )
      .all(loc)
  );
  const scan = scanActiveTphc(active, now);
  const scanById = Object.fromEntries(scan.map((s) => [s.id, s]));

  const recent = /** @type {TphcDiscardedRow[]} */ (
    db
      .prepare(
        `SELECT * FROM tphc_entries WHERE location_id=? AND discarded_at IS NOT NULL
        ORDER BY discarded_at DESC LIMIT 20`,
      )
      .all(loc)
  );

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
