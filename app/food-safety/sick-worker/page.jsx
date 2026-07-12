// @ts-check
// Sick-worker subpage — PIC authority only.
//
// Cooks can't file reports about co-workers — only the PIC. The page
// itself isn't PIN-gated (a cook may land here to see who's excluded),
// but the POST/PATCH endpoints are. The form is hidden unless the PIN
// cookie is present.

import { cookies } from 'next/headers';
import { getDb } from '../../../lib/db';
import { getStaff } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { pinCookieValueAuthorized } from '../../../lib/pin';
import SickWorkerBoard from './SickWorkerBoard.jsx';

/**
 * Columns selected for the "currently active" query — a deliberate
 * subset of `sick_worker_reports` (not `SELECT *`).
 * @typedef {Pick<
 *   import('../../../lib/db.ts').SickWorkerReport,
 *   'id' | 'shift_date' | 'cook_id' | 'action' | 'symptoms' | 'diagnosed_illness' | 'started_at' | 'return_at'
 * >} ActiveSickRow
 */

/**
 * `SELECT *` from `sick_worker_reports` — every column, so the full
 * table-row interface applies as-is.
 * @typedef {import('../../../lib/db.ts').SickWorkerReport} SickWorkerRow
 */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function SickWorkerPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  // Authorize via the DB-checked path (audit P0-1): this page renders
  // PHI server-side, so a disabled manager's cookie must not outlive the
  // disable. (Historical: the pre-2026-05-08 raw `=== '1'` compare was
  // always false with LARIAT_PIN_SECRET set, hiding the PIC history
  // block + form from authenticated managers. POST gates are separate.)
  //
  // `cookies()` is async (Next 15+) and returns a Promise, not the
  // cookie jar itself — it must be awaited before `.get()` is called.
  // Bug found during the GH #250 checkjs migration: this was missing
  // `await`, so `jar` was a bare Promise with no `.get` method. In
  // production that throws (`jar.get is not a function`, 500s the
  // page); under Next's dev-mode back-compat shim it silently
  // returned `undefined`, so `pinOk` was always false and the PIC
  // filing/clearing form + "Recently cleared" history were hidden from
  // every authenticated manager, undetected because this page has zero
  // test coverage.
  const jar = await cookies();
  const pinOk = await pinCookieValueAuthorized(jar.get('lariat_pin_ok')?.value);

  const db = getDb();
  const active = /** @type {ActiveSickRow[]} */ (
    db
      .prepare(
        `SELECT id, shift_date, cook_id, action, symptoms, diagnosed_illness, started_at, return_at
         FROM sick_worker_reports
        WHERE location_id=? AND return_at IS NULL
        ORDER BY started_at DESC`,
      )
      .all(loc)
  );

  const history = pinOk
    ? /** @type {SickWorkerRow[]} */ (
        db
          .prepare(
            `SELECT * FROM sick_worker_reports WHERE location_id=? AND return_at IS NOT NULL
            ORDER BY return_at DESC LIMIT 30`,
          )
          .all(loc)
      )
    : [];

  // Staff list for the form — sourced from the file-backed staff
  // roster in data/, not a SQLite table.
  const staff = getStaff().filter((s) => s.active !== false);

  return (
    <SickWorkerBoard
      active={active}
      history={history}
      staff={staff}
      pinOk={pinOk}
      locationId={loc}
    />
  );
}
