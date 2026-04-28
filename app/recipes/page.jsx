import { getRecipes } from '../../lib/data';
import RecipeBrowserEnhanced from './RecipeBrowserEnhanced.jsx';

export default function RecipesPage() {
  const all = getRecipes().map(r => ({
    slug: r.slug, name: r.name,
    ingredient_count: (r.ingredients || []).length,
    allergens: r.allergens || [],
    ingredients_text: (r.ingredients || []).map(i => i.item).join(' ').toLowerCase(),
  }));
  return (
    <div>
      <h1>Recipe Hub</h1>
      <p className="subtitle">{all.length} recipes from the Lariat Recipe Book. Search by name, ingredient, or allergen.</p>
      <RecipeBrowserEnhanced recipes={all} />
    </div>
  );
}
