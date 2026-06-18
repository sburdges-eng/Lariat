// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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

export const dynamic = 'force-dynamic';

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
  const rows = db
    .prepare(
      `SELECT * FROM thermometer_calibrations
         WHERE location_id = ?
         ORDER BY calibrated_at DESC, id DESC`,
    )
    .all(loc);

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
