// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
/**
 * GET /api/vendor-prices/shocks
 *
 * Lists vendor SKUs whose unit_price moved by more than `minPct` over the
 * last `days` window. Read-only thin wrapper over `listPriceShocks` in
 * lib/vendorPricesRepo.ts; that helper owns the math and the clamping.
 *
 * Query params (all optional):
 *   days    — lookback window, default 7, clamps to [1, 90]
 *   minPct  — minimum absolute % change, default 5, clamps to [0, 1000]
 *   limit   — cap on rows, default 50, clamps to [1, 500]
 *   category — exact-match filter on vendor_prices_history.category;
 *              the costing pipeline tags Beverage rows with one of
 *              BEVERAGE_CATEGORIES, so passing 'food' here is the wrong
 *              shape. Operators usually want all rows; supply category
 *              only when scoping to one specific cohort.
 *   location — aliased from location_id via locationFromRequest
 *
 * Response shape:
 *   {
 *     window_days, min_pct, limit,
 *     count,
 *     rows: PriceShockRow[]
 *   }
 *
 * No PIN gate — same posture as /api/vendor-prices/history.
 */

import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { listPriceShocks } from '../../../../lib/vendorPricesRepo';

export const dynamic = 'force-dynamic';

// Number(null) === 0 (finite!), Number('') === 0, so we must short-
// circuit on the raw string before coercing — otherwise an absent param
// gets clamped to `min` instead of falling back to `dflt`.
/**
 * @param {string | null} v
 * @param {number} dflt
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function asInt(v, dflt, min, max) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * @param {string | null} v
 * @param {number} dflt
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function asNum(v, dflt, min, max) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const loc = locationFromRequest(req);
    const windowDays = asInt(url.searchParams.get('days'), 7, 1, 90);
    const minPctMove = asNum(url.searchParams.get('minPct'), 5, 0, 1000);
    const limit = asInt(url.searchParams.get('limit'), 50, 1, 500);
    const category = (url.searchParams.get('category') ?? '').trim();
    const db = getDb();
    let rows = listPriceShocks(db, {
      location_id: loc,
      windowDays,
      minPctMove,
      limit,
    });
    if (category) {
      const k = category.toLowerCase();
      rows = rows.filter(
        (r) => (r.category ?? '').toLowerCase() === k,
      );
    }
    return Response.json({
      window_days: windowDays,
      min_pct: minPctMove,
      limit,
      count: rows.length,
      rows,
    });
  } catch (err) {
    console.error('GET /api/vendor-prices/shocks failed:', err);
    return Response.json({ error: 'Could not load price shocks' }, { status: 500 });
  }
}
