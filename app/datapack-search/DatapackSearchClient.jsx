'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

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
const BUCKET_OPTIONS = [
  { value: 'recipes', label: 'Recipes (Wikibooks)' },
  { value: 'techniques', label: 'Techniques (Wikibooks)' },
  { value: 'safety', label: 'Safety (FDA + Wikibooks)' },
  { value: 'ingredients', label: 'Ingredients (USDA)' },
];

const MODE_OPTIONS = [
  { value: 'lexical', label: 'Lexical (BM25)' },
  { value: 'semantic', label: 'Semantic (BGE)' },
];

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

// ── Helpers ──────────────────────────────────────────────────────

function pickTopNutrients(nutrients) {
  if (!Array.isArray(nutrients)) return [];
  const out = [];
  for (const wanted of NUTRIENT_PRIORITY) {
    const found = nutrients.find(
      (n) =>
        n.nutrient_name &&
        n.nutrient_name.toLowerCase().startsWith(wanted.toLowerCase())
    );
    if (found) out.push(found);
  }
  return out;
}

function parseAllergenTags(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === 'string' && s.length > 0);
    }
  } catch {
    /* fall through */
  }
  return [];
}

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
// untouched — it's positive ([-1, 1]); the formatter below
// distinguishes positive (semantic) from negative (BM25) scores.
function normalizeSemanticHit(meta) {
  const score = typeof meta.score === 'number' ? meta.score : 0;
  if (meta.source === 'usda') {
    return {
      score,
      source: 'usda',
      id: meta.fdc_id ?? '',
      title: meta.description ?? null,
      subtitle: meta.food_category ?? null,
      extra: meta.source_archive ?? null,
    };
  }
  if (meta.source === 'wikibooks') {
    return {
      score,
      source: 'wikibooks',
      id: meta.page_id ?? '',
      title: meta.title ?? null,
      subtitle: meta.slug ?? null,
      extra: meta.source_url ?? null,
    };
  }
  if (meta.source === 'fda_food_code') {
    return {
      score,
      source: 'fda',
      id: meta.rowid ?? '',
      title: meta.title ?? null,
      subtitle: meta.section_id ?? '',
      extra: meta.chapter ?? meta.annex ?? null,
    };
  }
  // Unknown source — fall through with whatever scalar fields we can
  // surface so the row at least renders.
  return {
    score,
    source: meta.source ?? 'unknown',
    id: meta.rowid ?? meta.id ?? '',
    title: meta.title ?? meta.description ?? null,
    subtitle: null,
    extra: null,
  };
}

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

function UsdaDetail({ data }) {
  const food = data?.food;
  if (!food) return <div style={{ color: 'var(--muted)' }}>No food row.</div>;
  const top = pickTopNutrients(data?.nutrients ?? []);
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

function OffDetail({ data }) {
  const product = data?.product;
  if (!product) return <div style={{ color: 'var(--muted)' }}>No product row.</div>;
  const allergens = parseAllergenTags(product.allergens_tags_json);
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
      {allergens.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Allergens
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allergens.map((a) => (
              <span
                key={a}
                style={{
                  padding: '2px 8px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  fontSize: 11,
                  color: 'var(--text)',
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FdaDetail({ data }) {
  const section = data?.section;
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

function WikibooksDetail({ data }) {
  const page = data?.page;
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

// ── Main component ──────────────────────────────────────────────

export default function DatapackSearchClient() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('lexical');
  const [source, setSource] = useState('all');
  const [bucket, setBucket] = useState('recipes');
  // Search response state. `kind` discriminates the union; `data`
  // shape depends on the kind.
  const [response, setResponse] = useState({ kind: 'idle' });
  // Per-row drill-in state, keyed by `${source}:${id}`.
  const [details, setDetails] = useState({});
  // AbortController for the in-flight search. Fast typing (submit
  // "egg", then submit "eggplant" before "egg" resolves) used to let
  // the slower "egg" response overwrite the "eggplant" results — we
  // now abort the previous request before issuing a new one.
  const searchAbortRef = useRef(null);

  const runSearch = useCallback(async (q, modeArg, srcOrBucket) => {
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
    const params = new URLSearchParams({ q: trimmed, limit: '20' });
    if (modeArg === 'semantic') {
      params.set('op', 'semantic');
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
      if (err?.name === 'AbortError') return; // superseded by a newer search
      setResponse({
        kind: 'error',
        message: `Network error: ${err?.message ?? String(err)}`,
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

    // Semantic responses carry the per-bucket metadata.jsonl shape
    // directly. Run them through the normalizer so the rendering
    // pipeline (grouping, drill-in, lookupUrlFor) sees the same
    // {score, source, id, title, subtitle, extra} shape lexical
    // already speaks.
    const isSemantic = modeArg === 'semantic';
    const hits = isSemantic
      ? body.hits.map(normalizeSemanticHit)
      : body.hits;
    setResponse({
      kind: 'ok',
      hits,
      query: body.query,
      mode: modeArg,
      source: isSemantic ? null : body.source,
      bucket: isSemantic ? body.bucket : null,
    });
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    runSearch(query, mode, mode === 'semantic' ? bucket : source);
  };

  const grouped = useMemo(() => {
    if (response.kind !== 'ok') return null;
    const buckets = new Map();
    for (const s of GROUP_ORDER) buckets.set(s, []);
    for (const hit of response.hits) {
      if (!buckets.has(hit.source)) buckets.set(hit.source, []);
      buckets.get(hit.source).push(hit);
    }
    return [...buckets.entries()]
      .filter(([, hits]) => hits.length > 0)
      .map(([s, hits]) => ({ source: s, hits }));
  }, [response]);

  const toggleDetail = useCallback(
    async (hit) => {
      const key = hitKey(hit);
      const existing = details[key];
      // Collapse on second click.
      if (existing && existing.status !== 'closed') {
        setDetails((d) => ({ ...d, [key]: { ...existing, status: 'closed' } }));
        return;
      }
      // Re-open from a previously-closed cached payload.
      if (existing && existing.status === 'closed' && existing.data) {
        setDetails((d) => ({ ...d, [key]: { ...existing, status: 'ok' } }));
        return;
      }
      const url = lookupUrlFor(hit);
      if (!url) return;
      setDetails((d) => ({ ...d, [key]: { status: 'loading' } }));
      let res;
      try {
        res = await fetch(url);
      } catch (err) {
        setDetails((d) => ({
          ...d,
          [key]: { status: 'error', error: `Network error: ${err?.message ?? String(err)}` },
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
        setDetails((d) => ({ ...d, [key]: { status: 'error', error: msg } }));
        return;
      }
      setDetails((d) => ({ ...d, [key]: { status: 'ok', data: body } }));
    },
    [details]
  );

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
            Mode
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
              Bucket
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
          style={{
            padding: '10px 18px',
            background: 'var(--ember)',
            border: '1px solid var(--ember)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </form>

      {/* States */}
      {response.kind === 'idle' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Enter a query to search the data pack.
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
          Data pack not available on this server — see{' '}
          <code>scripts/datapack/README.md</code>.
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
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No hits.</div>
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
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          {hit.extra ? <span>{hit.extra}</span> : null}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                            score {hit.score.toFixed(2)}
                          </span>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                            id {hit.id}
                          </span>
                        </div>
                      </button>
                      {open && (
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
