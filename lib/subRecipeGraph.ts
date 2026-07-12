import type { Recipe } from './data.ts';

/** A recipe that is transitively unavailable because one of its
 *  sub-recipes was 86'd. */
export interface CascadedRecipe {
  slug: string;
  name: string;
  /** The 86'd item text that triggered this cascade. */
  via: string;
  /** The sub-recipe slug that matched the 86'd item (may equal slug). */
  root_slug: string;
}

function tokens(s: string | undefined | null): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function subsetOf(a: string[], b: string[]): boolean {
  if (!a.length) return false;
  const bSet = new Set(b);
  return a.every((t) => bSet.has(t));
}

/** Precomputed match keys for one recipe — built once per cascade call. */
interface RecipeMatchIndex {
  recipe: Recipe;
  nameToks: string[];
  slugToks: string[];
  ingredientToks: string[][];
}

function buildMatchIndex(recipes: Recipe[]): RecipeMatchIndex[] {
  return recipes.map((recipe) => ({
    recipe,
    nameToks: tokens(recipe.name),
    slugToks: tokens(recipe.slug),
    ingredientToks: (recipe.ingredients || [])
      .map((ing) => tokens(ing.item))
      .filter((t) => t.length > 0),
  }));
}

/** Does the 86'd `item` text refer to the given indexed recipe?
 *  Matches exact slug, name equality, or token-subset against name/slug/ingredients. */
function itemMatchesIndexed(item: string, idx: RecipeMatchIndex): boolean {
  const slugForm = item.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (slugForm === idx.recipe.slug) return true;

  const itemToks = tokens(item);
  if (!itemToks.length) return false;
  if (
    itemToks.length === idx.nameToks.length &&
    subsetOf(itemToks, idx.nameToks) &&
    subsetOf(idx.nameToks, itemToks)
  ) {
    return true;
  }
  if (subsetOf(itemToks, idx.nameToks)) return true;
  if (subsetOf(itemToks, idx.slugToks)) return true;

  for (const ingToks of idx.ingredientToks) {
    if (subsetOf(itemToks, ingToks)) return true;
  }
  return false;
}

/** Build parent-lookup: for each slug, the recipes that DIRECTLY list it
 *  as a sub-recipe. Used to walk transitive unavailability upward. */
function buildParentIndex(recipes: Recipe[]): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>();
  for (const r of recipes) {
    for (const child of r.sub_recipes || []) {
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child)!.add(r.slug);
    }
  }
  return parents;
}

/** Given a list of 86'd item strings, return every recipe that becomes
 *  unavailable because one of its (transitive) sub-recipes matches.
 *
 *  De-duplicated by slug: a recipe reached through multiple 86 paths
 *  reports the first matching `via`. This is deliberate — the UI just
 *  needs to say "X is out" without implying a priority ordering.
 *
 *  Ingredient-level cascade (e.g. 86 "tomatoes" → recipes that list tomatoes)
 *  is handled here: if the 86'd item matches an ingredient, parent recipes
 *  surface on the cascade board when the match is not an exact recipe name. */
export function cascadedFromEightySix(
  itemsEightySixed: string[],
  recipes: Recipe[],
): CascadedRecipe[] {
  if (!itemsEightySixed.length || !recipes.length) return [];
  const parents = buildParentIndex(recipes);
  const bySlug = new Map(recipes.map((r) => [r.slug, r]));
  const matchIndex = buildMatchIndex(recipes);
  const out = new Map<string, CascadedRecipe>();

  for (const item of itemsEightySixed) {
    if (!item) continue;

    const rootSlugs: string[] = [];
    for (const idx of matchIndex) {
      if (itemMatchesIndexed(item, idx)) rootSlugs.push(idx.recipe.slug);
    }
    if (!rootSlugs.length) continue;

    const itemTrim = item.trim().toLowerCase();
    const itemSlugForm = itemTrim.replace(/[^a-z0-9]+/g, '_');

    for (const rootSlug of rootSlugs) {
      // Index-based BFS — avoid Array.shift() O(n) cost on deep DAGs.
      const queue: string[] = [rootSlug];
      let head = 0;
      const visited = new Set<string>([rootSlug]);
      while (head < queue.length) {
        const cur = queue[head++]!;
        const curParents = parents.get(cur);
        if (!curParents) continue;
        for (const p of curParents) {
          if (visited.has(p)) continue;
          visited.add(p);
          queue.push(p);
        }
      }

      // If the 86'd item was an exact match for the recipe's name or slug,
      // the recipe is already visibly 86'd on the regular board, so we skip it.
      // If it only matched because of an ingredient, the recipe should appear in the cascade.
      const r = bySlug.get(rootSlug);
      const isExactMatch = r && (
        r.name.trim().toLowerCase() === itemTrim ||
        r.slug === itemSlugForm
      );
      if (isExactMatch) {
        visited.delete(rootSlug);
      }

      for (const slug of visited) {
        if (out.has(slug)) continue;
        const recipe = bySlug.get(slug);
        if (!recipe) continue;
        out.set(slug, { slug, name: recipe.name, via: item, root_slug: rootSlug });
      }
    }
  }

  return [...out.values()];
}
