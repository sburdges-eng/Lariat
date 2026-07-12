// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
// PIN-gated deal upsert / read for a single show. Settlement page is
// the primary caller; backfill scripts can use the same surface with
// a valid PIN cookie.

import { hasPinCookie } from '../../../../../lib/pin';
import { locationFromRequest } from '../../../../../lib/location';
import { upsertDeal, getSettlement } from '../../../../../lib/settlementRepo';
import { getDb } from '../../../../../lib/db';
import { parseDeal } from '../../../../../lib/dealPoints';
import { json } from '../../../../../lib/routeHelpers';
import { withIdempotency } from '../../../../../lib/idempotency';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/**
 * Runtime-validates an untrusted `body.deal`. Typed as the target
 * DealPoint shape — every field is guarded at runtime below before use.
 * @param {import('../../../../../lib/dealPoints').DealPoint | null | undefined} d
 * @returns {string | null}
 */
function validateDeal(d) {
  if (!d || typeof d !== 'object') return 'deal: must be an object';
  if (!Number.isInteger(d.guaranteeCents) || d.guaranteeCents < 0)
    return 'guaranteeCents: non-negative integer required';
  if (!Number.isInteger(d.buyoutCents) || d.buyoutCents < 0)
    return 'buyoutCents: non-negative integer required';
  if (
    d.vsPctAfterCosts !== null &&
    (typeof d.vsPctAfterCosts !== 'number' ||
      d.vsPctAfterCosts < 0 ||
      d.vsPctAfterCosts > 1)
  )
    return 'vsPctAfterCosts: null or 0-1';
  if (!Array.isArray(d.costsOffTop)) return 'costsOffTop: must be array';
  for (const [i, c] of d.costsOffTop.entries()) {
    if (!c || typeof c.label !== 'string')
      return `costsOffTop[${i}].label: string required`;
    if (!Number.isInteger(c.cents) || c.cents < 0)
      return `costsOffTop[${i}].cents: non-negative integer required`;
  }
  return null;
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  // Row shape mirrors show_deals in lib/db.ts: only vs_pct_after_costs
  // is nullable; the selected columns match ShowDealRow exactly.
  const row = /** @type {import('../../../../../lib/dealPoints').ShowDealRow | undefined} */ (getDb()
    .prepare(
      `SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
       FROM show_deals WHERE show_id = ? AND location_id = ?`,
    )
    .get(showId, locationId));
  return json({ deal: row ? parseDeal(row) : null });
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function PUT(req, ctx) {
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  return withIdempotency(req, () => dealPutHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function dealPutHandler(req, { params }) {

  params = await params;
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return json({ error: 'bad show id' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, { status: 400 });
  }
  const dealError = validateDeal(body?.deal);
  if (dealError) return json({ error: dealError }, { status: 422 });
  const cookId =
    typeof body.cookId === 'string' && body.cookId.length > 0
      ? body.cookId
      : 'unknown';

  const locationId = locationFromRequest(req);
  upsertDeal(showId, body.deal, cookId, locationId);
  const summary = getSettlement(showId, locationId);
  return json(summary, { status: 200 });
}
