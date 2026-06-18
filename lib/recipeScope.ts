/**
 * Split kitchen line recipes (the PDF recipe book) from catering/BEO builds.
 *
 * Catering rows in recipe_index.csv are tagged with "(BEO)" on menu_items;
 * buffet/dinner categories are event packages. Line cooks open /recipes for
 * prep and sauces — not passed apps and plated dinners.
 */

export interface RecipeScopeInput {
  readonly category?: string | null;
  readonly menu_items?: readonly string[] | null;
}

/** True when the recipe is a catering/BEO item, not core line prep. */
export function isCateringRecipe(recipe: RecipeScopeInput): boolean {
  const category = (recipe.category || '').toLowerCase();
  if (category === 'buffet' || category === 'dinner') return true;

  const menuItems = recipe.menu_items || [];
  return menuItems.some((item) => /\(BEO\)/i.test(item));
}

export type RecipeBookScope = 'book' | 'catering' | 'all';

export function recipeMatchesScope(
  recipe: RecipeScopeInput,
  scope: RecipeBookScope,
): boolean {
  if (scope === 'all') return true;
  const catering = isCateringRecipe(recipe);
  return scope === 'catering' ? catering : !catering;
}
