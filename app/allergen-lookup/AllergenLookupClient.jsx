'use client';

import { useCallback, useRef, useState } from 'react';

import {
  buildLookupUrl,
  cleanAllergenTag,
  isGtinQuery,
  offProductUrl,
  parseAllergenTags,
} from './allergenLookupHelpers.js';

// ── Chip renderers ──────────────────────────────────────────────
//
// Allergens use a high-contrast ember tone — line cooks need to
// register "this product contains peanuts" at a glance. Traces are
// muted (amber) because they're a softer signal ("may contain"
// cross-contact, not declared ingredient).

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

function ChipRow({ allergens, traces, loading, error }) {
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
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {allergens.length === 0 && traces.length === 0 ? (
        <NoAllergenChip />
      ) : (
        <>
          {allergens.map((a) => (
            <AllergenChip key={`a:${a}`} tag={a} />
          ))}
          {traces.map((t) => (
            <TraceChip key={`t:${t}`} tag={t} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Product card ────────────────────────────────────────────────
//
// One renderer for both the search-list rows and the direct-GTIN
// single result. `state` is the per-row chip-resolution state —
// 'loading' until the second op=off_product fetch returns.

function ProductCard({
  productName,
  brand,
  brandOwner,
  code,
  allergens,
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

async function fetchOffProduct(code, signal) {
  const url = offProductUrl(code);
  if (!url) return null;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return body?.product ?? null;
}

function productToCard(product) {
  if (!product) return null;
  return {
    productName: product.product_name ?? '',
    brand: product.brands ?? '',
    brandOwner: product.brand_owner ?? '',
    code: product.code ?? '',
    allergens: parseAllergenTags(product.allergens_tags_json),
    traces: parseAllergenTags(product.traces_tags_json),
    ingredientsText: product.ingredients_text ?? '',
  };
}

// ── Main component ─────────────────────────────────────────────

export default function AllergenLookupClient() {
  const [query, setQuery] = useState('');
  // Discriminated-union response state. Renderers below switch on .kind.
  const [response, setResponse] = useState({ kind: 'idle' });
  const abortRef = useRef(null);

  const runLookup = useCallback(async (rawQuery) => {
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
      if (err?.name === 'AbortError') return;
      setResponse({
        kind: 'error',
        message: `Network error: ${err?.message ?? String(err)}`,
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
    const hits = Array.isArray(body?.hits) ? body.hits : [];
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
      allergens: [],
      traces: [],
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
        const r = results[i];
        if (r.status === 'fulfilled' && r.value) {
          const enriched = productToCard(r.value);
          return {
            ...card,
            loading: false,
            error: undefined,
            productName: enriched.productName || card.productName,
            brand: enriched.brand || card.brand,
            brandOwner: enriched.brandOwner || card.brandOwner,
            allergens: enriched.allergens,
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
  }, []);

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
            onChange={(e) => setQuery(e.target.value)}
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
