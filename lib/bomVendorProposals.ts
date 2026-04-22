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

// ── plan_restaurant_grind (Option 7) ──────────────────────────────
//
// Restaurant-grind rows describe an ingredient the BOH grinds on site
// (e.g. whole peppercorns → cracked black pepper, whole nutmeg → grated).
// The bom_line ingredient is the FINISHED form ("pepper"), but the
// purchasing cost should trace to the RAW input the restaurant buys
// (whole peppercorns, or — if no whole form is carried by the vendor —
// the least-processed bulk form available).
//
// Output of `matchRawCutForGrind` is a ranked list of candidate raw-cut
// SKUs from vendor_prices. It is independent of the primary
// `proposeVendorMatchesForBom` pipeline: this helper does NOT apply
// demotion or NOT-equivalent flagging, because raw-cut matches are about
// purchasing substitution, not recipe substitution.
//
// Confidence tiers for raw-cut matching:
//   - `high`   — candidate name contains the bom token AND a raw-cut
//                keyword (whole, whl, bulk, peppercorn, etc.)
//   - `medium` — candidate name contains the bom token AND a bulk-form
//                keyword (bulk, coarse, cracked) — "not whole but still
//                a precursor to finer grind"
//   - `low`    — candidate name contains the bom token only (finished
//                or pre-ground form; last-resort fallback)
//   - `none`   — no candidate contains the bom token
//
// Variety-discriminator penalty: candidates whose name includes a
// variety-specific token that the bom ingredient does NOT carry
// (e.g. bom "pepper" vs candidate "PEPPER, RED WHL FIRE RSTD") are
// demoted one tier. This prevents the pepper-vs-bell-pepper false
// positive while still surfacing them for operator visibility.

/** Raw-cut keywords: explicit "unprocessed" signal. */
const RAW_CUT_KEYWORDS: ReadonlySet<string> = new Set([
  'whole',
  'whl',
  'peppercorn',
  'peppercorns',
  'fresh',
  'raw',
]);

/** Bulk-form keywords: semi-processed but still a viable grind input. */
const BULK_FORM_KEYWORDS: ReadonlySet<string> = new Set([
  'bulk',
  'coarse',
  'crse',
  'cracked',
]);

/**
 * Tokens in a bom_line ingredient that are too generic to anchor raw-cut
 * matching (would otherwise match half the catalog). "pepper" is NOT in
 * here — we want every SPICE, PEPPER BLK row to surface.
 */
const RAW_CUT_NOISE_TOKENS: ReadonlySet<string> = new Set([
  'ground',
  'grind',
]);

/**
 * Variety-discriminator tokens: if a candidate contains one of these AND
 * the bom_line ingredient does NOT, the candidate is probably a DIFFERENT
 * variety of the same base ingredient (e.g. "PEPPER, RED WHL FIRE RSTD"
 * vs bom "pepper" — the red-whole-roasted is a vegetable, not black pepper).
 * Adds a penalty that demotes the candidate one confidence tier.
 *
 * Only consulted when the bom_line ingredient is missing the same token.
 * Example: bom "red pepper" vs candidate "PEPPER, RED WHL" → no penalty
 * (both carry "red"). Bom "pepper" vs candidate "PEPPER, RED WHL" → penalty.
 */
const VARIETY_DISCRIMINATOR_TOKENS: ReadonlySet<string> = new Set([
  // Pepper varieties (when bom is plain "pepper", these names imply a
  // specific non-default variety; bom "cayenne pepper" would NOT be
  // penalized because the bom itself carries "cayenne").
  'red',
  'green',
  'chile',
  'chili',
  'calabrian',
  'chipotle',
  'jalp',
  'jalapeno',
  'habanero',
  'serrano',
  'poblano',
  'guajillo',
  'ancho',
  'hatch',
  'bell',
  'cayenne',
  // Form/treatment that implies a different product
  'roasted',
  'rstd',
  'diced',
  'dried',
  'powder',
  'pld',
  'crushed',
  'crsh',
  'stemless',
  'stmls',
  'adobo',
  // Cheese/meat/other cross-product tokens that could false-match
  'cheese',
  'jack',
]);

