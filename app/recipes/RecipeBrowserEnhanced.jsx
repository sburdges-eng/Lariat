// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

/**
 * The Lariat Cookbook — main recipes browser.
 *
 * Design language follows the 2026-05-13 LaRiOS drop:
 *   - Instrument Serif display, Inter Tight body, JetBrains Mono metadata
 *   - Paper-stack background (--bone / --paper / --cream)
 *   - Ember accent on hover + active filter chip
 *   - Allergen pills, photo thumbnails, category sections
 *
 * Photos: the server pre-resolves the newest photo id per recipe and
 * passes it down as `photo_id`. The card renders the raw image via
 * `/api/recipes/[slug]/photos/[id]/raw`. No per-card fetch fan-out.
 *
 * Role + sign-out flow is preserved verbatim from the prior browser —
 * only the visual treatment changed.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useRole } from '../_components/RoleProvider';

const CATEGORY_ORDER = [
  'appetizer',
  'entree',
  'side',
  'sauce',
  'dressing',
  'seasoning',
  'prep',
  'dessert',
];

function categoryLabel(c) {
  if (!c) return 'Uncategorized';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export default function RecipeBrowserEnhanced({ recipes }) {
  const { canEditRecipes } = useRole();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAllergen, setFilterAllergen] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const allAllergens = useMemo(() => {
    const seen = new Set();
    recipes.forEach((r) => (r.allergens || []).forEach((a) => seen.add(a)));
    return Array.from(seen).sort();
  }, [recipes]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return recipes.filter((r) => {
      const matchSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.ingredients_text && r.ingredients_text.includes(q));
      const matchAllergen =
        !filterAllergen || (r.allergens || []).includes(filterAllergen);
      return matchSearch && matchAllergen;
    });
  }, [recipes, searchTerm, filterAllergen]);

  // Group by category, ordered by CATEGORY_ORDER then alpha for unknowns.
  const grouped = useMemo(() => {
    const buckets = new Map();
    filtered.forEach((r) => {
      const key = r.category || '_unknown';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    });
    const known = CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => [
      c,
      buckets.get(c),
    ]);
    const extras = [...buckets.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort();
    return [...known, ...extras.map((c) => [c, buckets.get(c)])];
  }, [filtered]);

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

  const recipeLink = (slug) =>
    canEditRecipes ? `/recipes/${slug}/edit` : `/recipes/${slug}`;

  return (
    <div className="cookbook">
      {/* ─── Header ───────────────────────────────────────── */}
      <header className="cookbook-head">
        <div className="cookbook-eyebrow">
          <span>Recipe Book</span>
          <span aria-hidden="true">·</span>
          <span>{recipes.length} on file</span>
        </div>
        <h1 className="cookbook-title">
          The <em>Lariat</em> Cookbook
        </h1>
        <p className="cookbook-lede">
          Every recipe, scaled, allergen-tagged, and ready for the line.
          Search by name or ingredient; tap a card to open the build.
        </p>
        {canEditRecipes ? (
          <div className="cookbook-mode cookbook-mode--mgmt">
            <span className="cookbook-mode-dot" aria-hidden="true" />
            <span className="cookbook-mode-label">Management mode</span>
            <span className="cookbook-mode-sub">
              Cards open straight to the editor.
            </span>
            <button
              type="button"
              className="cookbook-mode-out"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <div className="cookbook-mode">
            <span className="cookbook-mode-label">Staff mode</span>
            <span className="cookbook-mode-sub">
              <Link href="/recipes/management-pin">Unlock</Link> to edit
              recipes or view costs.
            </span>
          </div>
        )}
      </header>

      {/* ─── Controls ─────────────────────────────────────── */}
      <section className="cookbook-controls" aria-label="Search and filter">
        <div className="cookbook-search">
          <label className="cookbook-label" htmlFor="cookbook-search-input">
            Search
          </label>
          <input
            id="cookbook-search-input"
            type="text"
            placeholder="Recipe name or ingredient…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoComplete="off"
          />
        </div>
        {allAllergens.length > 0 && (
          <div className="cookbook-allergens" role="group" aria-label="Allergen filter">
            <span className="cookbook-label">Allergen</span>
            <div className="cookbook-chip-row">
              <button
                type="button"
                className={`cookbook-chip ${!filterAllergen ? 'is-active' : ''}`}
                onClick={() => setFilterAllergen('')}
              >
                All
              </button>
              {allAllergens.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`cookbook-chip ${filterAllergen === a ? 'is-active' : ''}`}
                  onClick={() => setFilterAllergen(filterAllergen === a ? '' : a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ─── Sections ─────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="cookbook-empty">
          <p>No recipes match your search.</p>
        </div>
      ) : (
        grouped.map(([cat, list]) => (
          <section key={cat} className="cookbook-section">
            <div className="cookbook-section-head">
              <h2 className="cookbook-section-title">{categoryLabel(cat)}</h2>
              <span className="cookbook-section-count">
                {list.length}
              </span>
            </div>
            <div className="cookbook-grid">
              {list.map((recipe) => (
                <Link
                  key={recipe.slug}
                  href={recipeLink(recipe.slug)}
                  className="cookbook-card"
                >
                  <div
                    className={`cookbook-card-photo ${recipe.photo_id ? '' : 'is-placeholder'}`}
                    aria-hidden={recipe.photo_id ? undefined : 'true'}
                  >
                    {recipe.photo_id ? (
                      <img
                        src={`/api/recipes/${recipe.slug}/photos/${recipe.photo_id}/raw`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="cookbook-card-placeholder">
                        {recipe.name.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="cookbook-card-body">
                    <h3 className="cookbook-card-name">{recipe.name}</h3>
                    <div className="cookbook-card-meta">
                      <span>{recipe.ingredient_count} ingredients</span>
                      {recipe.yield_qty && recipe.yield_unit && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            yields {recipe.yield_qty} {recipe.yield_unit}
                          </span>
                        </>
                      )}
                    </div>
                    {recipe.allergens && recipe.allergens.length > 0 && (
                      <ul className="cookbook-card-allergens">
                        {recipe.allergens.slice(0, 4).map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                        {recipe.allergens.length > 4 && (
                          <li className="cookbook-card-more">
                            +{recipe.allergens.length - 4}
                          </li>
                        )}
                      </ul>
                    )}
                    {canEditRecipes && (
                      <div className="cookbook-card-edit">
                        Edit recipe →
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
