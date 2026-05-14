// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getRecipes } from '../../lib/data';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import RecipeBrowserEnhanced from './RecipeBrowserEnhanced.jsx';

export const dynamic = 'force-dynamic';

export default function RecipesPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  // Pull first photo per recipe in a single query (avoids 73 client fetches).
  // Grouped by recipe_slug, MAX(id) per group → newest non-deleted photo.
  let firstPhoto = new Map();
  try {
    const rows = getDb()
      .prepare(
        `SELECT recipe_slug, MAX(id) AS photo_id
           FROM recipe_photos
          WHERE location_id = ?
            AND deleted_at IS NULL
          GROUP BY recipe_slug`,
      )
      .all(loc);
    firstPhoto = new Map(rows.map((r) => [r.recipe_slug, r.photo_id]));
  } catch {
    // recipe_photos may not exist on a fresh DB; render without thumbnails.
  }

  const all = getRecipes().map((r) => ({
    slug: r.slug,
    name: r.name,
    category: (r.category || '').toString().trim().toLowerCase(),
    station: r.station || null,
    ingredient_count: (r.ingredients || []).length,
    allergens: r.allergens || [],
    ingredients_text: (r.ingredients || [])
      .map((i) => i.item)
      .join(' ')
      .toLowerCase(),
    yield_qty: r.yield_qty,
    yield_unit: r.yield_unit,
    photo_id: firstPhoto.get(r.slug) ?? null,
  }));

  return <RecipeBrowserEnhanced recipes={all} />;
}