/**
 * A specializer token in the candidate that is ALSO present in the bom
 * ingredient is not a discriminator — both sides share it, so it's a
 * positive signal. This helper returns the set of candidate tokens that
 * are VARIETY_DISCRIMINATOR_TOKENS and are NOT in the bom token set.
 */
function variantDiscriminatorsOnlyInCandidate(
  bomTokens: ReadonlySet<string>,
  candWords: Set<string>,
): string[] {
  const out: string[] = [];
  for (const w of candWords) {
    if (VARIETY_DISCRIMINATOR_TOKENS.has(w) && !bomTokens.has(w)) out.push(w);
  }
  return out;
}

/** Demote a confidence by one step. high → medium → low → low. */
function demoteOneStep(c: MatchConfidence): MatchConfidence {
  return c === 'high' ? 'medium' : c === 'medium' ? 'low' : 'low';
}

/**
 * Match raw-cut vendor candidates for a plan_restaurant_grind bom_line.
 *
 * The bom ingredient (e.g. "pepper", "ground beef 80/20") is the finished
 * product. We walk vendor_prices looking for candidates whose name
 * contains the primary bom tokens. Candidates with "whole/whl/peppercorn"
 * keywords score highest; "bulk/coarse/cracked" mid-tier; otherwise a
 * last-resort "low" (reflecting: the vendor only carries pre-processed
 * forms, so operator must either switch vendor or accept the pre-processed
 * price).
 *
 * Returns a ProposalResult with `classification='matched'` when ≥ 1
 * candidate found, else `'manual'` with a sentinel row.
 */
