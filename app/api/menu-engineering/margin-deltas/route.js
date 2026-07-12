// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
/**
 * GET /api/menu-engineering/margin-deltas
 *
 * Lists dishes whose per-serving cost moved by more than `minPct` over
 * the last `days` window. Read-only thin wrapper over `listMarginDeltas`
 * in lib/marginDeltas.ts; that helper owns the math and the clamping.
 *
 * Query params (all optional):
 *   days    — lookback window, default 7, clamps to [1, 90]
 *   minPct  — minimum absolute % change, default 5, clamps to [0, 1000]
 *   limit   — cap on rows, default 50, clamps to [1, 500]
 *   location — aliased from location_id via locationFromRequest
 *
 * Response shape:
 *   {
 *     window_days, min_pct, limit,
 *     count,
 *     rows: MarginDeltaRow[]
 *   }
 *
 * PIN-gated via the /api/menu-engineering/:path* matcher in
 * middleware.js, plus the in-route requirePin() re-check below
 * so curl/replay can't bypass the middleware.
 */

import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { requirePin } from '../../../../lib/pin';
import { listMarginDeltas } from '../../../../lib/marginDeltas';

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
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const loc = locationFromRequest(req);
    const windowDays = asInt(url.searchParams.get('days'), 7, 1, 90);
    const minPctMove = asNum(url.searchParams.get('minPct'), 5, 0, 1000);
    const limit = asInt(url.searchParams.get('limit'), 50, 1, 500);
    const db = getDb();
    const rows = listMarginDeltas(db, {
      location_id: loc,
      windowDays,
      minPctMove,
      limit,
    });
    return Response.json({
      window_days: windowDays,
      min_pct: minPctMove,
      limit,
      count: rows.length,
      rows,
    });
  } catch (err) {
    console.error('GET /api/menu-engineering/margin-deltas failed:', err);
    return Response.json({ error: 'Could not load margin deltas' }, { status: 500 });
  }
}
