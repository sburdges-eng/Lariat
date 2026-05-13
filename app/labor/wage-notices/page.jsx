// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Wage notices board (L7 / C.R.S. §8-4-103).
// Server-renders the latest notice per cook for this location and
// the freshness summary. Client board posts the "Sign new notice"
// form against /api/wage-notices.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  WAGE_NOTICE_REASONS,
  WAGE_NOTICE_PAY_BASES,
  summarizeFreshness,
} from '../../../lib/wageNotices';
import WageNoticesBoard from './WageNoticesBoard.jsx';

export const dynamic = 'force-dynamic';

export default function WageNoticesPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = new Date().toISOString().slice(0, 10);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT w.*
         FROM wage_notices w
         JOIN (
           SELECT cook_id, MAX(signed_on) AS latest
             FROM wage_notices
            WHERE location_id = ?
            GROUP BY cook_id
         ) m ON m.cook_id = w.cook_id AND m.latest = w.signed_on
        WHERE w.location_id = ?
        ORDER BY w.cook_id ASC, w.id DESC`,
    )
    .all(loc, loc);

  // Dedupe to one row per cook (highest id on a same-day tie).
  const byCook = new Map();
  for (const r of rows) {
    const prev = byCook.get(r.cook_id);
    if (!prev || prev.id < r.id) byCook.set(r.cook_id, r);
  }
  const latestPerCook = Array.from(byCook.values());
  const freshness = summarizeFreshness(latestPerCook, today);

  return (
    <WageNoticesBoard
      initialLatestPerCook={latestPerCook}
      initialFreshness={freshness}
      reasons={[...WAGE_NOTICE_REASONS]}
      payBases={[...WAGE_NOTICE_PAY_BASES]}
      locationId={loc}
      today={today}
    />
  );
}
