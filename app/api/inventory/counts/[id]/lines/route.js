// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../../lib/db';
import { locationFromBody } from '../../../../../../lib/location';
import { postAuditEvent } from '../../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../../lib/idempotency';
import { clip } from '../../../../../../lib/clip';
import { normalizeIngredientKey } from '../../../../../../lib/ingredientKey';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/** @param {{ id?: string } | null | undefined} params */
function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function asNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function POST(req, ctx) {
  return withIdempotency(req, () => inventoryCountLinesPostHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function inventoryCountLinesPostHandler(req, { params }) {

  params = await params;
  const countId = parseId(params);
  if (!countId) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    const rawIngredient = clip(body.ingredient, 300);
    if (!rawIngredient) return Response.json({ error: 'ingredient required' }, { status: 400 });
    // Canonicalize before the upsert so two cooks counting "Chicken
    // Stock" vs "chicken stock" land on the same row instead of
    // splitting the count. normalizeIngredientKey is the JS↔Python
    // parity-tested helper used everywhere else in the codebase
    // (recipes, vendor_prices match, dish_components). Display fidelity
    // (capitalization, punctuation) is a known trade — the cook is
    // matching against an ingredient catalog at count time, not
    // marketing copy.
    const ingredient = normalizeIngredientKey(rawIngredient);
    if (!ingredient) return Response.json({ error: 'ingredient required' }, { status: 400 });
    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    // SQLite UNIQUE treats NULLs as distinct, so a missing sku would
    // bypass the (count_id, ingredient, sku) conflict and split a single
    // ingredient into two rows. The inventory_par table already follows
    // the "empty string, not NULL" convention for the same reason; do
    // the same here.
    const sku = clip(body.sku, 64) ?? '';
    const vendor = clip(body.vendor, 64);
    const onHand = asNum(body.on_hand_qty);
    const unit = clip(body.unit, 32);
    const parQty = asNum(body.par_qty);
    const parUnit = clip(body.par_unit, 32);
    const note = clip(body.note, 500);
    const db = getDb();

    const result = db.transaction(() => {
      const head = /** @type {{ id: number, closed_at: string | null } | undefined} */ (
        db
          .prepare(`SELECT id, closed_at FROM inventory_counts WHERE id = ? AND location_id = ?`)
          .get(countId, loc)
      );
      if (!head) return { ok: false, status: 404, err: 'count not found' };
      if (head.closed_at) return { ok: false, status: 409, err: 'count is closed' };

      // RETURNING gives the real row id even on the ON CONFLICT branch —
      // better-sqlite3's lastInsertRowid advances regardless of whether
      // the conflict suppressed the insert, so it is unreliable here.
      // Cast: this upsert always affects exactly one row (insert or
      // conflict-update), so RETURNING id always yields a row here.
      const row = /** @type {{ id: number }} */ (db
        .prepare(
          `INSERT INTO inventory_count_lines
             (count_id, vendor, ingredient, sku, on_hand_qty, unit, par_qty, par_unit,
              note, counted_by, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(count_id, ingredient, sku) DO UPDATE SET
             vendor = excluded.vendor,
             on_hand_qty = excluded.on_hand_qty,
             unit = excluded.unit,
             par_qty = excluded.par_qty,
             par_unit = excluded.par_unit,
             note = excluded.note,
             counted_by = excluded.counted_by,
             counted_at = datetime('now')
           RETURNING id`,
        )
        .get(countId, vendor, ingredient, sku, onHand, unit, parQty, parUnit,
             note, cookId, loc));
      const lineId = Number(row.id);
      // Audit verb is 'update' because the audit_events CHECK constraint
      // doesn't include 'upsert' — both the insert and conflict-update
      // paths land here.
      postAuditEvent({
        entity: 'inventory_count_lines', entity_id: lineId, action: 'update',
        actor_cook_id: cookId, actor_source: 'api', location_id: loc,
        payload: { count_id: countId, ingredient, sku, on_hand_qty: onHand, unit },
      });
      return { ok: true, id: lineId };
    })();

    if (!result.ok) return Response.json({ error: result.err }, { status: result.status });
    return Response.json({ ok: true, id: result.id });
  } catch (err) {
    console.error('POST /api/inventory/counts/[id]/lines failed:', err);
    return Response.json({ error: 'Could not save count line' }, { status: 500 });
  }
}
