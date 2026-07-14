// @ts-check
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildLookupUrl,
  cleanAllergenTag,
  isGtinQuery,
  offProductUrl,
  parseAllergenTagsResult,
} from './allergenLookupHelpers.js';

/** @typedef {import('../../lib/datapackSearch').FtsHit} FtsHit */
/** @typedef {import('../../lib/datapackSearch').OffProduct} OffProduct */

/**
 * Normalised shape the card renderer consumes — built from either the
 * direct-GTIN op=off_product response or the per-row chip fan-out.
 * @typedef {Object} ProductCardData
 * @property {string} productName
 * @property {string} brand
 * @property {string} brandOwner
 * @property {string} code
 * @property {string[]} allergens
 * @property {boolean} allergensKnown
 * @property {string[]} traces
 * @property {string} ingredientsText
 */

/**
 * A search-list row: starts as a `loading: true` placeholder built from
 * the FTS hit, then gets replaced in place once its chip fetch resolves.
 * @typedef {ProductCardData & { key: string, loading: boolean, error?: boolean }} ListCardData
 */

/** @typedef {{ kind: 'idle' }} LookupIdle */
/** @typedef {{ kind: 'loading' }} LookupLoading */
/** @typedef {{ kind: 'unavailable' }} LookupUnavailable */
/** @typedef {{ kind: 'error', message: string, status?: number }} LookupError */
/** @typedef {{ kind: 'ok-empty' }} LookupOkEmpty */
/** @typedef {{ kind: 'ok-direct', card: ProductCardData }} LookupOkDirect */
/** @typedef {{ kind: 'ok-list', cards: ListCardData[] }} LookupOkList */
/**
 * Discriminated-union response state. Renderers below switch on `.kind`.
 * @typedef {LookupIdle | LookupLoading | LookupUnavailable | LookupError | LookupOkEmpty | LookupOkDirect | LookupOkList} LookupResponse
 */

const DATAPACK_UNAVAILABLE_COPY = 'Reference data is not installed on this Mac. Ask a manager to finish setup.';

// ── Chip renderers ──────────────────────────────────────────────
//
// Allergens use a high-contrast ember tone — line cooks need to
// register "this product contains peanuts" at a glance. Traces are
// muted (amber) because they're a softer signal ("may contain"
// cross-contact, not declared ingredient).

/** @param {{ tag: string }} props */
function AllergenChip({ tag }) {
  const label = cleanAllergenTag(tag);
  if (!label) return null;
  return (
    <span
      aria-label={`Allergen: ${label}`}
      style={{
        padding: '2px 8px',
        background: 'var(--ember)',
        border: '1px solid var(--ember)',
        borderRadius: 12,
        fontSize: 11,
        color: '#fff',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {label}
    </span>
  );
}

/** @param {{ tag: string }} props */
function TraceChip({ tag }) {
  const label = cleanAllergenTag(tag);
  if (!label) return null;
  return (
    <span
      aria-label={`May contain trace: ${label}`}
      style={{
        padding: '2px 8px',
        background: 'var(--panel-2)',
        border: '1px dashed var(--ember)',
        borderRadius: 12,
        fontSize: 11,
        color: 'var(--ember-deep, var(--ember))',
        textTransform: 'capitalize',
      }}
    >
      trace · {label}
    </span>
  );
}

function NoAllergenChip() {
  return (
    <span
      aria-label="No allergens flagged on this product"
      style={{
        padding: '2px 8px',
        background: 'var(--panel-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        fontSize: 11,
        color: 'var(--muted)',
      }}
    >
      no allergens flagged
    </span>
  );
}

// Distinct from both AllergenChip (solid ember) and NoAllergenChip
// (solid border, muted). Dashed neutral-grey border + warning glyph
// signals "we don't know" — line cooks must NOT read this as
// "safe / no allergens". The whole point of this chip is to refuse
// to claim a safe-state when the underlying chip-fetch failed.
function UnknownChip() {
  return (
    <span
      aria-label="Allergen lookup failed for this product"
      style={{
        padding: '2px 8px',
        background: 'transparent',
        border: '1px dashed var(--muted)',
        borderRadius: 12,
        fontSize: 11,
        color: 'var(--muted)',
        fontWeight: 600,
      }}
    >
      ⚠ allergens unknown — retry
    </span>
  );
}

// A successful fetch whose product simply carries NO allergen data in Open
// Food Facts (null / missing / malformed field). Distinct from BOTH
// NoAllergenChip ("declares none") and UnknownChip ("fetch failed — retry"):
// retrying won't help, so it tells the cook to check the physical label
// instead of reading a blank as safe. (High #3.)
function NotListedChip() {
  return (
    <span
      aria-label="No allergen data listed for this product — check the label"
      style={{
        padding: '2px 8px',
        background: 'transparent',
        border: '1px dashed var(--muted)',
        borderRadius: 12,
        fontSize: 11,
        color: 'var(--muted)',
        fontWeight: 600,
      }}
    >
      ⚠ not listed — check label
    </span>
  );
}

/**
 * @param {{ allergens: string[], allergensKnown: boolean, traces: string[], loading: boolean, error?: boolean }} props
 */
function ChipRow({ allergens, allergensKnown, traces, loading, error }) {
  if (loading) {
    return (
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          fontStyle: 'italic',
        }}
      >
        loading allergens…
      </div>
    );
  }
  // Fail-loud: a failed per-product chip-fetch must never collapse
  // into "no allergens flagged" — that would read as a safe answer
  // on a kitchen line. Render a distinct chip BEFORE the empty path.
  if (error) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <UnknownChip />
      </div>
    );
  }
  const hasChips = allergens.length > 0 || traces.length > 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {hasChips ? (
        <>
          {allergens.map((a) => (
            <AllergenChip key={`a:${a}`} tag={a} />
          ))}
          {traces.map((t) => (
            <TraceChip key={`t:${t}`} tag={t} />
          ))}
        </>
      ) : allergensKnown ? (
        // Product declares an empty allergen list — a real "no allergens".
        <NoAllergenChip />
      ) : (
        // No allergen data at all — do NOT claim safe.
        <NotListedChip />
      )}
    </div>
  );
}

