// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

/**
 * Read-only thumbnail strip for the recipe detail page.
 * Fetches /api/recipes/[slug]/photos and renders a horizontal scroll.
 * Click a thumb to open the raw image in a new tab.
 */

import { useEffect, useState } from 'react';

export default function RecipePhotoStrip({ slug }) {
  const [photos, setPhotos] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recipes/${slug}/photos`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPhotos(j.photos || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [slug]);

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
          href={`/api/recipes/${slug}/photos/${p.id}/raw`}
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
            src={`/api/recipes/${slug}/photos/${p.id}/raw`}
            alt={p.caption || p.original_name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </a>
      ))}
    </section>
  );
}
