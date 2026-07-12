// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// plus one real bug fix — see the `procedureLines` comment below.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRecipeBySlug } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { getDb } from '../../../lib/db';
import { getRecipePrepHistory } from '../../../lib/beoPrepHistory';
import RecipeScaler from './RecipeScaler.jsx';
import PreviouslyPlatedAs from './PreviouslyPlatedAs.jsx';
import RecipePhotoStrip from './RecipePhotoStrip.jsx';

/**
 * Next 15 route context: `params`/`searchParams` may be promises (async
 * dynamic APIs). Same shape as app/shows/[id]/stage/page.jsx's PageProps.
 * @typedef {{
 *   params: Promise<{ slug?: string }> | { slug?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} PageProps
 */

/**
 * `recipe.procedure` mixes shapes across data/cache/recipes.json: most
 * entries store a step-by-step array, but a handful of legacy imports
 * store one prose string instead (app/api/recipes/[slug]/route.js's
 * write-side comment: "recipes.json mixes both shapes" — that route
 * even derives both fields on save for this exact reason). Treating
 * `recipe.procedure` as an array unconditionally (`.length` / `.map`)
 * threw `TypeError: recipe.procedure.map is not a function` and 500'd
 * this page for every string-shaped recipe — verified against the live
 * cache: green_salt, roasted_chicken_leg, roasted_root_veg, and
 * breakfast_burrito (4 of 77 recipes in data/cache/recipes.json).
 * Normalize once here; a bare string renders as its own single line,
 * matching the write side's `procedures: [procedures]` wrap for the
 * same case.
 * @param {unknown} procedure
 * @returns {string[]}
 */
function procedureLines(procedure) {
  if (Array.isArray(procedure)) {
    return procedure.filter((p) => typeof p === 'string' && p.trim().length > 0);
  }
  if (typeof procedure === 'string' && procedure.trim().length > 0) {
    return [procedure];
  }
  return [];
}

/** @param {PageProps} props */
export default async function RecipeDetail({ params, searchParams }) {
  const p = (await params) || {};
  // Next guarantees the [slug] segment exists on a matched dynamic
  // route — the optional-key PageProps typing (matching the Next 15
  // typegen for async params) is the only reason it's `| undefined`.
  // Same convention as app/api/recipes/[slug]/photos/route.js.
  const slug = /** @type {string} */ (p.slug);
  const sp = (await searchParams) || {};
  const recipe = getRecipeBySlug(slug);
  if (!recipe) notFound();
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  // Prefetch on the server so we never need a public API endpoint —
  // `client` is dropped before the props cross to the client bundle so
  // catering customer names stay PIN-gated (the BEO endpoint serves the
  // full row to managers).
  /** @type {Pick<import('../../../lib/beoPrepHistory.ts').RecipePrepHistoryRow, 'item' | 'event_date' | 'amount_qty' | 'prep_day' | 'pre_prep_notes' | 'plating_notes'>[]} */
  let prepHistory = [];
  try {
    const db = getDb();
    prepHistory = getRecipePrepHistory(db, loc, recipe.name).map((r) => ({
      item: r.item,
      event_date: r.event_date,
      amount_qty: r.amount_qty,
      prep_day: r.prep_day,
      pre_prep_notes: r.pre_prep_notes,
      plating_notes: r.plating_notes,
    }));
  } catch (err) {
    console.error('recipes prep-history prefetch failed:', err);
  }
  const procedure = procedureLines(recipe.procedure);
  return (
    <div className="recipe-detail">
      <Link href={`/recipes${locQ}`} style={{ color:'var(--muted)', fontSize:13 }}>← All recipes</Link>
      <h1>{recipe.name}</h1>
      {recipe.allergens && recipe.allergens.length > 0 && (
        <div className="recipe-allergens" style={{ marginBottom: 18 }}>
          {recipe.allergens.map(a => <span key={a} className="allergen-tag">{a}</span>)}
        </div>
      )}
      <RecipePhotoStrip slug={slug} loc={loc} />
      <RecipeScaler ingredients={recipe.ingredients || []} />
      {procedure.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 28, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--muted)' }}>Procedure</h2>
          <div className="procedure">
            {procedure.map((step, i) => <div key={i}>{step}</div>)}
          </div>
        </>
      )}
      <PreviouslyPlatedAs recipeName={recipe.name} history={prepHistory} />
    </div>
  );
}
