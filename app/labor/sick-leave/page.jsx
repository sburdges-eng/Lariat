// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
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

/**
 * `SELECT *` from `paid_sick_leave_balances` — every column, so the
 * full table-row interface applies as-is.
 * @typedef {import('../../../lib/db.ts').PaidSickLeaveBalance} PaidSickLeaveBalanceRow
 */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function SickLeavePage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const year = new Date().getFullYear();

  const db = getDb();
  const rows = /** @type {PaidSickLeaveBalanceRow[]} */ (
    db
      .prepare(
        `SELECT * FROM paid_sick_leave_balances
           WHERE location_id = ? AND accrual_year = ?
           ORDER BY cook_id ASC`,
      )
      .all(loc, year)
  );

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
