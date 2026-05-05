// Sick leave board — per-cook balances under HFWA (L2).
// Server-renders the current year's balances for this location and
// hands them to the client board for the manager to log accrual or
// use against.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  HFWA_ANNUAL_CAP_HOURS,
  summarizeBalance,
} from '../../../lib/sickLeave';
import SickLeaveBoard from './SickLeaveBoard.jsx';

export const dynamic = 'force-dynamic';

export default function SickLeavePage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const year = new Date().getFullYear();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM paid_sick_leave_balances
         WHERE location_id = ? AND accrual_year = ?
         ORDER BY cook_id ASC`,
    )
    .all(loc, year);

  const balances = rows.map(summarizeBalance);

  return (
    <SickLeaveBoard
      initialBalances={balances}
      locationId={loc}
      year={year}
      capHours={HFWA_ANNUAL_CAP_HOURS}
    />
  );
}
