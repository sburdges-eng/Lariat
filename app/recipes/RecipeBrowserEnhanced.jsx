// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import Link from 'next/link';
import { useRole } from '../_components/RoleProvider';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';

export default function RecipeBrowserEnhanced({ recipes }) {
  const { canEditRecipes } = useRole();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAllergen, setFilterAllergen] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const allAllergens = useMemo(() => {
    const seen = new Set();
    recipes.forEach(r => {
      (r.allergens || []).forEach(a => seen.add(a));
    });
    return Array.from(seen).sort();
  }, [recipes]);

  const filtered = useMemo(() => {
    return recipes.filter(r => {
      const matchesSearch =
        !searchTerm ||
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.ingredients_text && r.ingredients_text.includes(searchTerm.toLowerCase()));

      const matchesAllergen =
        !filterAllergen ||
        (r.allergens && r.allergens.includes(filterAllergen));

      return matchesSearch && matchesAllergen;
    });
  }, [recipes, searchTerm, filterAllergen]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/auth/management-pin/logout', { method: 'POST' });
      router.push('/recipes');
      router.refresh();
    } catch (e) {
      console.error('Logout failed:', e);
      setSigningOut(false);
    }
  };

  const getRecipeLink = (slug) => {
    return canEditRecipes ? `/recipes/${slug}/edit` : `/recipes/${slug}`;
  };

  return (
    <div>
      {/* Management Banner */}
      {canEditRecipes && (
        <div
          style={{
            background: 'linear-gradient(135deg, var(--ember) 0%, #9a3f1a 100%)',
            padding: '16px 20px',
            borderRadius: 8,
            marginBottom: 24,
            color: '#fff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🔓 Management Mode Active</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>You can edit recipes, update ingredients, and manage costs.</div>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 4,
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                opacity: signingOut ? 0.6 : 1,
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </div>
      )}

      {/* Staff Notice */}
      {!canEditRecipes && (
        <div
          style={{
            background: 'var(--panel-2)',
            padding: '12px 16px',
            borderRadius: 6,
            marginBottom: 24,
            borderLeft: '4px solid var(--brass)',
            fontSize: 13,
            color: 'var(--muted)',
          }}
        >
          Viewing as staff. <Link href="/recipes/management-pin" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Unlock management mode
          </Link> to edit recipes and view costs.
        </div>
      )}

      {/* Search & Filter Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 200px',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>
            Search recipes
          </label>
          <input
            type="text"
            placeholder="Recipe name or ingredient…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 14,
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>
            Filter allergen
          </label>
          <select
            value={filterAllergen}
            onChange={(e) => setFilterAllergen(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 14,
            }}
          >
            <option value="">All allergens</option>
            {allAllergens.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Recipe Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ fontSize: 14, margin: 0 }}>No recipes match your search.</p>
          </div>
        ) : (
          filtered.map(recipe => (
            <Link
              key={recipe.slug}
              href={getRecipeLink(recipe.slug)}
              style={{
                display: 'block',
                padding: 16,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                transition: 'all 0.2s',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ember)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(200,90,42,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                {recipe.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
                {recipe.ingredient_count} ingredients
                {recipe.allergens && recipe.allergens.length > 0 && (
                  <>
                    <br />
                    <span style={{ fontSize: 11 }}>
                      {recipe.allergens.join(', ')}
                    </span>
                  </>
                )}
              </div>
              {canEditRecipes && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--accent)',
                    fontWeight: 600,
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  ✎ Edit this recipe
                </div>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
