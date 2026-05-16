// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../../../lib/db';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../../lib/location';
import { hasPinCookie, pinRequiredForPic } from '../../../../../../lib/pin';
import {
  validateSlug,
  validateYieldQty,
  validateYieldUnit,
} from '../../../../../../lib/specialsValidators';
import {
  buildExportCsv,
  mapCostBreakdownToIngredientRows,
  selectSkippedRows,
  stripCostMarkdown,
} from '../../../../../../lib/specialsExport';

export const dynamic = 'force-dynamic';

const CATEGORY_MAX = 64;

export async function POST(req, { params }) {

  params = await params;
  // Auth first — don't waste a JSON parse on an unauthenticated body.
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'request body must be a JSON object' }, { status: 400 });
  }

  const slugRes = validateSlug(body.slug);
  if (!slugRes.ok) return Response.json({ error: slugRes.error }, { status: 400 });

  const yqRes = validateYieldQty(body.yield_qty);
  if (!yqRes.ok) return Response.json({ error: yqRes.error }, { status: 400 });

  const yuRes = validateYieldUnit(body.yield_unit);
  if (!yuRes.ok) return Response.json({ error: yuRes.error }, { status: 400 });

  let category = '';
  if (body.category !== undefined && body.category !== null) {
    if (typeof body.category !== 'string') {
      return Response.json({ error: 'category must be a string' }, { status: 400 });
    }
    category = body.category.trim();
    if (category.length > CATEGORY_MAX) {
      return Response.json({ error: `category max ${CATEGORY_MAX} chars` }, { status: 400 });
    }
  }

  let procedureOverride = null;
  if (body.procedure_override !== undefined && body.procedure_override !== null) {
    if (typeof body.procedure_override !== 'string') {
      return Response.json({ error: 'procedure_override must be a string' }, { status: 400 });
    }
    procedureOverride = body.procedure_override;
  }

  const id = params.id;
  const locationId = locationFromRequest(req);
  const db = getDb();

  const row = db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, locationId);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  if (row.archived_at !== null) return Response.json({ error: 'special is archived' }, { status: 410 });

  // Slug collision check is read-only; tolerate missing entities_recipes table on fresh DBs.
  try {
    const collide = db.prepare(
      'SELECT slug FROM entities_recipes WHERE slug = ? AND location_id = ? LIMIT 1',
    ).get(slugRes.value, locationId);
    if (collide) {
      return Response.json({ error: 'slug already exists', slug: slugRes.value }, { status: 409 });
    }
  } catch (e) {
    if (!/no such table/i.test(String(e?.message))) throw e;
    /* entities_recipes not present (test DB) — skip the collision check */
  }

  let breakdown = [];
  if (row.cost_breakdown) {
    try { breakdown = JSON.parse(row.cost_breakdown); } catch { breakdown = []; }
  }
  const ingredient_rows = mapCostBreakdownToIngredientRows(breakdown);
  const skipped = selectSkippedRows(ingredient_rows);

  const procedure = procedureOverride !== null ? procedureOverride : stripCostMarkdown(row.ai_answer || '');

  const recipe_row = {
    slug: slugRes.value,
    display_name: row.name,
    yield_qty: yqRes.value,
    yield_unit: yuRes.value,
    category,
    procedure,
  };

  const csv = buildExportCsv({ recipe_row, ingredient_rows });

  const now = Date.now();
  const stmt = db.prepare('UPDATE specials SET last_exported_at = ?, updated_at = ? WHERE id = ? AND location_id = ?');
  const txn = db.transaction(() => {
    stmt.run(now, now, id, locationId);
    logAuditAction({
      action: 'specials.export',
      special_id: id,
      slug: slugRes.value,
      location_id: locationId,
    });
  });
  txn();

  return Response.json({ recipe_row, ingredient_rows, skipped, csv }, { status: 200 });
}
