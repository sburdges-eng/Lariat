// @ts-check
// Thermometer-calibrations subpage — one tile per known probe plus a
// quick-entry form for ice-point / boiling-point verifications.
//
// Pulls today's calibration rows (and historical rows back far enough
// to surface the last passing cal per probe) through the DB directly
// so the first paint is a straight server render; the board re-queries
// /api/thermometer-calibrations after each write.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  CALIBRATION_METHODS,
  DEFAULT_FREQUENCY_DAYS,
  LARIAT_ELEVATION_FT,
  TOLERANCE_F,
  classifyProbes,
} from '../../../lib/calibrations';
import CalibrationsBoard from './CalibrationsBoard.jsx';

/**
 * Full row shape for `thermometer_calibrations` (see CREATE TABLE in
 * lib/db.ts). `SELECT *` returns every column here, which is wider
 * than the `CalibrationRow` aggregation-input type in lib/calibrations.ts
 * (that type only requires the subset `classifyProbes` reads).
 * @typedef {{
 *   id: number,
 *   location_id: string | null,
 *   thermometer_id: string,
 *   method: 'ice_point' | 'boiling_point' | 'reference_probe',
 *   before_reading_f: number | null,
 *   after_reading_f: number | null,
 *   passed: number,
 *   action_taken: string | null,
 *   cook_id: string | null,
 *   calibrated_at: string,
 *   frequency_days: number | null,
 *   created_at: string | null,
 * }} ThermometerCalibrationRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function CalibrationsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  // Load every calibration row for the location — aggregator needs
  // the last row per probe regardless of shift date. Ordered so the
  // `entries` list in the UI feels freshest-first.
  const rows = /** @type {ThermometerCalibrationRow[]} */ (
    db
      .prepare(
        `SELECT * FROM thermometer_calibrations
           WHERE location_id = ?
           ORDER BY calibrated_at DESC, id DESC`,
      )
      .all(loc)
  );

  const summary = classifyProbes(rows, {
    now: new Date(),
    frequency_days: DEFAULT_FREQUENCY_DAYS,
  });

  return (
    <CalibrationsBoard
      initialEntries={rows}
      initialSummary={summary}
      methods={Object.values(CALIBRATION_METHODS)}
      locationId={loc}
      defaultElevationFt={LARIAT_ELEVATION_FT}
      toleranceF={TOLERANCE_F}
      defaultFrequencyDays={DEFAULT_FREQUENCY_DAYS}
    />
  );
}
