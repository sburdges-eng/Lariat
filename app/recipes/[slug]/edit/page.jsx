// @ts-check
'use client';

import { useRole } from '../../../_components/RoleProvider';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';
import RecipeEditForm from './RecipeEditForm.jsx';

/**
 * Client Component page — Next 15 still supplies `params` as a Promise
 * here (unwrapped via React's `use()`), matching the async dynamic APIs
 * contract used by the Server Component pages in this repo.
 * @param {{ params: Promise<{ slug: string }> }} props
 */
export default function RecipeEditPage({ params }) {
  const { slug } = use(params);
  const { canEditRecipes, isLoading } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !canEditRecipes) {
      router.push(`/recipes/${slug}`);
    }
  }, [canEditRecipes, isLoading, slug, router]);

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>;
  }

  if (!canEditRecipes) {
    return null;
  }

  return (
    <div>
      <h1>Edit recipe</h1>
      <p className="subtitle">Modify recipe details, ingredients, and allergen information.</p>
      <RecipeEditForm slug={slug} />
    </div>
  );
}
