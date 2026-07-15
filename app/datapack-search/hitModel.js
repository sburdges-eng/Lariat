// @ts-check
// Pure hit-model helpers for DatapackSearchClient — normalization of
// semantic-index rows, drill-in routing, source grouping, and the href
// scheme guard. Extracted from the .jsx (like detailsState / offAllergenView)
// so `node --test` can pin the render-critical logic without React.

/**
 * A rendered search result row — the shared shape the FTS path returns
 * directly and the semantic/hybrid path normalizes into.
 * @typedef {{
 *   score: number,
 *   source: string,
 *   id: number | string,
 *   title: string | null,
 *   subtitle: string | null,
 *   extra: string | null,
 * }} HitRow
 */

// Display order when grouping hits — matches the source dropdown.
export const GROUP_ORDER = ['usda', 'off', 'wikibooks', 'fda'];

/**
 * @param {{ source: string, id: number | string }} hit
 * @returns {string}
 */
export function hitKey(hit) {
  return `${hit.source}:${hit.id}`;
}

// Normalize one semantic-result row (shape comes from the per-bucket
// metadata.jsonl) into the same {score, source, id, title, subtitle,
// extra} shape the FTS path uses, so the rest of the renderer
// (grouping, drill-in, lookupUrlFor) doesn't need a second code path.
//
// `source: 'fda_food_code'` collapses to `'fda'` to match the FTS
// source naming and drill-in routing. We keep the cosine similarity
// untouched — it's used for ordering only (the raw score is not
// rendered on cook-facing rows; see docs/UI_COPY_RULES.md).
/**
 * @param {Record<string, unknown>} meta
 * @returns {HitRow}
 */
export function normalizeSemanticHit(meta) {
  const score = typeof meta.score === 'number' ? meta.score : 0;
  if (meta.source === 'usda') {
    return {
      score,
      source: 'usda',
      id: /** @type {number | string} */ (meta.fdc_id ?? ''),
      title: /** @type {string | null} */ (meta.description ?? null),
      subtitle: /** @type {string | null} */ (meta.food_category ?? null),
      extra: /** @type {string | null} */ (meta.source_archive ?? null),
    };
  }
  if (meta.source === 'wikibooks') {
    return {
      score,
      source: 'wikibooks',
      id: /** @type {number | string} */ (meta.page_id ?? ''),
      title: /** @type {string | null} */ (meta.title ?? null),
      subtitle: /** @type {string | null} */ (meta.slug ?? null),
      extra: /** @type {string | null} */ (meta.source_url ?? null),
    };
  }
  if (meta.source === 'fda_food_code') {
    return {
      score,
      source: 'fda',
      id: /** @type {number | string} */ (meta.rowid ?? ''),
      title: /** @type {string | null} */ (meta.title ?? null),
      subtitle: /** @type {string} */ (meta.section_id ?? ''),
      extra: /** @type {string | null} */ (meta.chapter ?? meta.annex ?? null),
    };
  }
  // Unknown source — fall through with whatever scalar fields we can
  // surface so the row at least renders.
  return {
    score,
    source: /** @type {string} */ (meta.source ?? 'unknown'),
    id: /** @type {number | string} */ (meta.rowid ?? meta.id ?? ''),
    title: /** @type {string | null} */ (meta.title ?? meta.description ?? null),
    subtitle: null,
    extra: null,
  };
}

/**
 * Drill-in URL for one hit, routed by source. Null for unknown sources.
 * @param {{ source: string, id: number | string }} hit
 * @returns {string | null}
 */
export function lookupUrlFor(hit) {
  const params = new URLSearchParams();
  if (hit.source === 'usda') {
    params.set('op', 'usda_food');
    params.set('fdc_id', String(hit.id));
  } else if (hit.source === 'off') {
    params.set('op', 'off_product');
    params.set('code', String(hit.id));
  } else if (hit.source === 'wikibooks') {
    params.set('op', 'wikibooks_page');
    params.set('page_id', String(hit.id));
  } else if (hit.source === 'fda') {
    params.set('op', 'fda_section');
    params.set('rowid', String(hit.id));
  } else {
    return null;
  }
  return `/api/datapack/search?${params.toString()}`;
}

/**
 * Group hits by source: GROUP_ORDER sources first (in that order), any
 * unknown sources appended in first-seen order, empty groups dropped.
 * @template {{ source: string }} T
 * @param {T[]} hits
 * @returns {{ source: string, hits: T[] }[]}
 */
export function groupHits(hits) {
  const buckets = /** @type {Map<string, T[]>} */ (new Map());
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const hit of hits) {
    if (!buckets.has(hit.source)) buckets.set(hit.source, []);
    // `.get()` is guaranteed non-null here — we just `.set()` it above
    // if missing.
    /** @type {T[]} */ (buckets.get(hit.source)).push(hit);
  }
  return [...buckets.entries()]
    .filter(([, group]) => group.length > 0)
    .map(([s, group]) => ({ source: s, hits: group }));
}

/**
 * Href scheme guard (rolling-review datapack-search Low #4): only http/https
 * URLs come back; anything else (javascript:, data:, file:, relative,
 * malformed, non-string) returns null so the caller skips rendering the link
 * rather than handing the browser an executable href from datapack content.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeHttpUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null; // relative or malformed — not renderable as an external link
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
}
