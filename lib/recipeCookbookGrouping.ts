/**
 * Pure category-grouping helper for the cookbook browser.
 *
 * Extracted from app/recipes/RecipeBrowserEnhanced.jsx so the unit
 * test can assert ordering directly instead of scraping the rendered
 * DOM. Keep the implementation byte-equivalent to the inline version
 * the component shipped before extraction — the test fixture is the
 * binding contract.
 *
 * Ordering rules (kitchen reading-order, not alphabetical):
 *   1. Categories listed in CATEGORY_ORDER appear in that order
 *      (only those present in the input — empty categories aren't
 *      emitted).
 *   2. Unknown categories (anything not in CATEGORY_ORDER) come
 *      after, sorted alphabetically by category key.
 *   3. Recipes missing a category are bucketed under '_unknown' and
 *      sort with the other unknowns.
 */

export const CATEGORY_ORDER: readonly string[] = [
  'appetizer',
  'entree',
  'side',
  'sauce',
  'dressing',
  'seasoning',
  'prep',
  'dessert',
];

export interface CookbookRecipe {
  readonly category?: string | null;
  // The rest of the recipe shape is opaque to the grouping helper.
  readonly [key: string]: unknown;
}

export type CookbookGroups<R extends CookbookRecipe = CookbookRecipe> = Array<readonly [string, R[]]>;

/**
 * Group recipes by category. Returns a list of [category, recipes]
 * tuples in CATEGORY_ORDER, followed by unknown categories alphabetically.
 *
 * Stable within a bucket — preserves input order so callers that
 * pre-sort by name keep that ordering inside each category section.
 */
export function groupRecipesByCategory<R extends CookbookRecipe>(
  recipes: readonly R[],
): CookbookGroups<R> {
  const buckets = new Map<string, R[]>();
  for (const r of recipes) {
    const key = r.category || '_unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(r);
  }
  const known: CookbookGroups<R> = CATEGORY_ORDER.filter((c) => buckets.has(c)).map(
    (c) => [c, buckets.get(c)!] as const,
  );
  const extras = [...buckets.keys()]
    .filter((c) => !CATEGORY_ORDER.includes(c))
    .sort();
  return [
    ...known,
    ...extras.map((c) => [c, buckets.get(c)!] as const),
  ];
}
