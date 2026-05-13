// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useRole } from '../../../_components/RoleProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import RecipeEditForm from './RecipeEditForm.jsx';

export default function RecipeEditPage({ params }) {
  const { canEditRecipes, isLoading } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !canEditRecipes) {
      router.push(`/recipes/${params.slug}`);
    }
  }, [canEditRecipes, isLoading, params.slug, router]);

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>;
  }

  if (!canEditRecipes) {
    return null;
  }

  return (
    <div>
      <h1>Edit Recipe</h1>
      <p className="subtitle">Modify recipe details, ingredients, and allergen information.</p>
      <RecipeEditForm slug={params.slug} />
    </div>
  );
}
