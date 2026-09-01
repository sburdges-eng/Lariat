/**
 * Deterministic pre-LLM answers for the lookups the model keeps fumbling.
 *
 * Background (2026-08-31 venue failures): the v3 model deterministically
 * DENIED an ingredient quantity sitting verbatim in its CONTEXT ("how many
 * cups of water in the green chilli" → "I don't see water", 3/3 samples),
 * guessed nonexistent slugs, and dead-ended recipe questions into db_query.
 * Root cause is training-side (WS-5's in-prose-number filter over-taught
 * quantity avoidance) and is queued for the KA v4 pass — but a cook on the
 * line needs the number NOW, and deterministic code reads a recipe card
 * perfectly every time.
 *
 * So, exactly like the Q-vs-C classifier (#248) moved routing out of the
 * prompt, this moves the bread-and-butter LOOKUPS out of the model:
 *   - "how many cups of water in the green chilli"  → the ingredient line
 *   - "quesa birria recipe" / "what's in the birria" → the recipe card
 *   - "recipe book" / "what recipes do you have"     → the station-grouped list
 * Anything that doesn't match with high confidence falls through to the LLM
 * unchanged. Allergen-intent questions ALWAYS fall through — the escalation
 * wording ("never say safe", manager nudge) is the model's regulated job.
 *
 * Native twin: LariatNative Sources/LariatModel/Compute/AssistantDirectAnswers.swift
 * — keep answer strings byte-identical.
 */

import type { Recipe } from './data';

export interface DirectSource {
  type: string;
  detail: string;
}

export interface DirectAnswer {
  answer: string;
  sources: DirectSource[];
}

/** Allergen questions must reach the LLM's trained escalation path. */
const ALLERGEN_INTENT_RE =
  /allerg|gluten|dairy|celiac|shellfish|peanut|tree ?nut|nut[- ]free|soy\b|sesame|\bsafe\b|\begg[- ]free\b/i;

