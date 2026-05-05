// Labor hub — tile grid for the labor-compliance subpages.
//
// New tiles for Task A/B/C: Sick time (HFWA L2), Tip pool (L4),
// Wage notices (L7). The hub stays minimal — each tile counts current
// records and links to its board.

import Link from 'next/link';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

export const dynamic = 'force-dynamic';

function summarize(loc, year, today) {
  const db = getDb();

  // L2 — sick leave: count cooks with a balance row this year +
  // count those at cap.
  const sickRows = db
    .prepare(
      `SELECT cook_id, hours_accrued, cap_hours
         FROM paid_sick_leave_balances
        WHERE location_id = ? AND accrual_year = ?`,
    )
    .all(loc, year);
  const sickAtCap = sickRows.filter((r) => r.hours_accrued >= (r.cap_hours ?? 48) - 1e-9).length;

  // L4 — tip pool: count today's distributions and sum cents.
  const tipRow = db
    .prepare(
      `SELECT COUNT(*) AS lines, COALESCE(SUM(amount_cents), 0) AS cents
         FROM tip_pool_distributions
        WHERE location_id = ? AND shift_date = ?`,
    )
    .get(loc, today);

  // L7 — wage notices: count distinct cooks with a notice on file +
  // count those whose latest notice is older than 365 days.
  const wageRows = db
    .prepare(
      `SELECT cook_id, MAX(signed_on) AS latest
         FROM wage_notices
        WHERE location_id = ?
        GROUP BY cook_id`,
    )
    .all(loc);
  const cutoff = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  })();
  const wageStale = wageRows.filter((r) => r.latest && r.latest < cutoff).length;

  return {
    sick: { tracked: sickRows.length, atCap: sickAtCap },
    tips: { lines: tipRow.lines, cents: tipRow.cents },
    wage: { cooks: wageRows.length, stale: wageStale },
  };
}

function fmtMoney(cents) {
  if (!Number.isFinite(cents)) return '$0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export default function LaborPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();

  const s = summarize(loc, year, today);
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Labor</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <Link
          href={`/labor/sick-leave${locQ}`}
          className={`block rounded border p-4 ${s.sick.atCap > 0 ? 'border-amber-400 bg-amber-50' : 'border-neutral-200 bg-white'}`}
        >
          <div className="text-sm text-neutral-500">Sick time</div>
          <div className="text-2xl font-bold mt-1">{s.sick.tracked}</div>
          <div className="text-xs text-neutral-600 mt-1">
            cooks tracked this year
            {s.sick.atCap > 0 ? ` · ${s.sick.atCap} at cap` : ''}
          </div>
        </Link>

        <Link
          href={`/labor/tip-pool${locQ}`}
          className="block rounded border p-4 border-neutral-200 bg-white"
        >
          <div className="text-sm text-neutral-500">Tip pool</div>
          <div className="text-2xl font-bold mt-1">{fmtMoney(s.tips.cents)}</div>
          <div className="text-xs text-neutral-600 mt-1">
            {s.tips.lines} {s.tips.lines === 1 ? 'line' : 'lines'} today
          </div>
        </Link>

        <Link
          href={`/labor/wage-notices${locQ}`}
          className={`block rounded border p-4 ${s.wage.stale > 0 ? 'border-red-400 bg-red-50' : 'border-neutral-200 bg-white'}`}
        >
          <div className="text-sm text-neutral-500">Wage notices</div>
          <div className="text-2xl font-bold mt-1">{s.wage.cooks}</div>
          <div className="text-xs text-neutral-600 mt-1">
            cooks on file
            {s.wage.stale > 0 ? ` · ${s.wage.stale} need new` : ''}
          </div>
        </Link>
      </div>
    </div>
  );
}
