import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRecipeBySlug } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import RecipeScaler from './RecipeScaler.jsx';

export default function RecipeDetail({ params, searchParams }) {
  const recipe = getRecipeBySlug(params.slug);
  if (!recipe) notFound();
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
  return (
    <div className="recipe-detail">
      <Link href={`/recipes${locQ}`} style={{ color:'var(--muted)', fontSize:13 }}>← All recipes</Link>
      <h1>{recipe.name}</h1>
      {recipe.allergens && recipe.allergens.length > 0 && (
        <div className="recipe-allergens" style={{ marginBottom: 18 }}>
          {recipe.allergens.map(a => <span key={a} className="allergen-tag">{a}</span>)}
        </div>
      )}
      <RecipeScaler ingredients={recipe.ingredients || []} />
      {(recipe.procedure && recipe.procedure.length > 0) && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 28, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--muted)' }}>Procedure</h2>
          <div className="procedure">
            {recipe.procedure.map((p, i) => <div key={i}>{p}</div>)}
          </div>
        </>
      )}
    </div>
  );
}
