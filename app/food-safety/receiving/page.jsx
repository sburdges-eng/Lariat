// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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

export const dynamic = 'force-dynamic';

export default function ReceivingPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM receiving_log
         WHERE location_id = ? AND shift_date = ?
         ORDER BY created_at DESC, id DESC`,
    )
    .all(loc, today);

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
