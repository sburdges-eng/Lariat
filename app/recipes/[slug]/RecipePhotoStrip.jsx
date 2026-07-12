// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// plus one real bug fix — see the `locQ` comment below.
'use client';

/**
 * Read-only thumbnail strip for the recipe detail page.
 * Fetches /api/recipes/[slug]/photos and renders a horizontal scroll.
 * Click a thumb to open the raw image in a new tab.
 */

import { useEffect, useState } from 'react';

const DEFAULT_LOCATION_ID = 'default';

/**
 * Response row shape from GET /api/recipes/[slug]/photos — the columns
 * selected in app/api/recipes/[slug]/photos/route.js's SELECT.
 * @typedef {{
 *   id: number,
 *   original_name: string,
 *   mime: string,
 *   size_bytes: number,
 *   caption: string | null,
 *   uploaded_by_cook_id: string | null,
 *   uploaded_at: string,
 *   is_hero: number,
 * }} RecipePhoto
 */

/** @param {{ slug: string, loc?: string }} props */
export default function RecipePhotoStrip({ slug, loc }) {
  const [photos, setPhotos] = useState(/** @type {RecipePhoto[]} */ ([]));
  const [loaded, setLoaded] = useState(false);

  // Non-default locations must be threaded onto both the list fetch and
  // the raw-image URLs below as `?location=` — every handler in
  // app/api/recipes/[slug]/photos/**/route.js resolves its location
  // scope from `locationFromRequest(req)` (the URL query only, per
  // lib/location.ts). Same convention as app/labor/breaks/BreakBoard.jsx's
  // `locQ`. Without it, this strip silently reads (and links to) the
  // DEFAULT_LOCATION_ID's photos regardless of which location the
  // recipe page itself is scoped to — on a non-default-location
  // install the strip either shows the wrong site's photos or shows
  // none, and the raw-image links 404 (location_id won't match the
  // photo row).
  const locQ = loc && loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recipes/${slug}/photos${locQ}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPhotos(j.photos || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [slug, locQ]);

  if (!loaded) return null;
  if (photos.length === 0) return null;

  return (
    <section
      aria-label="Product photos"
      style={{
        margin: '20px 0 28px',
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 6,
      }}
    >
      {photos.map((p) => (
        <a
          key={p.id}
          href={`/api/recipes/${slug}/photos/${p.id}/raw${locQ}`}
          target="_blank"
          rel="noreferrer"
          title={p.caption || p.original_name}
          style={{
            flex: '0 0 auto',
            width: 140,
            aspectRatio: '4 / 3',
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--paper-2, #e3d8c1)',
            textDecoration: 'none',
          }}
        >
          <img
            src={`/api/recipes/${slug}/photos/${p.id}/raw${locQ}`}
            alt={p.caption || p.original_name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </a>
      ))}
    </section>
  );
}
