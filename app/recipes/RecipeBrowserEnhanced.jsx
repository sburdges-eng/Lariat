// @ts-check
'use client';

/**
 * The Lariat Cookbook — main recipes browser.
 *
 * Design language follows the 2026-05-13 LaRiOS drop:
 *   - Zilla Slab display, Inter Tight body, JetBrains Mono metadata
 *   - Paper-stack background (--bone / --paper / --cream)
 *   - Ember accent on hover + active filter chip
 *   - Allergen pills, photo thumbnails, category sections
 *
 * Photos: the server pre-resolves the newest photo id per recipe and
 * passes it down as `photo_id`. The card renders the raw image via
 * `/api/recipes/[slug]/photos/[id]/raw`. No per-card fetch fan-out.
 *
 * Role + sign-out are wired against the real `/api/auth/pin` contract
 * (see `handleSignOut` below) — a prior version of this file called a
 * `/api/auth/management-pin/logout` path that was never a real route
 * (checkjs migration bugfix, see this file's commit message).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useRole } from '../_components/RoleProvider';
import { groupRecipesByCategory } from '../../lib/recipeCookbookGrouping';
import { recipeMatchesScope } from '../../lib/recipeScope';

/** @typedef {import('./page.jsx').RecipeCardData} RecipeCardData */

// Duplicated rather than imported from lib/location.ts — same convention
// as app/labor/breaks/BreakBoard.jsx and
// app/specials/saved/[id]/SpecialDetailClient.jsx's `locQ` (a client
// component shouldn't pull in the env-reading server module just for a
// string constant).
const DEFAULT_LOCATION_ID = 'default';

/** @param {string | null | undefined} c */
function categoryLabel(c) {
  if (!c) return 'Uncategorized';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * @param {{ recipes: RecipeCardData[], locationId?: string }} props
 */
export default function RecipeBrowserEnhanced({ recipes, locationId }) {
  const { canEditRecipes } = useRole();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAllergen, setFilterAllergen] = useState('');
  const [bookScope, setBookScope] = useState(/** @type {'book' | 'catering' | 'all'} */ ('book'));
  const [signingOut, setSigningOut] = useState(false);

  // Non-default locations must be threaded onto every link/fetch that
  // leaves this component as `?location=` — the recipe-detail page
  // (app/recipes/[slug]/page.jsx) resolves its own `loc` purely from the
  // URL query, and the photo `/raw` route resolves its location the same
  // way (lib/location.ts locationFromRequest). Bug found here: this card
  // grid was built before that convention landed elsewhere in app/recipes
  // and never picked it up, so following a card link or loading a photo
  // thumbnail from a non-default-location `/recipes?location=X` view
  // silently fell back to the default location's data (wrong prep
  // history on the detail page) or 404'd (thumbnail lookup scoped to the
  // wrong location_id). Same bug class as BreakBoard's `locQ` fix.
  const locQ =
    locationId && locationId !== DEFAULT_LOCATION_ID
      ? `?location=${encodeURIComponent(locationId)}`
      : '';

  const bookCount = useMemo(
    () => recipes.filter((r) => !r.is_catering).length,
    [recipes],
  );
  const cateringCount = useMemo(
    () => recipes.filter((r) => r.is_catering).length,
    [recipes],
  );

  const allAllergens = useMemo(() => {
    const seen = new Set();
    recipes.forEach((r) => (r.allergens || []).forEach((a) => seen.add(a)));
    return Array.from(seen).sort();
  }, [recipes]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return recipes.filter((r) => {
      const matchScope = recipeMatchesScope(
        { category: r.category, menu_items: r.menu_items },
        bookScope,
      );
      const matchSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.ingredients_text && r.ingredients_text.includes(q));
      const matchAllergen =
        !filterAllergen || (r.allergens || []).includes(filterAllergen);
      return matchScope && matchSearch && matchAllergen;
    });
  }, [recipes, searchTerm, filterAllergen, bookScope]);

  // Group by category, ordered by CATEGORY_ORDER then alpha for unknowns.
  // Pure logic lives in lib/recipeCookbookGrouping.ts so the unit test
  // can assert ordering without rendering.
  const grouped = useMemo(() => groupRecipesByCategory(filtered), [filtered]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      // Real endpoint is DELETE /api/auth/pin (see app/_components/PinLogout.jsx
      // and app/api/auth/pin/route.ts). This previously POSTed to
      // /api/auth/management-pin/logout, a path that has never existed
      // anywhere in app/api — see this file's history and commit message
      // for the bug writeup. fetch() doesn't reject on a 404 response, so
      // the catch block never ran: the button silently 404'd, the
      // lariat_pin_ok cookie was never cleared, and the page navigated
      // back to /recipes still fully authenticated as management.
      await fetch('/api/auth/pin', { method: 'DELETE' });
      router.push('/recipes');
      router.refresh();
    } catch (e) {
      console.error('Logout failed:', e);
      setSigningOut(false);
    }
  };

  /** @param {string} slug */
  const recipeLink = (slug) =>
    canEditRecipes ? `/recipes/${slug}/edit${locQ}` : `/recipes/${slug}${locQ}`;

  return (
    <div className="cookbook">
      {/* ─── Header ───────────────────────────────────────── */}
      <header className="cookbook-head">
        <div className="cookbook-eyebrow">
          <span>Recipe Book</span>
          <span aria-hidden="true">·</span>
          <span>
            {bookScope === 'book'
              ? `${bookCount} line recipes`
              : bookScope === 'catering'
                ? `${cateringCount} catering builds`
                : `${recipes.length} on file`}
          </span>
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
        <div className="cookbook-allergens" role="group" aria-label="Recipe scope">
          <span className="cookbook-label">Show</span>
          <div className="cookbook-chip-row">
            <button
              type="button"
              className={`cookbook-chip ${bookScope === 'book' ? 'is-active' : ''}`}
              onClick={() => setBookScope('book')}
            >
              Line book ({bookCount})
            </button>
            <button
              type="button"
              className={`cookbook-chip ${bookScope === 'catering' ? 'is-active' : ''}`}
              onClick={() => setBookScope('catering')}
            >
              Catering ({cateringCount})
            </button>
            <button
              type="button"
              className={`cookbook-chip ${bookScope === 'all' ? 'is-active' : ''}`}
              onClick={() => setBookScope('all')}
            >
              All ({recipes.length})
            </button>
          </div>
        </div>
        <div className="cookbook-search">
          <label className="cookbook-label" htmlFor="cookbook-search-input">
            Search
          </label>
          <input
            id="cookbook-search-input"
            type="text"
            placeholder="Recipe name or ingredient…"
            value={searchTerm}
            onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) => setSearchTerm(e.target.value)}
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
                        src={`/api/recipes/${recipe.slug}/photos/${recipe.photo_id}/raw${locQ}`}
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