// ── Product card ────────────────────────────────────────────────
//
// One renderer for both the search-list rows and the direct-GTIN
// single result. `state` is the per-row chip-resolution state —
// 'loading' until the second op=off_product fetch returns.

/**
 * @param {ProductCardData & { loading: boolean, error?: boolean }} props
 */
function ProductCard({
  productName,
  brand,
  brandOwner,
  code,
  allergens,
  allergensKnown,
  traces,
  ingredientsText,
  loading,
  error,
}) {
  const sourceUrl = code
    ? `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`
    : null;
  return (
    <div
      style={{
        padding: 12,
        marginBottom: 8,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {productName || '(no product name)'}
      </div>
      {brand ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          {brand}
          {brandOwner && brandOwner !== brand ? ` · ${brandOwner}` : ''}
        </div>
      ) : null}

      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <ChipRow
          allergens={allergens}
          allergensKnown={allergensKnown}
          traces={traces}
          loading={loading}
          error={error}
        />
      </div>

      {ingredientsText ? (
        <details style={{ marginBottom: 8 }}>
          <summary
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            ingredients
          </summary>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 6,
              color: 'var(--text)',
            }}
          >
            {ingredientsText}
          </div>
        </details>
      ) : null}

      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {code ? (
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            code {code}
          </span>
        ) : null}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            open on Open Food Facts
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── Network helpers ─────────────────────────────────────────────
//
// Fetch one product's full row, normalise into the shape the card
// renderer expects. AbortSignal is plumbed through so a superseded
// search cancels the fan-out it triggered.

/**
 * @param {string} code
 * @param {AbortSignal} signal
 * @returns {Promise<OffProduct | null>}
 */
async function fetchOffProduct(code, signal) {
  const url = offProductUrl(code);
  if (!url) return null;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = /** @type {Error & { status?: number }} */ (
      new Error(`HTTP ${res.status}`)
    );
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return body?.product ?? null;
}

/**
 * @param {OffProduct | null} product
 * @returns {ProductCardData | null}
 */
function productToCard(product) {
  if (!product) return null;
  const allergensResult = parseAllergenTagsResult(product.allergens_tags_json);
  const tracesResult = parseAllergenTagsResult(product.traces_tags_json);
  return {
    productName: product.product_name ?? '',
    brand: product.brands ?? '',
    brandOwner: product.brand_owner ?? '',
    code: product.code ?? '',
    allergens: allergensResult.tags,
    // Whether OFF actually carried an allergen field — drives the "not
    // listed" vs "no allergens" distinction on the card (High #3).
    allergensKnown: allergensResult.known,
    traces: tracesResult.tags,
    ingredientsText: product.ingredients_text ?? '',
  };
}

// ── Main component ─────────────────────────────────────────────

export default function AllergenLookupClient() {
  const [query, setQuery] = useState('');
  // Discriminated-union response state. Renderers below switch on .kind.
  const [response, setResponse] = useState(
    /** @type {LookupResponse} */ ({ kind: 'idle' })
  );
  const abortRef = useRef(/** @type {AbortController | null} */ (null));

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

  const runLookup = useCallback(
    /** @param {string} rawQuery */
    async (rawQuery) => {
      if (response.kind === 'unavailable') return;
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = null;
        setResponse({ kind: 'idle' });
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setResponse({ kind: 'loading' });

      const url = buildLookupUrl(trimmed);
      if (!url) {
        setResponse({ kind: 'idle' });
        return;
      }

      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } catch (err) {
        const errObj = /** @type {{ name?: unknown, message?: unknown } | null} */ (
          err && typeof err === 'object' ? err : null
        );
        if (errObj?.name === 'AbortError') return;
        setResponse({
          kind: 'error',
          message: `Network error: ${errObj?.message ?? String(err)}`,
        });
        return;
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

      // ── Direct GTIN path ──
      // The barcode lookup returns {ok, product} — render as a single
      // card immediately. No fan-out needed; chips already in hand.
      if (isGtinQuery(trimmed)) {
        const card = productToCard(body?.product);
        if (!card) {
          setResponse({ kind: 'ok-empty' });
          return;
        }
        setResponse({ kind: 'ok-direct', card });
        return;
      }

      // ── FTS path ──
      // body.hits is the FtsHit envelope; chips aren't in there. Render
      // the rows immediately with `loading: true` placeholders, then
      // fan out per-product fetches and replace each row as it lands.
      const hits = /** @type {FtsHit[]} */ (
        Array.isArray(body?.hits) ? body.hits : []
      );
      if (hits.length === 0) {
        setResponse({ kind: 'ok-empty' });
        return;
      }

      const initialCards = hits.map((h) => ({
        key: String(h.id),
        code: String(h.id),
        loading: true,
        productName: h.title ?? '',
        brand: h.subtitle ?? '',
        brandOwner: h.extra ?? '',
        allergens: /** @type {string[]} */ ([]),
        allergensKnown: false,
        traces: /** @type {string[]} */ ([]),
        ingredientsText: '',
      }));
      setResponse({ kind: 'ok-list', cards: initialCards });

      // Fan out. We keep using the same AbortController so a fresh
      // search cancels in-flight chip fetches too. Promise.allSettled
      // keeps a single failure from poisoning the whole list.
      const results = await Promise.allSettled(
        hits.map((h) => fetchOffProduct(String(h.id), ctrl.signal))
      );
      if (ctrl.signal.aborted) return;

      setResponse((prev) => {
        if (prev.kind !== 'ok-list') return prev;
        const next = prev.cards.map((card, i) => {
          const r = /** @type {PromiseSettledResult<OffProduct | null>} */ (
            results[i]
          );
          if (r.status === 'fulfilled' && r.value) {
            const enriched = /** @type {ProductCardData} */ (
              productToCard(r.value)
            );
            return {
              ...card,
              loading: false,
              error: undefined,
              productName: enriched.productName || card.productName,
              brand: enriched.brand || card.brand,
              brandOwner: enriched.brandOwner || card.brandOwner,
              allergens: enriched.allergens,
              allergensKnown: enriched.allergensKnown,
              traces: enriched.traces,
              ingredientsText: enriched.ingredientsText,
            };
          }
          // Failed lookup — drop the spinner and flag the card as
          // error. We must NOT collapse to "no allergens flagged":
          // on a kitchen line that would read as an authoritative
          // safe-answer for what is in fact a fetch failure. The
          // UnknownChip renders a clearly-distinct "lookup failed"
          // signal so the cook knows to retry rather than serve.
          return { ...card, loading: false, error: true };
        });
        return { kind: 'ok-list', cards: next };
      });
    },
    [response.kind]
  );

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const onSubmit = (e) => {
    e.preventDefault();
    runLookup(query);
  };

  return (
    <div>
      {/* Search form */}
      <form
        onSubmit={onSubmit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 12,
          marginBottom: 24,
          alignItems: 'end',
        }}
      >
        <div>
          <label
            htmlFor="allergen-q"
            style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--muted)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Product, brand, or barcode
          </label>
          <input
            id="allergen-q"
            type="text"
            value={query}
            onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) =>
              setQuery(e.target.value)
            }
            placeholder="nutella, kraft, 3017620422003…"
            inputMode="search"
            autoComplete="off"
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
          Look up
        </button>
      </form>

      {/* States */}
      {response.kind === 'idle' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Type a product name, brand, or scan a barcode (8–14 digits) to
          check allergen status.
        </div>
      )}

      {response.kind === 'loading' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Looking up…</div>
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
            color: 'var(--ember-deep, var(--ember))',
            fontSize: 13,
          }}
        >
          {response.message}
        </div>
      )}

      {response.kind === 'ok-empty' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No products matched.
        </div>
      )}

      {response.kind === 'ok-direct' && (
        <ProductCard {...response.card} loading={false} />
      )}

      {response.kind === 'ok-list' && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {response.cards.map((card) => (
            <li key={card.key}>
              <ProductCard {...card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
