// @ts-check
// POST /api/specials/saved/[id]/promote — promote a saved special onto
// the menu-engineering cost surface (roadmap 3.6).
//
// Writes dish_components vendor_item rows from the special's costed
// cost_breakdown plus a specials_promotions record, all in one audited
// transaction (see lib/specialsPromotion.ts for the data-flow rationale).
// Idempotent: re-promoting refreshes the same promotion record.
//
// PIN: the /api/specials/saved/* path is middleware-gated; this route
// repeats the in-route check like its sibling saved-specials mutations
// so a direct curl can't bypass the UI.

import { getDb } from '../../../../../../lib/db';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../../lib/location';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../../../../lib/pin';
import { validateName } from '../../../../../../lib/specialsValidators';
import { promoteSpecialToMenu } from '../../../../../../lib/specialsPromotion';
import { withIdempotency } from '../../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * @param {Request} req
 * @param {{ params: Promise<{ id: string }> | { id: string } }} ctx
 */
export async function POST(req, ctx) {
  // Auth first — don't waste a JSON parse on an unauthenticated body.
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'menu.specials_edit'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  return withIdempotency(req, () => promoteHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {{ params: Promise<{ id: string }> | { id: string } }} ctx
 */
async function promoteHandler(req, { params }) {
  try {
    params = await params;

    // Body is optional — an empty POST promotes under the special's own
    // name at 1 serving.
    /** @type {{ menu_item_name?: unknown, servings?: unknown }} */
    let body = {};
    const raw = await req.text();
    if (raw.trim() !== '') {
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ error: 'invalid JSON body' }, { status: 400, headers: NO_STORE });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json(
          { error: 'request body must be a JSON object' },
          { status: 400, headers: NO_STORE },
        );
      }
    }

    let menuItemName;
    if (body.menu_item_name !== undefined && body.menu_item_name !== null) {
      const r = validateName(body.menu_item_name);
      if (!r.ok) {
        return Response.json(
          { error: r.error.replace(/^name/, 'menu_item_name') },
          { status: 400, headers: NO_STORE },
        );
      }
      menuItemName = r.value;
    }

    let servings;
    if (body.servings !== undefined && body.servings !== null) {
      if (typeof body.servings !== 'number' || !Number.isFinite(body.servings) || body.servings <= 0) {
        return Response.json(
          { error: 'servings must be a positive finite number' },
          { status: 400, headers: NO_STORE },
        );
      }
      servings = body.servings;
    }

    const id = params.id;
    const locationId = locationFromRequest(req);
    const db = getDb();

    const result = promoteSpecialToMenu(
      { specialId: id, locationId, menuItemName, servings },
      db,
    );

    if (!result.ok) {
      if (result.error === 'not_found') {
        return Response.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
      }
      if (result.error === 'archived') {
        return Response.json({ error: 'special is archived' }, { status: 410, headers: NO_STORE });
      }
      return Response.json(
        { error: 'no costed ingredients to promote — run the cost action and match vendor items first' },
        { status: 400, headers: NO_STORE },
      );
    }

    // File-audit line, mirroring the sibling saved-specials mutations.
    // The transactional audit_events row is written inside
    // promoteSpecialToMenu; this is the operator-facing JSONL trail.
    logAuditAction({
      action: 'specials.promote',
      special_id: id,
      menu_item_name: result.promotion.menu_item_name,
      location_id: locationId,
    });

    return Response.json(
      {
        ok: true,
        promotion: {
          special_id: result.promotion.special_id,
          menu_item_name: result.promotion.menu_item_name,
          servings: result.promotion.servings,
          promoted_at: result.promotion.promoted_at,
          updated_at: result.promotion.updated_at,
        },
        components: result.components,
        skipped: result.skipped,
        repromoted: result.repromoted,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (e) {
    console.error('specials promote failed:', e);
    return Response.json({ error: 'internal error' }, { status: 500, headers: NO_STORE });
  }
}
