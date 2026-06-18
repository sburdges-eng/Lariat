// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Tip pool board (L4 / COMPS #39 §3.3, §3.4).
// Server-renders the day's distributions and pool summary, hands off
// to the client board. Default view is today; URL query takes a
// `?date=YYYY-MM-DD` for back-fill.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  CO_STD_MIN_WAGE_CENTS_2026,
  CO_TIPPED_MIN_WAGE_CENTS_2026,
  CO_TIP_CREDIT_CENTS_2026,
  summarizePool,
} from '../../../lib/tipPool';
import TipPoolBoard from './TipPoolBoard.jsx';

export const dynamic = 'force-dynamic';

export default async function TipPoolPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date =
    typeof sp?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? sp.date
      : todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tip_pool_distributions
         WHERE location_id = ? AND shift_date = ?
         ORDER BY id ASC`,
    )
    .all(loc, date);

  const summary = summarizePool(rows);

  return (
    <TipPoolBoard
      initialRows={rows}
      initialSummary={summary}
      locationId={loc}
      date={date}
      comps={{
        std_min_wage_cents: CO_STD_MIN_WAGE_CENTS_2026,
        tipped_min_wage_cents: CO_TIPPED_MIN_WAGE_CENTS_2026,
        tip_credit_cents: CO_TIP_CREDIT_CENTS_2026,
      }}
    />
  );
}
