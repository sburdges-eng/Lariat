// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getRecipes } from '../../../lib/data';

/** @param {Request} req */
export async function GET(req) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const allergen = url.searchParams.get('allergen');
  let recipes = getRecipes();
  if (allergen) {
    recipes = recipes.filter(r => (r.allergens || []).includes(allergen));
  }
  if (q) {
    recipes = recipes.filter(r => {
      if (r.name.toLowerCase().includes(q)) return true;
      return (r.ingredients || []).some(i => (i.item || '').toLowerCase().includes(q));
    });
  }
  return Response.json(recipes.map(r => ({
    slug: r.slug, name: r.name,
    ingredient_count: (r.ingredients || []).length,
    allergens: r.allergens || [],
    direct_allergens: r.direct_allergens || r.allergens || [],
    sub_recipes: r.sub_recipes || [],
  })));
}
