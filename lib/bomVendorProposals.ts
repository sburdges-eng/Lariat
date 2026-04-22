/**
 * Option 6: best-effort vendor-match proposals for UNMAPPED `bom_lines` rows.
 *
 * Scope: given a bom_line row (ingredient, qty, unit) and a set of
 * candidate sources (vendor_prices.ingredient, order_guide_items.ingredient,
 * known house-recipe slugs), produce a ranked list of candidate matches.
 * Every row is returned with 0-N candidates — zero candidates is a valid
 * output for truly-unresolvable rows (e.g. `water`).
 *
 * Non-goals (hard guard rails):
 *   - No DB writes. This is a pure function of the input sources.
 *   - No LLM / network / fuzzy-ML matching. Small explicit synonym whitelist
 *     only, no ambient token "stemming" beyond trailing -s.
 *   - No qty/unit invention; qty/unit are carried from the input row.
 *   - No match is ever proposed just to have one. If nothing scores above
 *     `low` and no synonym rule fires, we return zero candidates and flag
 *     the row for manual review.
 *
 * Confidence tiers (ordered best → worst):
 *   - `high`  — exact case-insensitive match, or house-recipe slug hit
 *   - `medium`— all-token whole-word substring match, or synonym-whitelist
 *               hit against a real candidate name
 *   - `low`   — partial substring match on ≥1 token, OR a
 *               flagged-not-equivalent synonym like baking soda → baking
 *               powder
 *   - `none`  — no candidate (water, or a row with zero real matches)
 *
 * Special-case classifications (from the PR spec):
 *   - `house`             — water-like row; no vendor mapping is correct
 *   - `needs_house_recipe`— proprietary "lariat <x>" blend with no slug yet;
 *                           operator needs to create a sub-recipe
 *   - `matched_house_recipe` — a bom_line ingredient exactly matches an
 *                           existing recipe slug (e.g. "lariat rub" →
 *                           `lariat_rub` sub-recipe)
 *   - `manual`            — real ingredient, no usable candidate found
 *   - `matched`           — at least one candidate with confidence ≥ low
 *
 * This module is pure; the CLI in scripts/propose-bom-vendor-matches.mjs
 * is the only place with DB + filesystem side effects.
 */

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export type CandidateSource = 'vendor_prices' | 'order_guide' | 'recipe' | 'none';

export type BomClassification =
  | 'matched'
  | 'matched_house_recipe'
  | 'needs_house_recipe'
  | 'house'
  | 'manual';

export interface BomLineInput {
  bom_line_id: number;
  recipe_id: string;
  ingredient: string;
  qty: number | null;
  unit: string | null;
}

/** A candidate match record, normalized across vendor / order-guide / recipe sources. */
export interface Candidate {
  /** Which source this candidate came from. 'recipe' when we match an existing sub-recipe slug. */
  source: CandidateSource;
  /** Display name as it appears in the source (e.g. "Baking Soda", "PASTE, ACHIOTE", "lariat_rub"). */
  name: string;
  /** Vendor (sysco, shamrock, etc.) — blank for recipe-source. */
  vendor: string;
  /** Pack unit (lb, case, etc.) — blank for recipe-source. */
  pack_unit: string;
  /** Unit price in $ / pack_unit — null for recipe-source (cost lives elsewhere). */
  unit_price: number | null;
}

export interface RankedCandidate extends Candidate {
  confidence: MatchConfidence;
  /** Short trace of why this candidate was proposed. Lands in CSV `notes`. */
  reason: string;
}

export interface ProposalResult {
  row: BomLineInput;
  classification: BomClassification;
  candidates: RankedCandidate[];
  /** Overall note about why this classification was assigned. */
  note: string;
}

export interface ProposalSources {
  /** Distinct vendor_prices rows — authoritative. */
  vendorPrices: Candidate[];
  /** Distinct order_guide_items rows — lower trust. */
  orderGuide: Candidate[];
  /** Existing recipe slugs (from recipes.json), used to match house sub-recipes. */
  recipeSlugs: string[];
}

export interface ProposeOptions {
  /** Hard cap on candidates per bom line. Default 5 (enough for ranking, short enough for human review). */
  maxCandidatesPerRow?: number;
}

// ── Configuration ──────────────────────────────────────────────────

const DEFAULT_MAX_CANDIDATES = 5;
const MIN_TOKEN_LEN = 3;

const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'or',
  'a',
  'an',
  'with',
  'of',
]);

/**
 * Conservative synonym whitelist. Each key is a TOKEN that can appear in
 * a bom_line ingredient; the entry lists additional tokens to try when
 * searching candidates. Read the PR spec — these are the only synonyms we
 * allow; do NOT grow this table with LLM suggestions.
 */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['rub', ['seasoning', 'spice', 'blend']],
  ['paste', ['puree', 'concentrate']],
  ['soda', ['bicarbonate']],
]);

