/**
 * Option 5: best-effort component-list proposals for unlinked FOOD dishes.
 *
 * Scope: given a dish name, produce a short review-ready list of
 * candidate `{component_type, recipe_slug|vendor_ingredient, ...}` rows
 * that the operator can hand-edit (add qty + unit) and push back through
 * `scripts/import-dish-components.mjs`.
 *
 * Non-goals (hard guard rails; see anti-scope in the PR description):
 *   - No DB writes (pure function of input sources).
 *   - No LLM / network / heavy string lib. Keyword whitelist + simple
 *     substring match only.
 *   - No qty/unit invention. Every row's qty_per_serving and unit are
 *     blank — the operator fills them. (The importer validates and will
 *     reject the row until the operator fills in a valid qty+unit.)
 *
 * Why this module is separated from the CLI script:
 *   - The inference rules are the interesting part and need unit tests
 *     without touching the DB.
 *   - The CLI glue (argparse, DB reads, file I/O) is trivial.
 */

export type ProposalConfidence = 'high' | 'medium' | 'low';

export interface ProposalRow {
  dish_name: string;
  component_type: 'recipe' | 'vendor_item';
  /** Populated when component_type='recipe'. */
  recipe_slug: string;
  /** Populated when component_type='vendor_item'. */
  vendor_ingredient: string;
  /** Always blank from this module — operator fills. */
  qty_per_serving: string;
  /** Always blank from this module — operator fills. */
  unit: string;
  /** Confidence tier — high|medium|low. Goes to CSV as a hint column. */
  confidence: ProposalConfidence;
  /** Short trace of why this row was proposed. Lands in CSV `notes`. */
  notes: string;
}

export interface ProposalSources {
  /** Minimal Recipe view. slug is required; menu_items optional. */
  recipes: Array<{ slug: string; name?: string; menu_items?: string[] }>;
  /** Distinct `vendor_prices.ingredient` strings, unsorted OK. */
  vendorIngredients: string[];
  /** Distinct `order_guide_items.ingredient` strings, unsorted OK. */
  orderGuideIngredients: string[];
}

export interface ProposeOptions {
  /**
   * Cap on rows per dish. Prevents any one dish from swamping the CSV
   * with marginal vendor substring matches. Default: 15 — large enough
   * that an acronym-expanded dish (BLT: 6 tokens × ~2 variants each)
   * keeps all of bacon/lettuce/tomato/bun/bread/mayo plus a few
   * low-confidence rows, but tight enough that substring noise on a
   * 20+-variant vendor token (BACON has 4 variants) is bounded.
   */
  maxRowsPerDish?: number;
}

export interface ProposalDiagnostics {
  dishName: string;
  tokens: string[];
  acronymExpansion: string[] | null;
  compositeMatchKey: string | null;
  recipeMatches: number;
  vendorMatches: number;
  orderGuideMatches: number;
}

export interface ProposeResult {
  rows: ProposalRow[];
  diagnostics: ProposalDiagnostics;
}

// ── Token / keyword config ─────────────────────────────────────────

const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'or',
  'a',
  'an',
  'with',
  'classic',
  'special',
  'house',
  'hot', // "nashville hot" → we want 'nashville'
  'fresh',
  'our',
  'n',
]);

/**
 * Acronym → expanded tokens. Whitelist ONLY — never grow this via LLM
 * or live data; every entry here is a hand-curated mapping that survives
 * code review. The expansion is additive: we keep the raw acronym token
 * too so recipe slugs that literally contain "blt" still match.
 */
const ACRONYM_EXPANSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['blt', ['bacon', 'lettuce', 'tomato', 'bun', 'bread', 'mayo']],
  ['bbq', ['bbq', 'bbq_sauce', 'sauce']],
]);

/**
 * Composite / multi-word dish patterns. Keyed by a canonical composite
 * key we derive from the dish name (see compositeKeyForDish).
 *
 * The values are supplementary *tokens* we splice into the search list
 * — they do NOT bypass the source-matching step. A token here still has
 * to match something in recipes.json / vendor_prices / order_guide.
 */
