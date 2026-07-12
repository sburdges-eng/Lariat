// @ts-check
import { getRecipes } from '../../lib/data';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { isCateringRecipe } from '../../lib/recipeScope';
import RecipeBrowserEnhanced from './RecipeBrowserEnhanced.jsx';

/**
 * Per-card shape handed to the client browser. Distinct name from
 * lib/recipeCookbookGrouping.ts's `CookbookRecipe` (which this satisfies
 * structurally) to avoid shadowing that import elsewhere.
 * @typedef {{
 *   slug: string,
 *   name: string,
 *   category: string,
 *   station: string | null,
 *   menu_items: string[],
 *   is_catering: boolean,
 *   ingredient_count: number,
 *   allergens: string[],
 *   ingredients_text: string,
 *   yield_qty: number | string | null | undefined,
 *   yield_unit: string | null | undefined,
 *   photo_id: number | null,
 * }} RecipeCardData
 */

export const dynamic = 'force-dynamic';

/**
 * @param {{
 *   searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} props
 */
export default async function RecipesPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  // Pull first photo per recipe in a single query (avoids 73 client fetches).
  // Selection: prefer the pinned hero (is_hero=1) when present, else
  // fall back to MAX(id) (newest non-deleted upload). We can't combine
  // "prefer hero, else MAX(id)" in one GROUP BY cleanly in SQLite, so
  // we union: heroes first; non-hero MAX(id) only for slugs without a
  // hero. The page picks the first row per slug.
  /** @type {Map<string, number>} */
  let firstPhoto = new Map();
  try {
    const rows = /** @type {{ recipe_slug: string, photo_id: number }[]} */ (
      getDb()
        .prepare(
          `WITH heroes AS (
             SELECT recipe_slug, id AS photo_id
               FROM recipe_photos
              WHERE location_id = ?
                AND deleted_at IS NULL
                AND is_hero = 1
           ),
           latest AS (
             SELECT recipe_slug, MAX(id) AS photo_id
               FROM recipe_photos
              WHERE location_id = ?
                AND deleted_at IS NULL
              GROUP BY recipe_slug
           )
           SELECT recipe_slug, photo_id FROM heroes
           UNION ALL
           SELECT recipe_slug, photo_id FROM latest
            WHERE recipe_slug NOT IN (SELECT recipe_slug FROM heroes)`,
        )
        .all(loc, loc)
    );
    firstPhoto = new Map(rows.map((r) => [r.recipe_slug, r.photo_id]));
  } catch {
    // recipe_photos may not exist on a fresh DB; render without thumbnails.
  }

  const rawRecipes = getRecipes();

  const all = /** @type {RecipeCardData[]} */ (rawRecipes.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: (r.category || '').toString().trim().toLowerCase(),
    station: r.station || null,
    menu_items: r.menu_items || [],
    is_catering: isCateringRecipe(r),
    ingredient_count: (r.ingredients || []).length,
    allergens: r.allergens || [],
    ingredients_text: (r.ingredients || [])
      .map((i) => i.item)
      .join(' ')
      .toLowerCase(),
    yield_qty: r.yield_qty,
    yield_unit: r.yield_unit,
    photo_id: firstPhoto.get(r.slug) ?? null,
  })));

  return <RecipeBrowserEnhanced recipes={all} locationId={loc} />;
}