export function matchRawCutForGrind(
  row: BomLineInput,
  vendorCandidates: readonly Candidate[],
  opts: ProposeOptions = {},
): ProposalResult {
  const maxCandidates = opts.maxCandidatesPerRow ?? DEFAULT_MAX_CANDIDATES;

  // Restrict to meaningful tokens (drop generic noise like "ground").
  const bomTokens = tokenizeIngredient(row.ingredient).filter(
    (t) => !RAW_CUT_NOISE_TOKENS.has(t) && t.length >= MIN_TOKEN_LEN,
  );

  if (bomTokens.length === 0) {
    return {
      row,
      classification: 'manual',
      candidates: [
        {
          source: 'none',
          name: '',
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'none',
          reason: 'no usable tokens in ingredient — manual review required',
        },
      ],
      note: 'no usable tokens for raw-cut search',
    };
  }

  const ranked: { c: RankedCandidate; penalized: boolean }[] = [];
  const bomTokenSet = new Set(bomTokens);

  for (const cand of vendorCandidates) {
    const candWords = wordSet(cand.name);
    const candLower = cand.name.toLowerCase();

    // Primary anchor: at least one bom token must appear (whole-word or
    // substring). Otherwise skip — this is a grind match, not a synonym.
    const anchor = bomTokens.find(
      (t) => candWords.has(t) || candLower.includes(t),
    );
    if (!anchor) continue;

    const hasRawKw = [...candWords].some((w) => RAW_CUT_KEYWORDS.has(w));
    const hasBulkKw = [...candWords].some((w) => BULK_FORM_KEYWORDS.has(w));

    let confidence: MatchConfidence;
    let reason: string;
    if (hasRawKw) {
      confidence = 'high';
      reason = `raw-cut match on "${anchor}" (whole/raw form)`;
    } else if (hasBulkKw) {
      confidence = 'medium';
      reason = `bulk-form match on "${anchor}" (coarse/bulk precursor to finer grind)`;
    } else {
      confidence = 'low';
      reason = `finished-form match on "${anchor}" (no raw/whole variant in catalog; operator must decide whether to accept pre-processed cost or switch vendor)`;
    }

    // Variety-discriminator penalty: if the candidate carries tokens
    // that indicate a DIFFERENT variety (red pepper vs black pepper,
    // chile pepper vs black pepper, roasted vs fresh), demote one tier.
    // This is the safety net against things like bom "pepper" matching
    // high on "PEPPER, RED WHL FIRE RSTD IMP".
    const varietyDiscriminators = variantDiscriminatorsOnlyInCandidate(
      bomTokenSet,
      candWords,
    );
    const penalized = varietyDiscriminators.length > 0;
    if (penalized) {
      const demoted = demoteOneStep(confidence);
      if (demoted !== confidence) {
        reason = `${reason}; variety-discriminator penalty on [${varietyDiscriminators.join(', ')}] (likely a DIFFERENT variety, not a raw-cut of the same ingredient)`;
        confidence = demoted;
      } else {
        reason = `${reason}; variety-discriminator flag on [${varietyDiscriminators.join(', ')}] (likely a DIFFERENT variety; already at low confidence)`;
      }
    }

    ranked.push({ c: { ...cand, confidence, reason }, penalized });
  }

  // Dedupe by (source, normalized-name, vendor), keeping the
  // higher-confidence / non-penalized row when duplicates appear.
  const byKey = new Map<string, { c: RankedCandidate; penalized: boolean }>();
  for (const entry of ranked) {
    const key = `${entry.c.source}:${normalizeIngredient(entry.c.name)}:${entry.c.vendor}`;
    const prev = byKey.get(key);
    if (
      !prev ||
      confidenceRank(entry.c.confidence) < confidenceRank(prev.c.confidence) ||
      (entry.c.confidence === prev.c.confidence && !entry.penalized && prev.penalized)
    ) {
      byKey.set(key, entry);
    }
  }

  // Sort: confidence asc (high first) → non-penalized before penalized
  // → source rank (recipe > vendor_prices > order_guide) → price asc →
  // name asc. The penalized-ordering key is what prevents a cheap
  // variety-penalized candidate (e.g. red bell peppers at $0.11/oz)
  // from out-ranking a real bulk black-pepper SKU (e.g. $15.99/lb).
  const sortedEntries = [...byKey.values()].sort((a, b) => {
    const cr = confidenceRank(a.c.confidence) - confidenceRank(b.c.confidence);
    if (cr !== 0) return cr;
    const pr = (a.penalized ? 1 : 0) - (b.penalized ? 1 : 0);
    if (pr !== 0) return pr;
    const sr = sourceRank(a.c.source) - sourceRank(b.c.source);
    if (sr !== 0) return sr;
    const ap = a.c.unit_price ?? Number.POSITIVE_INFINITY;
    const bp = b.c.unit_price ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return a.c.name.localeCompare(b.c.name);
  });

  const sorted = sortedEntries.slice(0, maxCandidates).map((e) => e.c);

  if (sorted.length === 0) {
    return {
      row,
      classification: 'manual',
      candidates: [
        {
          source: 'none',
          name: '',
          vendor: '',
          pack_unit: '',
          unit_price: null,
          confidence: 'none',
          reason: `no vendor row contains token [${bomTokens.join(', ')}] — manual review required`,
        },
      ],
      note: 'no raw-cut candidates found',
    };
  }

  const top = sorted[0];
  const note =
    top.confidence === 'high'
      ? `${sorted.length} raw-cut candidate${sorted.length === 1 ? '' : 's'} (top: ${top.confidence}, whole/raw form available)`
      : top.confidence === 'medium'
        ? `${sorted.length} bulk-form candidate${sorted.length === 1 ? '' : 's'} (top: ${top.confidence}, no whole form in catalog)`
        : `${sorted.length} finished-form candidate${sorted.length === 1 ? '' : 's'} only (top: ${top.confidence}); vendor carries no raw input for this ingredient`;

  return { row, classification: 'matched', candidates: sorted, note };
}

// Internal exports for tests.
export const __internal = {
  FILLER_WORDS,
  SYNONYMS,
  NOT_EQUIVALENT_FLAGS,
  HOUSE_WATER_TOKENS,
  HOUSE_BRAND_PREFIXES,
  RAW_CUT_KEYWORDS,
  BULK_FORM_KEYWORDS,
  RAW_CUT_NOISE_TOKENS,
  VARIETY_DISCRIMINATOR_TOKENS,
  normalizeIngredient,
  tokenizeIngredient,
};
