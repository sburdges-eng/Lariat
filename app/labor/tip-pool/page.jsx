// @ts-check
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

/**
 * `SELECT *` from `tip_pool_distributions` — every column, so the full
 * table-row interface applies as-is.
 * @typedef {import('../../../lib/db').TipPoolDistribution} TipPoolRow
 */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
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
  const rows = /** @type {TipPoolRow[]} */ (
    db
      .prepare(
        `SELECT * FROM tip_pool_distributions
           WHERE location_id = ? AND shift_date = ?
           ORDER BY id ASC`,
      )
      .all(loc, date)
  );

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
