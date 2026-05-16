// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRecipeBySlug } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { getDb } from '../../../lib/db';
import { getRecipePrepHistory } from '../../../lib/beoPrepHistory';
import RecipeScaler from './RecipeScaler.jsx';
import PreviouslyPlatedAs from './PreviouslyPlatedAs.jsx';
import RecipePhotoStrip from './RecipePhotoStrip.jsx';

export default async function RecipeDetail({ params, searchParams }) {
  const { slug } = await params;
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
  return (
    <div className="recipe-detail">
      <Link href={`/recipes${locQ}`} style={{ color:'var(--muted)', fontSize:13 }}>← All recipes</Link>
      <h1>{recipe.name}</h1>
      {recipe.allergens && recipe.allergens.length > 0 && (
        <div className="recipe-allergens" style={{ marginBottom: 18 }}>
          {recipe.allergens.map(a => <span key={a} className="allergen-tag">{a}</span>)}
        </div>
      )}
      <RecipePhotoStrip slug={slug} />
      <RecipeScaler ingredients={recipe.ingredients || []} />
      {(recipe.procedure && recipe.procedure.length > 0) && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 28, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--muted)' }}>Procedure</h2>
          <div className="procedure">
            {recipe.procedure.map((p, i) => <div key={i}>{p}</div>)}
          </div>
        </>
      )}
      <PreviouslyPlatedAs recipeName={recipe.name} history={prepHistory} />
    </div>
  );
}
