// @ts-check
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { nextDetails } from './detailsState';
import { offAllergenView } from './offAllergenView.js';
import { cleanAllergenTag } from '../allergen-lookup/allergenLookupHelpers.js';

// Friendly source labels — order is the same display order used to
// group hits below the form. 'all' is the default.
const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'usda', label: 'USDA Foods' },
  { value: 'off', label: 'Open Food Facts' },
  { value: 'wikibooks', label: 'Wikibooks Cookbook' },
  { value: 'fda', label: 'FDA Food Code' },
];

const SOURCE_LABEL = Object.fromEntries(
  SOURCE_OPTIONS.map((s) => [s.value, s.label])
);

// Display order when grouping hits — matches the dropdown.
const GROUP_ORDER = ['usda', 'off', 'wikibooks', 'fda'];

// Semantic mode is keyed off embedding buckets, not source tables. The
// safety bucket has both fda and wikibooks members; the others are
// single-source. Bucket → default source for new-results UX
// (recipes/techniques live entirely in wikibooks; ingredients in usda;
// safety mixes fda + wikibooks).
// Cook-facing labels (docs/UI_COPY_RULES.md): short, plain words — the
// engine names (BM25/BGE/RRF) and the word "bucket" stay internal. The
// result-group headers still show the full source names.
const BUCKET_OPTIONS = [
  { value: 'recipes', label: 'Recipes' },
  { value: 'techniques', label: 'Techniques' },
  { value: 'safety', label: 'Safety rules' },
  { value: 'ingredients', label: 'Ingredients' },
];

const MODE_OPTIONS = [
  { value: 'lexical', label: 'Exact words' },
  { value: 'semantic', label: 'Similar meaning' },
  { value: 'hybrid', label: 'Both' },
];

const DATAPACK_UNAVAILABLE_COPY = 'Reference data is not installed on this Mac. Ask a manager to finish setup.';

// Cap the nutrient drill-in to a sensible subset. We match by
// nutrient_name prefix (USDA names are inconsistent on units) and
// fall through silently when something isn't reported for a food.
const NUTRIENT_PRIORITY = [
  'Energy',
  'Protein',
  'Carbohydrate',
  'Total lipid (fat)',
  'Sodium, Na',
  'Sugars, total',
];

/** @typedef {import('../../lib/datapackSearch').UsdaFood} UsdaFood */
/** @typedef {import('../../lib/datapackSearch').UsdaNutrient} UsdaNutrient */
/** @typedef {import('../../lib/datapackSearch').OffProduct} OffProduct */
/** @typedef {import('../../lib/datapackSearch').FdaSection} FdaSection */
/** @typedef {import('../../lib/datapackSearch').WikibooksPage} WikibooksPage */

/**
 * A rendered search result row — the shared shape the FTS path returns
 * directly and the semantic/hybrid path normalizes into (see
 * normalizeSemanticHit below).
 * @typedef {{
 *   score: number,
 *   source: string,
 *   id: number | string,
 *   title: string | null,
 *   subtitle: string | null,
 *   extra: string | null,
 * }} Hit
 */

// ── Helpers ──────────────────────────────────────────────────────

/**
 * @param {unknown} nutrients
 * @returns {UsdaNutrient[]}
 */
function pickTopNutrients(nutrients) {
  if (!Array.isArray(nutrients)) return [];
  const list = /** @type {UsdaNutrient[]} */ (nutrients);
  const out = /** @type {UsdaNutrient[]} */ ([]);
  for (const wanted of NUTRIENT_PRIORITY) {
    const found = list.find(
      (n) =>
        n.nutrient_name &&
        n.nutrient_name.toLowerCase().startsWith(wanted.toLowerCase())
    );
    if (found) out.push(found);
  }
  return out;
}

/**
 * @param {Hit} hit
 * @returns {string}
 */
function hitKey(hit) {
  return `${hit.source}:${hit.id}`;
}

// Normalize one semantic-result row (shape comes from the per-bucket
// metadata.jsonl) into the same {score, source, id, title, subtitle,
// extra} shape the FTS path uses, so the rest of the renderer
// (grouping, drill-in, lookupUrlFor) doesn't need a second code path.
//
// `source: 'fda_food_code'` collapses to `'fda'` to match the FTS
// source naming and drill-in routing. We keep the cosine similarity
// untouched — it's used for ordering only (the raw score is no longer
// rendered on cook-facing rows; see docs/UI_COPY_RULES.md).
/**
 * @param {Record<string, unknown>} meta
 * @returns {Hit}
 */
