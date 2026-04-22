import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { validateDishComponent } from '../../../lib/dishComponents';
import { normalizeDishName } from '../../../lib/dishCostBridge';

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
            ORDER BY recipe_slug`,
        )
        .all(location_id, norm);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM dish_components
            WHERE location_id = ?
            ORDER BY dish_name, recipe_slug`,
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
// UPSERT on (location_id, dish_name, recipe_slug). dish_name stored
// canonical (normalized). Pass `dish_name_display` to remember the
// original case if needed; not stored in this version (canonical only).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validateDishComponent(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const dish_name = normalizeDishName(body.dish_name);
    if (!dish_name) {
      return Response.json({ error: 'dish_name normalized to empty' }, { status: 400 });
    }
    const recipe_slug = clip(body.recipe_slug, 80) as string;
    const qty_per_serving = Number(body.qty_per_serving);
    const unit = clip(body.unit, 24) as string;
    const notes = clip(body.notes, 500);
    const location_id = locationFromBody(body);

    const db = getDb();
    // SELECT existing → INSERT or UPDATE inside one transaction. SQLite
    // UNIQUE on (location_id, dish_name, recipe_slug) backs this; ON CONFLICT
    // DO UPDATE works here because none of the unique-key columns are NULL.
    const result = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO dish_components
             (location_id, dish_name, recipe_slug, qty_per_serving, unit, notes)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(location_id, dish_name, recipe_slug) DO UPDATE SET
             qty_per_serving = excluded.qty_per_serving,
             unit            = excluded.unit,
             notes           = excluded.notes,
             updated_at      = datetime('now')`,
        )
        .run(location_id, dish_name, recipe_slug, qty_per_serving, unit, notes);
      const row = db
        .prepare(
          `SELECT * FROM dish_components
            WHERE location_id = ? AND dish_name = ? AND recipe_slug = ?`,
        )
        .get(location_id, dish_name, recipe_slug);
      return { info, row };
    })();

    return Response.json({ ok: true, component: result.row });
  } catch (err) {
    console.error('POST /api/dish-components failed:', err);
    return Response.json({ error: 'Failed to save dish component' }, { status: 500 });
  }
}

// ── DELETE /api/dish-components ──────────────────────────────────
// Body: { id } — delete by primary key.
export async function DELETE(req: Request) {
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
