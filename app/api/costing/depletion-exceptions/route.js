/**
 * GET /api/costing/depletion-exceptions
 *
 * Returns the operator-triage queue of dishes whose Toast sales lines
 * couldn't be resolved into inventory depletions — typically because
 * `dish_components` is missing rows or a sub-recipe has no yield.
 *
 * Pure read; no mutation. PIN-gated via the /api/costing matcher in
 * middleware.js.
 *
 * Query params:
 *   ?location=<id>         — defaults to DEFAULT_LOCATION_ID ('default')
 *   ?period=<period_label> — optional filter, e.g. '2026-W17'
 *   ?limit=<n>             — optional, capped at 1000 (default 200)
 */

import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { listDepletionExceptions } from '../../../../lib/depletionExceptions';

export const dynamic = 'force-dynamic';

function clampLimit(raw) {
  if (raw == null || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const url = new URL(req.url);
    const period = url.searchParams.get('period');
    const limit = clampLimit(url.searchParams.get('limit'));

    const db = getDb();
    const exceptions = listDepletionExceptions(db, {
      location_id: loc,
      period_label: period && period.trim() ? period.trim() : null,
      limit,
    });

    return Response.json({
      location_id: loc,
      period_label: period || null,
      total: exceptions.length,
      exceptions,
    });
  } catch (err) {
    console.error('GET /api/costing/depletion-exceptions failed:', err);
    return Response.json(
      { error: 'Failed to load depletion exceptions' },
      { status: 500 },
    );
  }
}
