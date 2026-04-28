/**
 * Fuzzy matcher: Toast `sales_lines.item_name` → `recipes[].menu_items[]`.
 *
 * Why this exists: lib/dishCostBridge.ts::normalizeDishName is intentionally
 * minimal (lowercase + collapse non-alnum). That misses the small set of
 * drift patterns Toast actually produces against curated menu_items in
 * recipes.json:
 *
 *   - "&" vs "AND"        ("FISH AND CHIPS" ↔ "Fish & Chips")
 *   - leading "The"       ("Rope Salad" ↔ "The Rope Salad")
 *   - accents             ("Jalapeno Cheddar Cornbread" ↔ "Jalapeño …")
 *   - abbreviations       ("Mountain Mac And Cheese" ↔ "Mtn Mac & Cheese")
 *   - filler-word subsets ("NASHVILLE CHICKEN SANDWICH" ⊂ "Nashville Hot
 *                          Chicken Sandwich")
 *
 * Closing those upstream in normalizeDishName would change the canonical
 * key used by every consumer (and break the few cases where "&" / "and"
 * really are different items). So the fuzz lives here, used only to
 * SUGGEST seed rows for operator review.
 *
 * Pure: no DB, no filesystem, no network. Hand-curated keyword tables.
 */

export type MenuItemMatchConfidence = 'high' | 'medium' | 'low';

export interface RecipeForMatch {
  slug: string;
  name?: string;
  /** Optional canonical menu-item declarations. Empty / missing is fine. */
  menu_items?: readonly string[];
}

export interface MenuItemMatch {
  recipe_slug: string;
  recipe_name: string;
  /** The exact menu_items[] string that produced the match. */
  declared_menu_item: string;
  confidence: MenuItemMatchConfidence;
  /** Short trace ('exact_norm' / 'amp_and' / 'the_prefix' / …). */
  reason: string;
}

// ── Normalization ─────────────────────────────────────────────────

/**
 * Hand-curated abbreviation expansions. Whitelist only — never grow this
 * via LLM or sales data. Apply in normalize() AFTER lowercase + accent
 * strip, BEFORE token split, so multi-token expansions land as separate
 * tokens.
 *
 * Keep entries narrow: we only add forms that have been observed on real
 * Toast exports. Speculative additions ("choc" → "chocolate") will fire
 * false positives on unrelated dishes.
 */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['mtn', 'mountain'],
  ['mt', 'mountain'],
  ['choc', 'chocolate'], // observed in dessert specials
  ['choco', 'chocolate'],
  ['vegg', 'vegetable'],
  ['veg', 'vegetable'],
  ['w/', 'with'],
  ['n/a', 'na'],
  // Spelling drift: American "chili" vs SW "chile". Toast records both
  // forms across exports; recipes.json uses 'chile'. Treating them as
  // identical lets "Green Chili" hit the "Green Chile (cup/bowl)"
  // declaration without a separate fuzz pass.
  ['chili', 'chile'],
  ['chilis', 'chile'],
]);

/**
 * Filler tokens dropped before subset / Jaccard scoring. Same spirit as
 * lib/foodDishProposals.ts FILLER_WORDS but tuned for menu titles, not
 * ingredient tokens — we keep "hot" because recipes care about heat
 * level ("Nashville Hot" vs plain), and we keep "old" / "fresh" / etc.
 */
const TITLE_FILLERS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'classic',
  'our',
  'house',
]);

/**
 * Strip combining diacritics, then drop anything outside [a-z0-9].
 * "Jalapeño" → "jalapeno"; "café" → "cafe".
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '');
}

/**
 * Token form used by every match strategy. Lowercase, accent-free,
 * `&` → `and`, single trailing-`s` plural strip on tokens ≥ 4 chars,
 * abbreviation expansion, filler removed, deduped, order preserved.
 */
export function tokenizeMenuTitle(s: string | null | undefined): string[] {
  if (!s) return [];
  const ampToAnd = stripAccents(String(s).toLowerCase()).replace(/&/g, ' and ');
  const raw = ampToAnd.replace(/[^a-z0-9/]+/g, ' ').split(/\s+/).filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw) {
    const expanded = ABBREVIATIONS.get(w) ?? w;
    // Expansion may itself be multi-token (none currently, but keep the
    // door open for "n/a" → "na" style entries by re-splitting).
    for (const tok of expanded.split(/\s+/)) {
      if (!tok) continue;
      if (TITLE_FILLERS.has(tok)) continue;
      const stem = tok.length >= 4 && tok.endsWith('s') ? tok.slice(0, -1) : tok;
      if (!seen.has(stem)) {
        seen.add(stem);
        out.push(stem);
      }
    }
  }
  return out;
}

/** Same tokens joined by single spaces — useful as a stable string key. */
export function canonicalKey(s: string | null | undefined): string {
  return tokenizeMenuTitle(s).join(' ');
}

// ── Matching strategies ───────────────────────────────────────────