const COMPOSITE_TOKENS: ReadonlyMap<string, readonly string[]> = new Map([
  // "FISH AND CHIPS" → add batter, fries/potato, tartar
  ['fish chips', ['fish', 'batter', 'fries', 'potato', 'chip', 'tartar']],
  ['fish and chips', ['fish', 'batter', 'fries', 'potato', 'chip', 'tartar']],
  // "NASHVILLE" anywhere → add chicken, nashville oil, buttermilk, bun, pickle
  ['nashville', ['chicken', 'nashville', 'buttermilk', 'bun', 'pickle', 'coleslaw']],
]);

/**
 * Tiny synonym whitelist. Each entry maps a dish-side token to the token
 * we actually search for against sources. Conservative on purpose.
 */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['fries', ['potato']],
  ['chips', ['potato']],
  ['chip', ['potato']],
  ['sub', ['bun', 'bread']],
  ['wrap', ['tortilla']],
  ['sandwich', ['bun', 'bread']],
  ['burger', ['bun', 'patty']],
]);

// Substring hits against a recipe slug / vendor ingredient are "low"
// unless the dish-side token matches as a whole word in a recipe slug
// (splitting slugs on underscore), in which case the match is "medium".
// Keep this conservative: a token must be >= MIN_TOKEN_LEN before we
// use it for substring search, to keep "a" / "or" from matching nothing
// and "us" from matching "queso blanco".
const MIN_TOKEN_LEN = 3;

// Default cap — tunable via opts.maxRowsPerDish.
const DEFAULT_MAX_ROWS_PER_DISH = 15;

// ── Tokenization ───────────────────────────────────────────────────

/**
 * Lowercase, collapse non-alphanumeric runs to spaces, split, drop
 * fillers, de-duplicate. Order preserved (first occurrence).
 *
 * `stem` is a cheap trailing-s drop for plurals only. Full stemmers
 * would generate too many false positives (e.g. "potatoes" → "potato"
 * is fine, but "greens" → "green" would conflate greens-the-lettuce
 * with Green-the-chili). We also map a small synonym table AFTER
 * stemming.
 */
export function tokenizeDishName(name: string): string[] {
  if (!name) return [];
  const words = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    if (FILLER_WORDS.has(raw)) continue;
    if (raw.length < 2) continue;
    // Cheap plural strip: drop a single trailing 's' when word >= 4 chars
    // so "tacos" → "taco", "fries" → "frie" (handled by SYNONYMS anyway).
    const stem = raw.length >= 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (!seen.has(stem)) {
      seen.add(stem);
      out.push(stem);
    }
  }
  return out;
}

/**
 * Build the supplementary token set for this dish:
 *   1. Acronym expansion (only exact acronym token match)
 *   2. Composite key lookup (e.g. "fish and chips")
 *   3. Synonym splat for each base token
 * All additions de-duplicated against the base token list.
 */
function enrichTokens(base: string[], rawName: string): {
  allTokens: string[];
  acronymExpansion: string[] | null;
  compositeKey: string | null;
} {
  const all = [...base];
  const seen = new Set(base);

  const addToken = (t: string): void => {
    if (!seen.has(t)) {
      seen.add(t);
      all.push(t);
    }
  };

  // Acronym expansion — token must be an exact acronym key (e.g. 'blt').
  let acronymExpansion: string[] | null = null;
  for (const tok of base) {
    const exp = ACRONYM_EXPANSIONS.get(tok);
    if (exp) {
      acronymExpansion = [...exp];
      for (const e of exp) addToken(e);
      break; // one acronym per dish is enough
    }
  }

  // Composite key check. We build a few normalized variants and look
  // each up in COMPOSITE_TOKENS.
  const normalized = String(rawName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let compositeKey: string | null = null;
  for (const key of COMPOSITE_TOKENS.keys()) {
    if (normalized.includes(key)) {
      compositeKey = key;
      const tokens = COMPOSITE_TOKENS.get(key);
      if (tokens) {
        for (const t of tokens) addToken(t);
      }
      break; // first composite match wins
    }
  }

  // Synonym splat
  for (const tok of [...all]) {
    const syns = SYNONYMS.get(tok);
    if (syns) {
      for (const s of syns) addToken(s);
    }
  }

  return { allTokens: all, acronymExpansion, compositeKey };
}

// ── Source matching ────────────────────────────────────────────────

interface ScoredMatch {
  source: 'recipe' | 'vendor' | 'order_guide';
  value: string;
  confidence: ProposalConfidence;
  matchedToken: string;
  whole: boolean;
}

/** Treat recipe slugs as underscore-separated words for whole-word matching. */
function recipeSlugWords(slug: string): Set<string> {
  return new Set(slug.toLowerCase().split('_').filter(Boolean));
}

/** Split a vendor ingredient string into alnum tokens for whole-word matching. */
function vendorWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean),
  );
}

