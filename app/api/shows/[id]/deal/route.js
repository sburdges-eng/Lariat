// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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

export async function GET(req, { params }) {
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  const row = getDb()
    .prepare(
      `SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
       FROM show_deals WHERE show_id = ? AND location_id = ?`,
    )
    .get(showId, locationId);
  return json({ deal: row ? parseDeal(row) : null });
}

export async function PUT(req, ctx) {
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  return withIdempotency(req, () => dealPutHandler(req, ctx));
}

async function dealPutHandler(req, { params }) {
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