const QTY_INTENT_RE = /\bhow (much|many)\b|\bwhat(?: is|'s)? the (amount|quantity)\b|\bqty\b/i;

const CARD_INTENT_RE =
  /\brecipes?\b|\bcard\b|\bingredients?\b|what'?s in\b|whats in\b|\bhow (?:do|to) (?:i |you )?(?:make|prep|build)\b|\bshow\b/i;

/**
 * Explicit retrieval phrasing ("find that…", "search for…") wants the
 * semantic-search path, not a card dump — even when a recipe name appears.
 */
const RETRIEVAL_INTENT_RE = /\b(find|search|look (?:up|for))\b/i;

const BOOK_RE =
  /recipe book|reccipe book|recipe list|list of recipes|what recipes|which recipes|all recipes|all the recipes/i;

/** Question scaffolding + measure words — never ingredient evidence. */
const STOPWORDS = new Set([
  'how', 'much', 'many', 'what', 'whats', 'the', 'a', 'an', 'in', 'of', 'on',
  'for', 'with', 'to', 'i', 'you', 'we', 'do', 'does', 'is', 'are', 'it',
  'its', 'recipe', 'recipes', 'card', 'show', 'me', 'use', 'uses', 'need',
  'needs', 'whole', 'make', 'makes', 'amount', 'quantity', 'qty', 'there',
  'and', 'please', 'hey', 'lari',
]);

const UNIT_WORDS = new Set([
  'cup', 'cups', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces',
  'qt', 'quart', 'quarts', 'gal', 'gallon', 'gallons', 'tsp', 'tbsp',
  'teaspoon', 'teaspoons', 'tablespoon', 'tablespoons', 'g', 'gram', 'grams',
  'kg', 'ml', 'l', 'liter', 'liters', 'bag', 'bags', 'can', 'cans', 'each', 'ea',
]);

/**
 * One kitchen spelling per word: chilli/chile → chili, diacritics stripped
 * (jalapeño → jalapeno). The index itself mixes all three chili spellings.
 */
export function normalizeWord(w: string): string {
  const bare = w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (bare === 'chilli' || bare === 'chile' || bare === 'chiles' || bare === 'chillis') return 'chili';
  return bare;
}

export function normalizeText(s: string): string {
  return (s || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(normalizeWord)
    .join(' ');
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return (' ' + haystack + ' ').includes(' ' + phrase + ' ');
}

interface RecipeMatch {
  recipe: Recipe;
  matchedPhrase: string;
}

/** Candidate vocabulary of one recipe: name + menu items + slug, tokenized. */
function recipeTokenVocab(r: Recipe): Set<string> {
  const vocab = new Set<string>();
  for (const c of [r.name || '', ...(r.menu_items || []), (r.slug || '').replace(/_/g, ' ')]) {
    for (const t of normalizeText(c).split(' ')) {
      if (t.length >= 4 && !STOPWORDS.has(t) && !UNIT_WORDS.has(t)) vocab.add(t);
    }
  }
  return vocab;
}

/**
 * High-precision recipe resolution. First pass: a recipe's name, menu item,
 * or slug appears whole (word-bounded, spelling-normalized) in the question;
 * longest phrase wins, ties between different recipes are ambiguity → null.
 *
 * Second pass (2026-08-31 "pico" find): a distinctive token — one that lives
 * in the candidate vocabulary of exactly ONE recipe — identifies it, so
 * "pico" finds Pico De Gallo without typing the full name. Tokens shared by
 * several recipes ("tacos") stay ambiguous and fall through to the LLM.
 */
export function findRecipe(question: string, recipes: Recipe[]): RecipeMatch | null {
  const q = normalizeText(question);
  let best: RecipeMatch | null = null;
  let bestLen = 0;
  let ambiguous = false;

  for (const r of recipes) {
    const candidates = [r.name || '', ...(r.menu_items || []), (r.slug || '').replace(/_/g, ' ')];
    for (const c of candidates) {
      const phrase = normalizeText(c);
      if (phrase.length < 4) continue;
      if (!containsPhrase(q, phrase)) continue;
      if (phrase.length > bestLen) {
        best = { recipe: r, matchedPhrase: phrase };
        bestLen = phrase.length;
        ambiguous = false;
      } else if (phrase.length === bestLen && best && best.recipe.slug !== r.slug) {
        ambiguous = true;
      }
    }
  }
  if (best || ambiguous) return ambiguous ? null : best;

  const qTokens = q.split(' ').filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !UNIT_WORDS.has(t));
  const hits = new Map<string, { recipe: Recipe; tokens: string[] }>();
  for (const t of qTokens) {
    let owner: Recipe | null = null;
    let unique = true;
    for (const r of recipes) {
      if (recipeTokenVocab(r).has(t)) {
        if (owner && owner.slug !== r.slug) { unique = false; break; }
        owner = r;
      }
    }
    if (!owner || !unique) continue;
    const key = owner.slug || owner.name || '';
    const entry = hits.get(key) || { recipe: owner, tokens: [] };
    entry.tokens.push(t);
    hits.set(key, entry);
  }
  if (hits.size === 1) {
    const only = [...hits.values()][0];
    if (only) return { recipe: only.recipe, matchedPhrase: only.tokens.join(' ') };
  }
  return null;
}

function fmtQty(qty: unknown): string {
  if (qty === null || qty === undefined || qty === '') return '';
  return String(qty);
}

function ingredientLine(i: { item?: string | null; qty?: unknown; unit?: string | null }): string {
  const qty = fmtQty(i.qty);
  const unit = (i.unit || '').trim();
  const amount = [qty, unit].filter(Boolean).join(' ');
  return amount ? `${i.item || ''} — ${amount}` : `${i.item || ''}`;
}

function yieldText(r: Recipe): string {
  const qty = fmtQty(r.yield_qty);
  const unit = (r.yield_unit || '').trim();
  const y = [qty, unit].filter(Boolean).join(' ');
  return y ? `makes ${y}` : '';
}

function headerLine(r: Recipe): string {
  const title = r.name || r.slug || 'Recipe';
  const y = yieldText(r);
  const station = (r.station || '').trim();
  const tail = [y, station].filter(Boolean).join(' · ');
  return tail ? `${title} — ${tail}` : title;
}

function tagsLine(r: Recipe): string {
  const tags = (r.allergens || []).filter(Boolean);
  return tags.length
    ? `Tags: ${tags.join(', ')}`
    : 'Tags: none listed — check with a manager.';
}

function renderCard(r: Recipe): string {
  const lines = [headerLine(r), 'Ingredients:'];
  for (const i of r.ingredients || []) lines.push(`• ${ingredientLine(i)}`);
  if ((r.sub_recipes || []).length) {
    lines.push(`Sub-recipes: ${(r.sub_recipes || []).join(', ')}`);
  }
  lines.push(tagsLine(r));
  return lines.join('\n');
}

function renderQuantity(r: Recipe, hits: Array<{ item?: string | null; qty?: unknown; unit?: string | null }>): string {
  const first = hits[0];
  if (hits.length === 1 && first) {
    const amount = ingredientLine(first);
    const y = yieldText(r);
    return y
      ? `${r.name}: ${amount} (whole recipe ${y}).`
      : `${r.name}: ${amount}.`;
  }
  const lines = [headerLine(r) + ':'];
  for (const h of hits) lines.push(`• ${ingredientLine(h)}`);
  return lines.join('\n');
}

function renderBook(recipes: Recipe[]): string {
  const byStation = new Map<string, string[]>();
  for (const r of recipes) {
    const st = (r.station || 'other').trim() || 'other';
    if (!byStation.has(st)) byStation.set(st, []);
    byStation.get(st)!.push(r.name || r.slug || '');
  }
  const lines = [`${recipes.length} recipes on file:`];
  for (const [st, names] of [...byStation.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${st.toUpperCase()}: ${names.join(', ')}`);
  }
  lines.push('Full cards live on the Reference board — or ask me for one by name.');
  return lines.join('\n');
}

/** Leftover question tokens once the recipe phrase, scaffolding, and units are removed. */
function leftoverTokens(question: string, matchedPhrase: string): string[] {
  const phraseTokens = new Set(matchedPhrase.split(' '));
  return normalizeText(question)
    .split(' ')
    .filter(Boolean)
    .filter((t) => !phraseTokens.has(t) && !STOPWORDS.has(t) && !UNIT_WORDS.has(t));
}

/**
 * The deterministic front door. Returns null whenever unsure — the LLM is
 * the fallback, never the other way around.
 */
export function tryDirectRecipeAnswer(message: unknown, recipes: Recipe[]): DirectAnswer | null {
  if (typeof message !== 'string') return null;
  const m = message.trim();
  if (!m || !recipes.length) return null;
  if (ALLERGEN_INTENT_RE.test(m)) return null;

  if (BOOK_RE.test(m)) {
    return {
      answer: renderBook(recipes),
      sources: [{ type: 'recipe_direct', detail: `recipe book (${recipes.length} recipes)` }],
    };
  }

  if (RETRIEVAL_INTENT_RE.test(m)) return null;

  const match = findRecipe(m, recipes);
  if (!match) return null;
  const { recipe, matchedPhrase } = match;
  const leftovers = leftoverTokens(m, matchedPhrase);

  if (QTY_INTENT_RE.test(m) && leftovers.length) {
    const hits = (recipe.ingredients || []).filter((i) => {
      const item = normalizeText(i.item || '');
      if (!item) return false;
      const itemTokens = new Set(item.split(' '));
      return leftovers.some((t) => itemTokens.has(t));
    });
    if (hits.length) {
      return {
        answer: renderQuantity(recipe, hits),
        sources: [{ type: 'recipe_direct', detail: `ingredient lookup: ${recipe.slug || recipe.name}` }],
      };
    }
    // Quantity asked, recipe known, ingredient genuinely absent: answer THAT
    // deterministically too — this is the truthful version of the model's
    // blanket refusal.
    return {
      answer: `${recipe.name} doesn't list ${leftovers.join(' ')} as an ingredient. Ask me for the ${recipe.name} card to see everything in it.`,
      sources: [{ type: 'recipe_direct', detail: `ingredient lookup (absent): ${recipe.slug || recipe.name}` }],
    };
  }

  // A card renders only when the question is essentially ABOUT the recipe —
  // at most one leftover token beyond the name, scaffolding, and units. More
  // than that means unmodeled intent; the LLM takes it.
  if (leftovers.length === 0 || (CARD_INTENT_RE.test(m) && leftovers.length <= 1)) {
    return {
      answer: renderCard(recipe),
      sources: [{ type: 'recipe_direct', detail: `recipe card: ${recipe.slug || recipe.name}` }],
    };
  }

  return null;
}
