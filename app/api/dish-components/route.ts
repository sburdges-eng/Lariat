import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { validateDishComponent } from '../../../lib/dishComponents';
import { normalizeDishName } from '../../../lib/dishCostBridge';
import { upsertDishComponent } from '../../../lib/dishComponentsRepo';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── GET /api/dish-components ─────────────────────────────────────
// Optional ?dish=<canonical-or-display> filter for the editor.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const dish = url.searchParams.get('dish');
    const db = getDb();
    let rows;
    if (dish) {
      const norm = normalizeDishName(dish);
      rows = db
        .prepare(
          `SELECT * FROM dish_components
            WHERE location_id = ? AND LOWER(TRIM(dish_name)) = ?
            ORDER BY component_type, recipe_slug, vendor_ingredient`,
        )
        .all(location_id, norm);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM dish_components
            WHERE location_id = ?
            ORDER BY dish_name, component_type, recipe_slug, vendor_ingredient`,
        )
        .all(location_id);
    }
    return Response.json({ location_id, components: rows });
  } catch (err) {
    console.error('GET /api/dish-components failed:', err);
    return Response.json({ error: 'Failed to load dish components' }, { status: 500 });
  }
}

// ── POST /api/dish-components ────────────────────────────────────
// Upsert routed through lib/dishComponentsRepo so the CLI importer
// and this API route share the same SQL and identical-row detection.
export async function POST(req: Request) {
  return withIdempotency(req, () => dishComponentsPostHandler(req));
}

async function dishComponentsPostHandler(req: Request) {
  try {
    const body = await req.json();
    const v = validateDishComponent(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const dish_name = normalizeDishName(body.dish_name);
    if (!dish_name) {
      return Response.json({ error: 'dish_name normalized to empty' }, { status: 400 });
    }
    const component_type = (body.component_type ?? 'recipe') as 'recipe' | 'vendor_item';
    const recipe_slug = component_type === 'recipe' ? clip(body.recipe_slug, 80) : null;
    const vendor_ingredient = component_type === 'vendor_item' ? clip(body.vendor_ingredient, 200) : null;
    const qty_per_serving = Number(body.qty_per_serving);
    const unit = clip(body.unit, 24) as string;
    const notes = clip(body.notes, 500);
    const location_id = locationFromBody(body);

    const db = getDb();
    const result = db.transaction(() =>
      upsertDishComponent(db, {
        location_id,
        dish_name,
        component_type,
        recipe_slug,
        vendor_ingredient,
        qty_per_serving,
        unit,
        notes,
      }),
    )();

    return Response.json({ ok: true, component: result.row });
  } catch (err) {
    console.error('POST /api/dish-components failed:', err);
    return Response.json({ error: 'Failed to save dish component' }, { status: 500 });
  }
}

// ── DELETE /api/dish-components ──────────────────────────────────
// Body: { id } — delete by primary key.
export async function DELETE(req: Request) {
  return withIdempotency(req, () => dishComponentsDeleteHandler(req));
}

async function dishComponentsDeleteHandler(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const db = getDb();
    db.prepare(`DELETE FROM dish_components WHERE id = ?`).run(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/dish-components failed:', err);
    return Response.json({ error: 'Failed to delete dish component' }, { status: 500 });
  }
}
