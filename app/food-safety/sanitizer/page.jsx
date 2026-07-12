// @ts-check
// Sanitizer subpage — latest ppm reading per point, + a strip entry.
//
// The read side shows "is every bucket in spec right now?" by grouping
// today's readings by point_label and keeping only the latest. The
// write side is a form that accepts a strip reading; out-of-range
// readings get a required corrective-action field inline.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { DEFAULT_POINTS } from '../../../lib/sanitizer';
import SanitizerBoard from './SanitizerBoard.jsx';

/** @typedef {import('../../../lib/sanitizer.ts').Chemistry} Chemistry */
/** @typedef {import('../../../lib/sanitizer.ts').SanitizerStatus} SanitizerStatus */

/**
 * Full row shape of `sanitizer_checks` — every column the `SELECT *`
 * below returns. `chemistry`/`status` reuse the lib's own unions since
 * those are DB CHECK-constrained to exactly those values.
 * @typedef {{
 *   id: number,
 *   shift_date: string,
 *   location_id: string,
 *   station_id: string | null,
 *   point_label: string,
 *   chemistry: Chemistry,
 *   concentration_ppm: number,
 *   required_min_ppm: number | null,
 *   required_max_ppm: number | null,
 *   water_temp_f: number | null,
 *   status: SanitizerStatus,
 *   corrective_action: string | null,
 *   cook_id: string | null,
 *   created_at: string,
 * }} SanitizerRow
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   chemistry: Chemistry,
 * }} KnownPoint
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function SanitizerPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = /** @type {SanitizerRow[]} */ (
    db
      .prepare(
        `SELECT * FROM sanitizer_checks WHERE location_id=? AND shift_date=?
        ORDER BY created_at ASC`,
      )
      .all(loc, today)
  );

  const latestByPoint = /** @type {Map<string, SanitizerRow>} */ (new Map());
  for (const r of rows) latestByPoint.set(r.point_label, r);
  const latest = Array.from(latestByPoint.values()).sort(
    (a, b) => (a.point_label < b.point_label ? -1 : 1),
  );

  return (
    <SanitizerBoard
      latest={latest}
      knownPoints={DEFAULT_POINTS}
      locationId={loc}
      date={today}
    />
  );
}