interface Candidate {
  recipeSlug: string;
  recipeName: string;
  declared: string;
  confidence: MenuItemMatchConfidence;
  reason: string;
}

function isSubsetOrSuperset(a: string[], b: string[]): 'subset' | 'superset' | null {
  if (a.length === 0 || b.length === 0) return null;
  const setA = new Set(a);
  const setB = new Set(b);
  const aInB = a.every((t) => setB.has(t));
  const bInA = b.every((t) => setA.has(t));
  if (aInB && bInA) return null; // equal — caller already handled 'high'
  if (aInB) return 'subset';
  if (bInA) return 'superset';
  return null;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

const JACCARD_THRESHOLD = 0.7;
/**
 * Drop low-signal subset matches: a single token like "wing" subsetting
 * "Pig Wings" produces noise. Require at least 2 tokens of overlap, or a
 * single 5+-char token, before we'll subset-match.
 */
function subsetSignalOk(saleToks: string[], declaredToks: string[]): boolean {
  const small = saleToks.length <= declaredToks.length ? saleToks : declaredToks;
  if (small.length >= 2) return true;
  const only = small[0];
  return small.length === 1 && only !== undefined && only.length >= 5;
}

// ── Public API ─────────────────────────────────────────────────────

export interface MatchOptions {
  /** Cap on returned candidates per dish. Default 4. */
  maxCandidates?: number;
  /** Minimum confidence to surface. Default 'low'. */
  minConfidence?: MenuItemMatchConfidence;
}

const CONFIDENCE_RANK: Record<MenuItemMatchConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Match a Toast item_name against every recipe's menu_items[] declarations.
 *
 * Strategy ladder, in order — first match per (recipe, declared) wins:
 *   1. exact normalized token equality          → high
 *   2. exact equality after `&`/`the` normalize → high (subsumed by #1)
 *   3. one side is a subset of the other        → medium
 *   4. Jaccard ≥ 0.7                            → low
 *
 * Returns ranked candidates (high before medium before low). When a
 * single recipe has multiple menu_items declarations that all match,
 * we keep the highest-confidence one to avoid stuffing the CSV.
 */
export function matchDishToMenuItems(
  dishName: string,
  recipes: readonly RecipeForMatch[],
  opts: MatchOptions = {},
): MenuItemMatch[] {
  const max = opts.maxCandidates ?? 4;
  const minConf = opts.minConfidence ?? 'low';
  const minRank = CONFIDENCE_RANK[minConf];

  const saleToks = tokenizeMenuTitle(dishName);
  if (saleToks.length === 0) return [];
  const saleKey = saleToks.join(' ');

  const bestPerRecipe = new Map<string, Candidate>();

  for (const r of recipes) {
    if (!r.slug) continue;
    const declared = r.menu_items ?? [];
    if (declared.length === 0) continue;

    let best: Candidate | null = null;
    for (const dec of declared) {
      const decToks = tokenizeMenuTitle(dec);
      if (decToks.length === 0) continue;
      const decKey = decToks.join(' ');

      let cand: Candidate | null = null;
      if (decKey === saleKey) {
        cand = {
          recipeSlug: r.slug,
          recipeName: r.name || r.slug,
          declared: dec,
          confidence: 'high',
          reason: 'exact_normalized',
        };
      } else if (isSubsetOrSuperset(saleToks, decToks) && subsetSignalOk(saleToks, decToks)) {
        const dir = isSubsetOrSuperset(saleToks, decToks)!;
        cand = {
          recipeSlug: r.slug,
          recipeName: r.name || r.slug,
          declared: dec,
          confidence: 'medium',
          reason: dir === 'subset' ? 'sale_subset_of_declared' : 'declared_subset_of_sale',
        };
      } else {
        const j = jaccard(saleToks, decToks);
        if (j >= JACCARD_THRESHOLD) {
          cand = {
            recipeSlug: r.slug,
            recipeName: r.name || r.slug,
            declared: dec,
            confidence: 'low',
            reason: `jaccard_${j.toFixed(2)}`,
          };
        }
      }

      if (cand && (!best || CONFIDENCE_RANK[cand.confidence] < CONFIDENCE_RANK[best.confidence])) {
        best = cand;
      }
    }

    if (best && CONFIDENCE_RANK[best.confidence] <= minRank) {
      bestPerRecipe.set(r.slug, best);
    }
  }

  const sorted = [...bestPerRecipe.values()].sort((a, b) => {
    const cr = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (cr !== 0) return cr;
    return a.recipeSlug.localeCompare(b.recipeSlug);
  });

  return sorted.slice(0, max).map((c) => ({
    recipe_slug: c.recipeSlug,
    recipe_name: c.recipeName,
    declared_menu_item: c.declared,
    confidence: c.confidence,
    reason: c.reason,
  }));
}

export const __internal = {
  ABBREVIATIONS,
  TITLE_FILLERS,
  JACCARD_THRESHOLD,
  jaccard,
};
