// @ts-check
// Receiving-log subpage — one tile per RECEIVING_CATEGORY plus a
// quick-entry form for the cook taking the delivery. Pulls today's
// rows through the DB directly so the first paint is a straight
// server render; the board re-queries `/api/receiving?date=...` after
// each write.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  RECEIVING_CATEGORIES,
  RECEIVING_RULES,
  classifyDeliveries,
} from '../../../lib/receiving';
import ReceivingBoard from './ReceivingBoard.jsx';

/**
 * A receiving_log row from `SELECT *`. lib/db.ts's `ReceivingEntry`
 * interface is a narrower Bundle-F "snapshot" type — it's missing
 * `vendor_sku`, `master_id`, `match_status`, `match_reason`,
 * `sync_source_host`, `sync_source_started_at`, and `sync_source_pk`,
 * several of which the board actually reads (e.g. `vendor_sku`). This
 * typedef mirrors the real CREATE TABLE (+ Phase 3 ALTER TABLE)
 * columns in lib/db.ts one-for-one so it stays honest about what
 * `SELECT *` returns.
 * @typedef {{
 *   id: number,
 *   shift_date: string,
 *   location_id: string,
 *   vendor: string,
 *   invoice_ref: string | null,
 *   category: string,
 *   item: string | null,
 *   vendor_sku: string | null,
 *   master_id: string | null,
 *   match_status: string,
 *   match_reason: string | null,
 *   reading_f: number | null,
 *   required_max_f: number | null,
 *   package_ok: number | null,
 *   expiration_date: string | null,
 *   status: 'accepted' | 'rejected' | 'accepted_with_note',
 *   rejection_reason: string | null,
 *   shellstock_tag_ref: string | null,
 *   cook_id: string | null,
 *   sync_source_host: string | null,
 *   sync_source_started_at: string | null,
 *   sync_source_pk: string | null,
 *   created_at: string,
 *   received_qty: number | null,
 *   received_unit: string | null,
 * }} ReceivingLogRow
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function ReceivingPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = /** @type {ReceivingLogRow[]} */ (
    db
      .prepare(
        `SELECT * FROM receiving_log
         WHERE location_id = ? AND shift_date = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(loc, today)
  );

  const summary = classifyDeliveries(rows, { expectAllCategories: true });

  return (
    <ReceivingBoard
      initialEntries={rows}
      initialSummary={summary}
      categories={[...RECEIVING_CATEGORIES]}
      rules={RECEIVING_RULES}
      locationId={loc}
      date={today}
    />
  );
}
