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

/** Does the 86'd `item` text refer to the given `recipe`?
 *  Matches exact slug, name equality, or token-subset against name/slug. */
function itemMatchesRecipe(item: string, recipe: Recipe): boolean {
  const slugForm = item.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (slugForm === recipe.slug) return true;

  const itemToks = tokens(item);
  if (!itemToks.length) return false;
  const nameToks = tokens(recipe.name);
  const slugToks = tokens(recipe.slug);
  if (itemToks.length === nameToks.length && subsetOf(itemToks, nameToks) && subsetOf(nameToks, itemToks)) return true;
  if (subsetOf(itemToks, nameToks)) return true;
  if (subsetOf(itemToks, slugToks)) return true;
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
 *  Ingredient-level cascade (e.g. 86 "tomatoes" → all tomato-using recipes)
 *  is intentionally NOT handled here; the blast radius is a product
 *  decision that belongs in its own pass. */
export function cascadedFromEightySix(
  itemsEightySixed: string[],
  recipes: Recipe[],
): CascadedRecipe[] {
  if (!itemsEightySixed.length || !recipes.length) return [];
  const parents = buildParentIndex(recipes);
  const bySlug = new Map(recipes.map((r) => [r.slug, r]));
  const out = new Map<string, CascadedRecipe>();

  for (const item of itemsEightySixed) {
    if (!item) continue;

    const rootSlugs: string[] = [];
    for (const r of recipes) {
      if (itemMatchesRecipe(item, r)) rootSlugs.push(r.slug);
    }
    if (!rootSlugs.length) continue;

    for (const rootSlug of rootSlugs) {
      const queue: string[] = [rootSlug];
      const visited = new Set<string>([rootSlug]);
      while (queue.length) {
        const cur = queue.shift()!;
        const curParents = parents.get(cur);
        if (!curParents) continue;
        for (const p of curParents) {
          if (visited.has(p)) continue;
          visited.add(p);
          queue.push(p);
        }
      }

      // The root itself is already visibly 86'd through the regular board;
      // skip it and only report transitive parents.
      visited.delete(rootSlug);

      for (const slug of visited) {
        if (out.has(slug)) continue;
        const r = bySlug.get(slug);
        if (!r) continue;
        out.set(slug, { slug, name: r.name, via: item, root_slug: rootSlug });
      }
    }
  }

  return [...out.values()];
}