function normalizeSemanticHit(meta) {
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
 * @param {Hit} hit
 * @returns {string | null}
 */
function lookupUrlFor(hit) {
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

// ── Drill-in panels ──────────────────────────────────────────────

/** @param {{ data: unknown }} props */
function UsdaDetail({ data }) {
  const d = /** @type {{ food?: UsdaFood, nutrients?: UsdaNutrient[] } | null | undefined} */ (data);
  const food = d?.food;
  if (!food) return <div style={{ color: 'var(--muted)' }}>No food row.</div>;
  const top = pickTopNutrients(d?.nutrients ?? []);
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {food.description ?? '(no description)'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        fdc_id {food.fdc_id}
        {food.food_category ? ` · ${food.food_category}` : ''}
        {food.brand_owner ? ` · ${food.brand_owner}` : ''}
        {food.source_archive ? ` · ${food.source_archive}` : ''}
      </div>
      {top.length > 0 ? (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {top.map((n) => (
              <tr key={n.nutrient_id}>
                <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>
                  {n.nutrient_name}
                </td>
                <td style={{ padding: '4px 0', textAlign: 'right' }}>
                  {n.amount}
                  {n.unit_name ? ` ${n.unit_name}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          No top-line nutrients reported.
        </div>
      )}
    </div>
  );
}

const ALLERGEN_CHIP_STYLE = {
  padding: '2px 8px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 11,
  color: 'var(--text)',
  textTransform: /** @type {const} */ ('capitalize'),
};

const TRACE_CHIP_STYLE = {
  padding: '2px 8px',
  background: 'transparent',
  border: '1px dashed var(--border)',
  borderRadius: 12,
  fontSize: 11,
  color: 'var(--muted)',
  textTransform: /** @type {const} */ ('capitalize'),
};

/**
 * Allergen chip row for the OFF panel. ALWAYS renders an explicit state so a
 * product with no allergen data ('unknown') never looks like one that
 * declares none ('none') — a kitchen-line false-negative otherwise.
 * @param {{ state: import('./offAllergenView').AllergenChipState, tags: string[] }} props
 */
function AllergenTagRow({ state, tags }) {
  if (state === 'has') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {tags.map((a) => (
          <span key={a} style={ALLERGEN_CHIP_STYLE}>
            {cleanAllergenTag(a)}
          </span>
        ))}
      </div>
    );
  }
  if (state === 'none') {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Declares no allergens.</div>
    );
  }
  // 'unknown' — data absent/malformed. Do NOT read as safe.
  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
      ⚠ not listed — check label
    </div>
  );
}

/** @param {{ data: unknown }} props */
function OffDetail({ data }) {
  const d = /** @type {{ product?: OffProduct } | null | undefined} */ (data);
  const product = d?.product;
  if (!product) return <div style={{ color: 'var(--muted)' }}>No product row.</div>;
  const { allergens, traces } = offAllergenView(product);
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {product.product_name ?? '(no product name)'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        code {product.code}
        {product.brands ? ` · ${product.brands}` : ''}
      </div>
      {product.ingredients_text ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Ingredients
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {product.ingredients_text}
          </div>
        </div>
      ) : null}

      <div style={{ marginBottom: traces.tags.length > 0 ? 12 : 0 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          Allergens
        </div>
        <AllergenTagRow state={allergens.state} tags={allergens.tags} />
      </div>

      {traces.tags.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            May contain (traces)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {traces.tags.map((t) => (
              <span key={t} style={TRACE_CHIP_STYLE}>
                trace · {cleanAllergenTag(t)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @param {{ data: unknown }} props */
function FdaDetail({ data }) {
  const d = /** @type {{ section?: FdaSection } | null | undefined} */ (data);
  const section = d?.section;
  if (!section) return <div style={{ color: 'var(--muted)' }}>No section.</div>;
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {section.title ?? '(no title)'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {section.section_id ? `${section.section_id} · ` : ''}
        {section.chapter ? `Ch. ${section.chapter}` : ''}
        {section.annex ? `Annex ${section.annex}` : ''}
      </div>
      <pre
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          margin: 0,
          maxHeight: 360,
          overflow: 'auto',
          padding: 12,
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}
      >
        {section.body ?? ''}
      </pre>
    </div>
  );
}

/** @param {{ data: unknown }} props */
function WikibooksDetail({ data }) {
  const d = /** @type {{ page?: WikibooksPage } | null | undefined} */ (data);
  const page = d?.page;
  if (!page) return <div style={{ color: 'var(--muted)' }}>No page.</div>;
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {page.title ?? '(no title)'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {page.slug ?? ''}
      </div>
      {page.plain_text_summary ? (
        <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
          {page.plain_text_summary}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          No summary in index.
        </div>
      )}
      {page.source_url ? (
        <a
          href={page.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: 'var(--accent)' }}
        >
          {page.source_url}
        </a>
      ) : null}
    </div>
  );
}

/**
 * @param {{ source: string, state: import('./detailsState').DetailEntry }} props
 */
function DetailPanel({ source, state }) {
  if (state.status === 'loading') {
    return <div style={{ color: 'var(--muted)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return (
      <div style={{ color: 'var(--ember-deep)' }}>
        {state.error ?? 'Failed to load.'}
      </div>
    );
  }
  if (state.status !== 'ok') return null;
  if (source === 'usda') return <UsdaDetail data={state.data} />;
  if (source === 'off') return <OffDetail data={state.data} />;
  if (source === 'fda') return <FdaDetail data={state.data} />;
  if (source === 'wikibooks') return <WikibooksDetail data={state.data} />;
  return null;
}

/**
 * Search response state. `kind` discriminates the union; the payload
 * shape depends on the kind.
 * @typedef {
 *   | { kind: 'idle' }
 *   | { kind: 'loading' }
 *   | { kind: 'unavailable' }
 *   | { kind: 'error', message: string, status?: number }
 *   | { kind: 'ok', hits: Hit[], query: string, mode: string, source: string | null, bucket: string | null }
 * } SearchResponse
 */

// ── Main component ──────────────────────────────────────────────

export default function DatapackSearchClient() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('lexical');
  const [source, setSource] = useState('all');
  const [bucket, setBucket] = useState('recipes');
  // Search response state. `kind` discriminates the union; `data`
  // shape depends on the kind.
  const [response, setResponse] = useState(/** @type {SearchResponse} */ ({ kind: 'idle' }));
  // Per-row drill-in state, keyed by `${source}:${id}`.
  const [details, setDetails] = useState(/** @type {import('./detailsState').DetailsMap} */ ({}));
  // AbortController for the in-flight search. Fast typing (submit
  // "egg", then submit "eggplant" before "egg" resolves) used to let
  // the slower "egg" response overwrite the "eggplant" results — we
  // now abort the previous request before issuing a new one.
  const searchAbortRef = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => {
    let alive = true;
    fetch('/api/datapack/search?op=stats')
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 503) {
          setResponse({ kind: 'unavailable' });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setResponse({
            kind: 'error',
            message: body?.error || `HTTP ${res.status}`,
            status: res.status,
          });
        }
      })
      .catch(() => {
        if (alive) setResponse({ kind: 'error', message: 'Could not check reference data.' });
      });
    return () => {
      alive = false;
    };
  }, []);

  const runSearch = useCallback(
    /**
     * @param {string} q
     * @param {string} modeArg
     * @param {string} srcOrBucket
     */
    async (q, modeArg, srcOrBucket) => {
    if (response.kind === 'unavailable') return;
    const trimmed = q.trim();
    if (!trimmed) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = null;
      setResponse({ kind: 'idle' });
      return;
    }
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setResponse({ kind: 'loading' });
    setDetails({});
    // Mode picks the API op + which selector value to forward:
    //   lexical   → ?op=search&source=…
    //   semantic  → ?op=semantic&bucket=…
    //   hybrid    → ?op=hybrid&bucket=…   (RRF fusion of the above two)
    const params = new URLSearchParams({ q: trimmed, limit: '20' });
    if (modeArg === 'semantic') {
      params.set('op', 'semantic');
      params.set('bucket', srcOrBucket);
    } else if (modeArg === 'hybrid') {
      params.set('op', 'hybrid');
      params.set('bucket', srcOrBucket);
    } else {
      params.set('source', srcOrBucket);
    }
    let res;
    try {
      res = await fetch(`/api/datapack/search?${params.toString()}`, {
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = /** @type {{ name?: unknown, message?: unknown } | null} */ (err);
      if (e?.name === 'AbortError') return; // superseded by a newer search
      setResponse({
        kind: 'error',
        message: `Network error: ${e?.message ?? String(err)}`,
      });
      return;
    } finally {
      if (searchAbortRef.current === ctrl) searchAbortRef.current = null;
    }

    if (res.status === 503) {
      setResponse({ kind: 'unavailable' });
      return;
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      /* fall through */
    }

    if (!res.ok) {
      const msg =
        (body && typeof body.error === 'string' && body.error) ||
        `HTTP ${res.status}`;
      setResponse({ kind: 'error', message: msg, status: res.status });
      return;
    }

    if (!body || !Array.isArray(body.hits)) {
      setResponse({
        kind: 'error',
        message: 'Malformed response from /api/datapack/search.',
      });
      return;
    }

    // Semantic + hybrid responses carry per-bucket metadata.jsonl
    // fields directly (or, for hybrid, the FtsHit envelope when both
    // channels matched). Normalize semantic hits so the rendering
    // pipeline (grouping, drill-in, lookupUrlFor) sees the same
    // {score, source, id, title, subtitle, extra} shape lexical
    // already speaks. Hybrid hits prefer the FTS envelope when
    // available — those already match — but fall through the
    // normalizer when only the semantic side scored a row.
    const isBucketed = modeArg === 'semantic' || modeArg === 'hybrid';
    const hits = isBucketed
      ? body.hits.map(
          /** @param {Record<string, unknown>} h */
          (h) =>
            // FTS envelope already has the right shape (typeof title is
            // present even when null; .source / .id are required).
            typeof h.source === 'string' && 'id' in h && 'title' in h
              ? h
              : normalizeSemanticHit(h)
        )
      : body.hits;
    setResponse({
      kind: 'ok',
      hits,
      query: body.query,
      mode: modeArg,
      source: isBucketed ? null : body.source,
      bucket: isBucketed ? body.bucket : null,
    });
  }, [response.kind]);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const onSubmit = (e) => {
    e.preventDefault();
    // Both 'semantic' and 'hybrid' search a per-bucket embedding index and
    // must send `bucket`; only 'lexical' targets the FTS `source` selector.
    // (Bug: this used to read `mode === 'semantic' ? bucket : source`, which
    // sent the hidden/stale `source` state — defaulting to 'all', not a
    // valid bucket — for every Hybrid search, so Hybrid always 400'd.)
    runSearch(query, mode, mode === 'lexical' ? source : bucket);
  };

  const grouped = useMemo(() => {
    if (response.kind !== 'ok') return null;
    const buckets = /** @type {Map<string, Hit[]>} */ (new Map());
    for (const s of GROUP_ORDER) buckets.set(s, []);
    for (const hit of response.hits) {
      if (!buckets.has(hit.source)) buckets.set(hit.source, []);
      // `.get()` is guaranteed non-null here — we just `.set()` it above
      // if missing.
      /** @type {Hit[]} */ (buckets.get(hit.source)).push(hit);
    }
    return [...buckets.entries()]
      .filter(([, hits]) => hits.length > 0)
      .map(([s, hits]) => ({ source: s, hits }));
  }, [response]);

  // toggleDetail closes over no React state. The click is dispatched
  // through `setDetails((prev) => …)` so the state machine reads the
  // freshest snapshot — fixes the perf issue where listing `details`
  // in the dep array reallocated this callback (and every row's
  // onClick) on every keystroke. The fetch URL is derived from the
  // `hit` arg, so we only need its key for the post-fetch updates.
  //
  // Concurrent-click safety: `nextDetails` returns `'noop-loading'`
  // when a fetch is already in flight for the same row, and the
  // updater returns `prev` unchanged. We mirror that by tracking
  // `shouldFetch` inside the updater and only awaiting the network
  // when the synchronous flip set the row to `loading` here.
  const toggleDetail = useCallback(
    /** @param {Hit} hit */
    async (hit) => {
    const key = hitKey(hit);
    const url = lookupUrlFor(hit);
    if (!url) return;

    let shouldFetch = false;
    setDetails((prev) => {
      const { next, action } = nextDetails(prev, key);
      shouldFetch = action === 'open-fresh';
      return next;
    });
    if (!shouldFetch) return;

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      const e = /** @type {{ message?: unknown } | null} */ (err);
      setDetails((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          error: `Network error: ${e?.message ?? String(err)}`,
        },
      }));
      return;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* fall through */
    }
    if (!res.ok) {
      const msg =
        (body && typeof body.error === 'string' && body.error) ||
        `HTTP ${res.status}`;
      setDetails((prev) => ({ ...prev, [key]: { status: 'error', error: msg } }));
      return;
    }
    setDetails((prev) => ({ ...prev, [key]: { status: 'ok', data: body } }));
  }, []);

  return (
    <div>
      {/* Search form */}
      <form
        onSubmit={onSubmit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 180px 220px auto',
          gap: 12,
          marginBottom: 24,
          alignItems: 'end',
        }}
      >
        <div>
          <label
            htmlFor="datapack-q"
            style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--muted)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Search
          </label>
          <input
            id="datapack-q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ingredient, brand, regulation…"
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
          <label
            htmlFor="datapack-mode"
            style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--muted)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Search by
          </label>
          <select
            id="datapack-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
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
            {MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {mode === 'lexical' ? (
          <div>
            <label
              htmlFor="datapack-src"
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--muted)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Source
            </label>
            <select
              id="datapack-src"
              value={source}
              onChange={(e) => setSource(e.target.value)}
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
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label
              htmlFor="datapack-bucket"
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--muted)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Look in
            </label>
            <select
              id="datapack-bucket"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
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
              {BUCKET_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={response.kind === 'unavailable'}
          style={{
            padding: '10px 18px',
            background: 'var(--ember)',
            border: '1px solid var(--ember)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: response.kind === 'unavailable' ? 'not-allowed' : 'pointer',
            opacity: response.kind === 'unavailable' ? 0.65 : 1,
          }}
        >
          Search
        </button>
      </form>

      {/* States */}
      {response.kind === 'idle' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Type what you want to look up.
        </div>
      )}

      {response.kind === 'loading' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Searching…</div>
      )}

      {response.kind === 'unavailable' && (
        <div
          style={{
            padding: 16,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 13,
          }}
        >
          {DATAPACK_UNAVAILABLE_COPY}
        </div>
      )}

      {response.kind === 'error' && (
        <div
          style={{
            padding: 16,
            background: 'var(--panel-2)',
            border: '1px solid var(--ember)',
            borderRadius: 6,
            color: 'var(--ember-deep)',
            fontSize: 13,
          }}
        >
          {response.message}
        </div>
      )}

      {response.kind === 'ok' && response.hits.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No matches.</div>
      )}

      {response.kind === 'ok' && grouped && grouped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {grouped.map(({ source: s, hits }) => (
            <section key={s}>
              <h2
                style={{
                  fontSize: 13,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  margin: '0 0 12px',
                  fontWeight: 600,
                }}
              >
                {SOURCE_LABEL[s] ?? s} · {hits.length}
              </h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {hits.map((hit) => {
                  const key = hitKey(hit);
                  const detail = details[key];
                  const open = detail && detail.status !== 'closed';
                  return (
                    <li
                      key={key}
                      style={{
                        padding: 12,
                        marginBottom: 8,
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDetail(hit)}
                        aria-expanded={Boolean(open)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            marginBottom: 4,
                          }}
                        >
                          {hit.title ?? '(no title)'}
                        </div>
                        {hit.subtitle ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--muted)',
                              marginBottom: 2,
                            }}
                          >
                            {hit.subtitle}
                          </div>
                        ) : null}
                        {/* No raw "score"/"id" here (docs/UI_COPY_RULES.md —
                            no dev-style fields on cook-facing rows). The
                            drill-in panels show the real identifiers (fdc_id,
                            product code, section number). */}
                        {hit.extra ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                            }}
                          >
                            {hit.extra}
                          </div>
                        ) : null}
                      </button>
                      {open && detail && (
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 12,
                            borderTop: '1px solid var(--border)',
                          }}
                        >
                          <DetailPanel source={hit.source} state={detail} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
