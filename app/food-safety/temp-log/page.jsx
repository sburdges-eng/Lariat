// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Temp-log subpage — the full-CCP grid + a quick-entry form.
//
// Every kitchen CCP that's a single-reading check (receiving, cold-hold
// in walk-in + reach-in, freezer, cook min-internal per protein, hot
// hold, reheat) lives here. Two-stage cooling (CCP-8) has its own
// stopwatch-driven page at /food-safety/cooling; we don't duplicate it.
//
// This page is server-rendered: we pull today's readings through the
// DB directly (not an internal fetch) and hand them to the board as
// initialData. The board re-queries `/api/temp-log?date=...&summary=1`
// after each successful write so the tiles refresh without a full nav.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { TempPoints, classifyReadings } from '../../../lib/tempLog';
import TempLogBoard from './TempLogBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function TempLogPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM temp_log
         WHERE location_id = ? AND shift_date = ?
         ORDER BY created_at DESC, id DESC`,
    )
    .all(loc, today);

  const summary = classifyReadings(rows, { expectAllPoints: true });

  return (
    <TempLogBoard
      initialEntries={rows}
      initialSummary={summary}
      points={TempPoints}
      locationId={loc}
      date={today}
    />
  );
}