/**
 * Tokens whose appearance in a bom_line ingredient short-circuits to a
 * `house` classification (no vendor match makes sense).
 */
const HOUSE_WATER_TOKENS: ReadonlySet<string> = new Set(['water']);

/**
 * Whitelist of "flag but warn" pseudo-synonyms: pairs where the two
 * ingredients LOOK similar but are NOT substitutable. Format:
 *   bom token → [ (candidate token, warning) ]
 * A candidate whose name contains the warning token against a bom-line
 * with the bom token is kept at confidence 'low' with the warning spliced
 * into its reason so the operator sees it and can reject.
 */
const NOT_EQUIVALENT_FLAGS: ReadonlyMap<string, readonly [string, string][]> = new Map([
  ['soda', [['baking powder', 'baking soda ≠ baking powder; NOT a real substitute']]],
]);

/** Heuristic: a bom-line ingredient like "lariat X" is a house blend. */
const HOUSE_BRAND_PREFIXES: readonly string[] = ['lariat '];

// ── Tokenization ───────────────────────────────────────────────────

/**
 * Normalize an ingredient string to a canonical lowercase form with
 * punctuation collapsed to single spaces. Used for exact-match lookup
 * and for whole-word scoring.
 */
export function normalizeIngredient(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tokenize an ingredient string: lowercase, collapse non-alnum to space,
 * split, drop fillers, cheap plural strip (trailing -s on len >= 4),
 * de-duplicate preserving order. Tokens < 2 chars dropped.
 */
export function tokenizeIngredient(s: string | null | undefined): string[] {
  if (!s) return [];
  const words = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    if (FILLER_WORDS.has(raw)) continue;
    if (raw.length < 2) continue;
    const stem = raw.length >= 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (!seen.has(stem)) {
      seen.add(stem);
      out.push(stem);
    }
  }
  return out;
}

/**
 * Pre-split a source string into whole-alnum-word set for fast whole-word
 * scoring.
 */
function wordSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean),
  );
}

// ── Scoring ────────────────────────────────────────────────────────

function confidenceRank(c: MatchConfidence): number {
  return c === 'high' ? 0 : c === 'medium' ? 1 : c === 'low' ? 2 : 3;
}

function sourceRank(s: CandidateSource): number {
  return s === 'recipe' ? 0 : s === 'vendor_prices' ? 1 : s === 'order_guide' ? 2 : 3;
}

/**
 * Score a single (bom tokens, candidate) pair. Returns a RankedCandidate
 * or null if the candidate doesn't match at all.
 *
 * Rules:
 *   - Exact normalized match on the full ingredient string → 'high'.
 *   - All bom tokens appear as whole words in candidate → 'medium'.
 *   - Any bom token appears as whole word → 'medium' (if only 1 token).
 *   - Any bom token substring-hits candidate → 'low'.
 *   - Synonym token hits candidate as whole word → 'medium'; as substring → 'low'.
 *
 * Order guide candidates are demoted by one step (medium → low, high → medium)
 * to reflect the lower-trust placeholder-price issue noted in the option-5 work.
 */
function scoreCandidate(
  bomIngredient: string,
  bomTokens: readonly string[],
  candidate: Candidate,
): RankedCandidate | null {
  const normBom = normalizeIngredient(bomIngredient);
  const normCand = normalizeIngredient(candidate.name);
  if (!normBom || !normCand) return null;

  // Exact match (high)
  if (normBom === normCand) {
    return demoteIfOrderGuide({
      ...candidate,
      confidence: 'high',
      reason: `exact match on "${candidate.name}"`,
    });
  }

  const candWords = wordSet(candidate.name);
  const candLower = candidate.name.toLowerCase();

  // All-token whole-word match (medium)
  const realTokens = bomTokens.filter((t) => t.length >= MIN_TOKEN_LEN);
  if (realTokens.length > 0 && realTokens.every((t) => candWords.has(t))) {
    return demoteIfOrderGuide({
      ...candidate,
      confidence: 'medium',
      reason: `whole-word match on all tokens: [${realTokens.join(', ')}]`,
    });
  }

  // Any-token whole-word match (medium for single-token bom, low for multi)
  const wholeHit = realTokens.find((t) => candWords.has(t));
  if (wholeHit) {
    const conf: MatchConfidence = realTokens.length === 1 ? 'medium' : 'low';
    return demoteIfOrderGuide({
      ...candidate,
      confidence: conf,
      reason: `whole-word match on token "${wholeHit}"`,
    });
  }

  // Partial substring match (low)
  const subHit = realTokens.find((t) => candLower.includes(t));
  if (subHit) {
    return demoteIfOrderGuide({
      ...candidate,
      confidence: 'low',
      reason: `substring match on token "${subHit}"`,
    });
  }

  return null;
}