/**
 * Score a (token, source-string) pair. `wholeWordSet` is the pre-split
 * set of alnum words in the source string; we use that to pick
 * medium-vs-low confidence without re-splitting per call.
 */
function scoreMatch(
  token: string,
  source: string,
  wholeWordSet: Set<string>,
): ProposalConfidence | null {
  if (token.length < MIN_TOKEN_LEN) return null;
  const lowerSource = source.toLowerCase();
  if (wholeWordSet.has(token)) return 'medium';
  if (lowerSource.includes(token)) return 'low';
  return null;
}

function dedupeKey(m: ScoredMatch): string {
  return `${m.source}:${m.value.toLowerCase()}`;
}

function confidenceRank(c: ProposalConfidence): number {
  return c === 'high' ? 0 : c === 'medium' ? 1 : 2;
}

/**
 * Core match pass against all three sources in the priority order
 * recipes > vendor_prices > order_guide_items. Matches are deduped by
 * (source, value) — if a token hits the same vendor string twice we
 * keep the higher-confidence one.
 *
 * The ACRONYM_EXPANSIONS tokens get bumped to 'medium' confidence on
 * whole-word hit per the spec's "Acronym expansion hit (BLT → bacon/
 * lettuce/tomato): confidence medium if the acronym is whitelisted".
 * Raw base-token whole-word hits are also medium; substring hits are low.
 * So acronym-driven tokens inherit the same rules as base tokens here
 * — their "medium-on-whole-word" promise is carried by the whole-word
 * rule, not by bumping weight separately.
 */
function matchAgainstSources(
  tokens: string[],
  sources: ProposalSources,
): ScoredMatch[] {
  const byKey = new Map<string, ScoredMatch>();

  const consider = (m: ScoredMatch): void => {
    const k = dedupeKey(m);
    const prev = byKey.get(k);
    if (!prev || confidenceRank(m.confidence) < confidenceRank(prev.confidence)) {
      byKey.set(k, m);
    }
  };

  // (a) recipes by slug whole-word match
  for (const r of sources.recipes) {
    const slug = String(r.slug || '').toLowerCase();
    if (!slug) continue;
    const slugWords = recipeSlugWords(slug);
    for (const tok of tokens) {
      const score = scoreMatch(tok, slug, slugWords);
      if (score) {
        consider({
          source: 'recipe',
          value: r.slug,
          confidence: score,
          matchedToken: tok,
          whole: score === 'medium',
        });
        break; // one match per recipe is enough
      }
    }
  }

  // (b) vendor_prices.ingredient
  for (const ing of sources.vendorIngredients) {
    if (!ing) continue;
    const words = vendorWords(ing);
    let best: ProposalConfidence | null = null;
    let bestToken = '';
    for (const tok of tokens) {
      const score = scoreMatch(tok, ing, words);
      if (score && (!best || confidenceRank(score) < confidenceRank(best))) {
        best = score;
        bestToken = tok;
        if (best === 'medium') break; // can't do better
      }
    }
    if (best) {
      consider({
        source: 'vendor',
        value: ing,
        confidence: best,
        matchedToken: bestToken,
        whole: best === 'medium',
      });
    }
  }

  // (c) order_guide_items.ingredient — lower priority, only surface if
  // it would bring a whole-word ('medium') hit that vendor_prices didn't
  // already cover. Placeholder-price issue means we don't want these to
  // dominate the CSV.
  const vendorKeys = new Set(
    [...byKey.values()]
      .filter((m) => m.source === 'vendor')
      .map((m) => m.value.toLowerCase()),
  );
  for (const ing of sources.orderGuideIngredients) {
    if (!ing) continue;
    // Skip if vendor_prices already surfaced this exact string.
    if (vendorKeys.has(ing.toLowerCase())) continue;
    const words = vendorWords(ing);
    let best: ProposalConfidence | null = null;
    let bestToken = '';
    for (const tok of tokens) {
      const score = scoreMatch(tok, ing, words);
      // Only medium hits from OG; substring hits would flood the CSV.
      if (score === 'medium') {
        best = 'low'; // demote medium-from-OG to low to signal the placeholder-price caveat
        bestToken = tok;
        break;
      }
    }
    if (best) {
      consider({
        source: 'order_guide',
        value: ing,
        confidence: best,
        matchedToken: bestToken,
        whole: false,
      });
    }
  }

  return [...byKey.values()];
}

