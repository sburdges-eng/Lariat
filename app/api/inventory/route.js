// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb, todayISO } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  resolveCookingShrinkage,
  formatDepletionDelta,
  formatShrinkageNote,
} from '../../../lib/inventoryShrinkage';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

/**
 * T8 — Inventory-depletion POST endpoint. Writes to `inventory_updates`.
 *
 * Request body shape:
 *   {
 *     item:        string        // required — the ingredient being moved
 *     qty:         number        // optional — numeric quantity (cooked if source='toast')
 *     unit:        string        // optional — e.g. 'oz', 'lb'
 *     delta:       string        // optional — pre-formatted free-text; used
 *                                //            when the caller is not the POS
 *                                //            (e.g. kitchen walk-in waste log)
 *     direction:   'out' | 'in' | 'waste'   // optional
 *     source:      'toast' | 'manual' | string   // optional, default 'manual'
 *     recipe_id:   string        // required when source='toast' for shrinkage math
 *     ingredient:  string        // required when source='toast'; may equal item
 *                                //            but the BOM lookup uses this field
 *     note:        string        // optional — audit text
 *     shift_date:  'YYYY-MM-DD'  // optional, defaults to today
 *     station_id:  string
 *     cook_id:     string
 *     location_id: string
 *   }
 *
 * When `source === 'toast'` AND `recipe_id` AND `ingredient` AND `qty > 0`:
 *   - Look up `bom_lines.loss_factor` for (recipe_id, ingredient).
 *   - If a valid loss_factor (0 < lf < 1) is found, compute
 *     raw_qty = qty / (1 - lf) and store delta = "-<raw_qty> <unit>" so
 *     inventory depletes at the raw-weight equivalent (T8 spec §).
 *   - Otherwise (NULL / 0 / out-of-range / no bom row), delta falls back
 *     to "-<qty> <unit>" and the note explains why. No regression for
 *     recipes without a seeded loss factor.
 *
 * Non-toast sources preserve the pre-T8 free-text contract: `delta`
 * lands verbatim from the body, no BOM lookup. Kitchen-assistant's
 * existing INSERT path (app/api/kitchen-assistant/route.js:203) is
 * unaffected because it writes directly and doesn't go through this
 * handler.
 */

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

function isToastSource(src) {
  if (typeof src !== 'string') return false;
  return src.trim().toLowerCase() === 'toast';
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const loc = locationFromRequest(req);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, shift_date, station_id, item, delta, direction, note,
                cook_id, created_at, location_id
           FROM inventory_updates
          WHERE shift_date = ? AND location_id = ?
          ORDER BY id DESC`,
      )
      .all(date, loc);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/inventory failed:', err);
    return Response.json({ error: 'Failed to load inventory updates' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => inventoryPostHandler(req));
}

async function inventoryPostHandler(req) {
  try {
    const body = await req.json();
    const item = clip(body.item, 300);
    if (!item) return Response.json({ error: 'item required' }, { status: 400 });
    const loc = locationFromBody(body);
    const db = getDb();

    const source = (clip(body.source, 32) || 'manual').toLowerCase();
    const userNote = clip(body.note, 500);
    const direction = clip(body.direction, 16) || 'out';

    let delta = clip(body.delta, 64);
    let persistedNote = userNote;
    let shrinkageApplied = false;
    let shrinkageReason = null;
    let rawQty = null;

    const qty = typeof body.qty === 'number' ? body.qty : null;
    const unit = clip(body.unit, 32);
    const recipeId = clip(body.recipe_id, 200);
    const ingredient = clip(body.ingredient, 300);

    // T8 gate: source='toast' with enough context to look up shrinkage.
    // Missing context (recipe_id or ingredient) or non-positive qty falls
    // through to the free-text delta branch below.
    if (isToastSource(source) && qty != null && qty > 0 && recipeId && ingredient) {
      const math = resolveCookingShrinkage(db, {
        recipe_id: recipeId,
        ingredient,
        location_id: loc,
        cooked_qty: qty,
        unit,
      });
      delta = formatDepletionDelta(math.raw_qty, unit);
      rawQty = math.raw_qty;
      shrinkageApplied = math.applied;
      shrinkageReason = math.reason;
      const mathNote = formatShrinkageNote(math);
      persistedNote = userNote ? `${mathNote} | ${userNote}` : mathNote;
    } else if (qty != null && qty > 0 && !delta) {
      // Non-toast POST with qty but no pre-formatted delta: render a
      // signed-depletion string so downstream readers see the same shape
      // as the toast path (minus the shrinkage adjustment).
      delta = formatDepletionDelta(qty, unit);
    }

    // ACID: inventory movements affect COGS — transaction + audit trail.
    const result = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO inventory_updates
             (shift_date, station_id, item, delta, direction, note, cook_id, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          clip(body.shift_date, 32) || todayISO(),
          clip(body.station_id, 64),
          item,
          delta,
          direction,
          persistedNote,
          clip(body.cook_id, 64),
          loc,
        );
      const newId = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'inventory_updates', entity_id: newId, action: 'insert',
        actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
        location_id: loc,
        payload: { item, delta, direction, source, shrinkage_applied: shrinkageApplied },
      });
      return newId;
    })();

    return Response.json({
      ok: true,
      id: result,
      source,
      delta,
      shrinkage_applied: shrinkageApplied,
      shrinkage_reason: shrinkageReason,
      raw_qty: rawQty,
    });
  } catch (err) {
    console.error('POST /api/inventory failed:', err);
    return Response.json({ error: 'Failed to save inventory update' }, { status: 500 });
  }
}