/**
 * Try to score a candidate via the synonym table. A synonym match is
 * independently scored and merged in after the primary pass.
 */
function scoreCandidateViaSynonyms(
  bomTokens: readonly string[],
  candidate: Candidate,
): RankedCandidate | null {
  const candWords = wordSet(candidate.name);
  const candLower = candidate.name.toLowerCase();
  for (const tok of bomTokens) {
    const syns = SYNONYMS.get(tok);
    if (!syns) continue;
    for (const syn of syns) {
      if (syn.length < MIN_TOKEN_LEN) continue;
      if (candWords.has(syn)) {
        return demoteIfOrderGuide({
          ...candidate,
          confidence: 'medium',
          reason: `synonym match: "${tok}" → "${syn}" whole-word in candidate`,
        });
      }
      if (candLower.includes(syn)) {
        return demoteIfOrderGuide({
          ...candidate,
          confidence: 'low',
          reason: `synonym match: "${tok}" → "${syn}" substring in candidate`,
        });
      }
    }
  }
  return null;
}

/**
 * Apply the NOT_EQUIVALENT_FLAGS to a candidate: if the bom has a token
 * in the flag map and the candidate NAME contains a flagged not-equivalent
 * phrase, force confidence 'low' and splice the warning into the reason.
 */
function applyNotEquivalentFlag(
  bomTokens: readonly string[],
  ranked: RankedCandidate,
): RankedCandidate {
  const candLower = ranked.name.toLowerCase();
  for (const tok of bomTokens) {
    const flags = NOT_EQUIVALENT_FLAGS.get(tok);
    if (!flags) continue;
    for (const [badPhrase, warning] of flags) {
      if (candLower.includes(badPhrase)) {
        return {
          ...ranked,
          confidence: 'low',
          reason: `${ranked.reason}; WARNING: ${warning}`,
        };
      }
    }
  }
  return ranked;
}

/**
 * Demote order_guide candidates one notch to reflect lower trust.
 * high → medium, medium → low, low → low.
 */
function demoteIfOrderGuide(r: RankedCandidate): RankedCandidate {
  if (r.source !== 'order_guide') return r;
  const demoted: MatchConfidence =
    r.confidence === 'high' ? 'medium' : r.confidence === 'medium' ? 'low' : 'low';
  if (demoted === r.confidence) return r;
  return {
    ...r,
    confidence: demoted,
    reason: `${r.reason}; demoted from ${r.confidence} (order_guide: placeholder-price risk)`,
  };
}

// ── Orchestration ──────────────────────────────────────────────────

/**
 * Return the best candidate per (source, normalized-name) key. When a
 * candidate is seen twice (e.g. matched via primary scoring and again via
 * synonyms), keep the higher-confidence entry.
 */
function dedupeCandidates(ranked: readonly RankedCandidate[]): RankedCandidate[] {
  const byKey = new Map<string, RankedCandidate>();
  for (const c of ranked) {
    const key = `${c.source}:${normalizeIngredient(c.name)}:${c.vendor}`;
    const prev = byKey.get(key);
    if (!prev || confidenceRank(c.confidence) < confidenceRank(prev.confidence)) {
      byKey.set(key, c);
    }
  }
  return [...byKey.values()];
}

/**
 * Sort candidates: high > medium > low, then recipe > vendor_prices >
 * order_guide, then unit_price asc (cheaper first), then name asc.
 */