// ── Row composition ────────────────────────────────────────────────

function composeRows(
  dishName: string,
  matches: ScoredMatch[],
  maxRows: number,
): ProposalRow[] {
  // Sort: high/medium before low, then recipe before vendor before OG,
  // then alphabetically by value.
  const sorted = [...matches].sort((a, b) => {
    const cr = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (cr !== 0) return cr;
    const sr = sourceRank(a.source) - sourceRank(b.source);
    if (sr !== 0) return sr;
    return a.value.localeCompare(b.value);
  });

  // Per-(source, token) cap so a token with many variants (e.g. 4 BACON
  // vendor SKUs on a BLT) doesn't crowd out other expansion tokens
  // (LETTUCE, MAYO) before the overall cap kicks in. Keeps the first
  // ROWS_PER_TOKEN per bucket; the operator will pick one SKU anyway.
  const ROWS_PER_TOKEN = 2;
  const perTokenCounts = new Map<string, number>();
  const bucketed: ScoredMatch[] = [];
  for (const m of sorted) {
    const key = `${m.source}:${m.matchedToken}`;
    const n = perTokenCounts.get(key) || 0;
    if (n >= ROWS_PER_TOKEN) continue;
    perTokenCounts.set(key, n + 1);
    bucketed.push(m);
  }
  const capped = bucketed.slice(0, maxRows);

  return capped.map((m) => {
    if (m.source === 'recipe') {
      return {
        dish_name: dishName,
        component_type: 'recipe' as const,
        recipe_slug: m.value,
        vendor_ingredient: '',
        qty_per_serving: '',
        unit: '',
        confidence: m.confidence,
        notes: `recipe slug matches token "${m.matchedToken}" (${m.whole ? 'whole-word' : 'substring'})`,
      };
    }
    return {
      dish_name: dishName,
      component_type: 'vendor_item' as const,
      recipe_slug: '',
      vendor_ingredient: m.value,
      qty_per_serving: '',
      unit: '',
      confidence: m.confidence,
      notes:
        m.source === 'vendor'
          ? `vendor_prices matches token "${m.matchedToken}" (${m.whole ? 'whole-word' : 'substring'})`
          : `order_guide matches token "${m.matchedToken}" (whole-word, demoted to low: placeholder-price risk)`,
    };
  });
}

function sourceRank(s: ScoredMatch['source']): number {
  return s === 'recipe' ? 0 : s === 'vendor' ? 1 : 2;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Propose a best-effort component list for an unlinked food dish.
 *
 * Returns a small number of rows (default cap 8) that an operator
 * should review. Each row's qty_per_serving and unit are blank by
 * design — this module does not invent quantities. Confidence is a
 * hint for triage, not a filter: the operator sees every row.
 *
 * Pure function: no DB, no filesystem, no network.
 */
export function proposeComponentsForDish(
  dishName: string,
  sources: ProposalSources,
  opts: ProposeOptions = {},
): ProposeResult {
  const max = opts.maxRowsPerDish ?? DEFAULT_MAX_ROWS_PER_DISH;

  const baseTokens = tokenizeDishName(dishName);
  const { allTokens, acronymExpansion, compositeKey } = enrichTokens(
    baseTokens,
    dishName,
  );

  const matches = matchAgainstSources(allTokens, sources);
  const rows = composeRows(dishName, matches, max);

  const diagnostics: ProposalDiagnostics = {
    dishName,
    tokens: allTokens,
    acronymExpansion,
    compositeMatchKey: compositeKey,
    recipeMatches: matches.filter((m) => m.source === 'recipe').length,
    vendorMatches: matches.filter((m) => m.source === 'vendor').length,
    orderGuideMatches: matches.filter((m) => m.source === 'order_guide').length,
  };

  return { rows, diagnostics };
}

// Re-exported for tests and for downstream callers that want to run
// identical tokenization (e.g. the CLI summary on stderr).
export const __internal = {
  ACRONYM_EXPANSIONS,
  COMPOSITE_TOKENS,
  SYNONYMS,
  FILLER_WORDS,
};