function sortCandidates(ranked: readonly RankedCandidate[]): RankedCandidate[] {
  return [...ranked].sort((a, b) => {
    const cr = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (cr !== 0) return cr;
    const sr = sourceRank(a.source) - sourceRank(b.source);
    if (sr !== 0) return sr;
    const ap = a.unit_price ?? Number.POSITIVE_INFINITY;
    const bp = b.unit_price ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Special-case pre-check. Returns a fully-populated ProposalResult when
 * the row qualifies for an early classification (house water, existing
 * house-recipe slug, "lariat X" pattern). Returns null otherwise and the
 * caller runs the normal matching pipeline.
 */
function specialCase(
  row: BomLineInput,
  sources: ProposalSources,
): ProposalResult | null {
  const bomTokens = tokenizeIngredient(row.ingredient);

  // 1. water → house
  const hasWaterToken = bomTokens.some((t) => HOUSE_WATER_TOKENS.has(t));
  if (hasWaterToken) {
    return {
      row,
      classification: 'house',
      candidates: [
        {
          source: 'none',
          name: '',
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'none',
          reason: 'house tap — no vendor mapping',
        },
      ],
      note: 'house tap — no vendor mapping',
    };
  }

  // 2. Existing recipe-slug match (authoritative). Convert the bom
  //    ingredient to a snake_case slug and check recipes.
  const slugCandidate = normalizeIngredient(row.ingredient).replace(/\s+/g, '_');
  const slugSet = new Set(sources.recipeSlugs.map((s) => s.toLowerCase()));
  if (slugCandidate && slugSet.has(slugCandidate)) {
    return {
      row,
      classification: 'matched_house_recipe',
      candidates: [
        {
          source: 'recipe',
          name: slugCandidate,
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'high',
          reason: `bom ingredient "${row.ingredient}" matches existing recipe slug "${slugCandidate}"`,
        },
      ],
      note: `existing house sub-recipe "${slugCandidate}" — wire as component_type=recipe`,
    };
  }

  // 3. "lariat X" blend with no existing slug → needs_house_recipe.
  const normLower = (row.ingredient || '').toLowerCase().trim();
  if (HOUSE_BRAND_PREFIXES.some((pfx) => normLower.startsWith(pfx))) {
    return {
      row,
      classification: 'needs_house_recipe',
      candidates: [
        {
          source: 'none',
          name: '',
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'none',
          reason: `proprietary house blend "${row.ingredient}" — create sub-recipe`,
        },
      ],
      note: `proprietary house blend "${row.ingredient}" — create sub-recipe`,
    };
  }

  return null;
}

/**
 * Core API. Given a bom_line row and a set of candidate sources, return
 * a classification + ranked candidate list.
 */
export function proposeVendorMatchesForBom(
  row: BomLineInput,
  sources: ProposalSources,
  opts: ProposeOptions = {},
): ProposalResult {
  const maxCandidates = opts.maxCandidatesPerRow ?? DEFAULT_MAX_CANDIDATES;

  const special = specialCase(row, sources);
  if (special) return special;

  const bomTokens = tokenizeIngredient(row.ingredient);

  const ranked: RankedCandidate[] = [];

  for (const c of sources.vendorPrices) {
    const m = scoreCandidate(row.ingredient, bomTokens, c);
    if (m) ranked.push(applyNotEquivalentFlag(bomTokens, m));
  }
  for (const c of sources.orderGuide) {
    const m = scoreCandidate(row.ingredient, bomTokens, c);
    if (m) ranked.push(applyNotEquivalentFlag(bomTokens, m));
  }
  for (const c of [...sources.vendorPrices, ...sources.orderGuide]) {
    const m = scoreCandidateViaSynonyms(bomTokens, c);
    if (m) ranked.push(applyNotEquivalentFlag(bomTokens, m));
  }

  let candidates = sortCandidates(dedupeCandidates(ranked));

  // Noise reduction: if we have a 'high' or 'medium' candidate from a real
  // source (vendor_prices or recipe), drop unflagged 'low' candidates —
  // they're almost always substring-artifact noise (e.g. "paste" matching
  // inside "pasteurized"). Keep 'low' candidates that carry a
  // NOT-equivalent warning, because the operator needs to SEE the warning
  // even when there's a high match. (The operator needs to know that the
  // warning was considered and rejected.)
  const hasStrong = candidates.some(
    (c) =>
      (c.confidence === 'high' || c.confidence === 'medium') &&
      (c.source === 'vendor_prices' || c.source === 'recipe'),
  );
  if (hasStrong) {
    candidates = candidates.filter(
      (c) => c.confidence !== 'low' || /NOT a real substitute/i.test(c.reason),
    );
  }

  candidates = candidates.slice(0, maxCandidates);

  // Decide classification. A row with 0 candidates OR only 'low' flagged
  // not-equivalent candidates is 'manual'.
  const hasReal = candidates.some(
    (c) =>
      c.confidence !== 'none' &&
      !/NOT a real substitute/i.test(c.reason),
  );
  const classification: BomClassification = hasReal ? 'matched' : 'manual';

  if (classification === 'manual' && candidates.length === 0) {
    // Emit the sentinel "none" row so downstream CSV has 1 row for it.
    return {
      row,
      classification,
      candidates: [
        {
          source: 'none',
          name: '',
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'none',
          reason: 'no candidate ≥ low confidence found — manual review required',
        },
      ],
      note: 'no candidates found in vendor_prices or order_guide_items',
    };
  }

  const topConf = candidates[0]?.confidence ?? 'none';
  const note =
    classification === 'matched'
      ? `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} (top: ${topConf})`
      : 'only flagged-not-equivalent candidates; manual review required';

  return { row, classification, candidates, note };
}

// Internal exports for tests.
export const __internal = {
  FILLER_WORDS,
  SYNONYMS,
  NOT_EQUIVALENT_FLAGS,
  HOUSE_WATER_TOKENS,
  HOUSE_BRAND_PREFIXES,
  normalizeIngredient,
  tokenizeIngredient,
};
