// @ts-check
// Pure helpers for the /allergen-lookup page. Extracted into their own
// module so they can be unit-tested under `node --test` without
// spinning up React or Next.js.
//
// All helpers in here are side-effect free and synchronous.

// ── GTIN detection ───────────────────────────────────────────────
//
// A barcode-shaped query — typically scanned off a product label —
// should jump straight to op=off_product&code=<gtin> rather than
// running through the FTS5 fuzz path. We accept hyphens and whitespace
// inside the candidate (some scanners insert spaces, some labels print
// them) and only check digit-length after stripping those.
//
// GTINs in the OFF catalogue are 8, 12, 13, or 14 digits. We accept
// the inclusive 8–14 range to cover ITF-14 + UPC-A + EAN-13 + EAN-8 +
// any pad-style shenanigans the scanner might emit.

/**
 * Strip whitespace + hyphens from a query, then return the residue.
 * @param {unknown} raw
 * @returns {string}
 */
export function stripGtinNoise(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s-]/g, '');
}

/**
 * True iff the query looks like a barcode: all digits, 8–14 long
 * after stripping whitespace and hyphens.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isGtinQuery(raw) {
  const stripped = stripGtinNoise(raw);
  if (stripped.length < 8 || stripped.length > 14) return false;
  return /^\d+$/.test(stripped);
}

// ── Tag parsing + cleaning ───────────────────────────────────────
//
// OFF stores allergen / trace tags as a JSON-encoded array of strings.
// Tags carry a language prefix (`en:`, `fr:`, …) and snake-cased
// English. The cleaner strips the prefix, swaps underscores for
// spaces, and lower-cases the result so chip rendering is consistent.
// Empty / non-string entries are filtered out.

/**
 * Parse the raw `allergens_tags_json` / `traces_tags_json` column.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseAllergenTags(raw) {
  return parseAllergenTagsResult(raw).tags;
}

/**
 * Same parse as {@link parseAllergenTags}, but keeps the crucial food-safety
 * distinction the plain `[]` return throws away (High #3):
 *
 *   - `known: true`  — the OFF field was a valid array (possibly empty). An
 *                      empty array means "this product declares no allergens".
 *   - `known: false` — the field was absent / null / not a string / malformed
 *                      JSON / not an array. We simply DON'T KNOW; the caller
 *                      must not render this as an authoritative "no allergens".
 *
 * A missing allergen record and a confirmed-empty one look identical once
 * collapsed to `[]`, which on a kitchen line reads a "we have no data" product
 * as safe. Callers switch on `known` to render a distinct "not listed" chip.
 *
 * @param {unknown} raw
 * @returns {{ known: boolean, tags: string[] }}
 */
export function parseAllergenTagsResult(raw) {
  if (!raw || typeof raw !== 'string') return { known: false, tags: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { known: false, tags: [] };
    return {
      known: true,
      tags: parsed.filter((s) => typeof s === 'string' && s.length > 0),
    };
  } catch {
    return { known: false, tags: [] };
  }
}

/**
 * Clean a single OFF tag for chip display.
 *
 *   "en:peanuts"          → "peanuts"
 *   "en:milk_and_dairy"   → "milk and dairy"
 *   "fr:gluten"           → "gluten"
 *   "  en:eggs  "         → "eggs"
 *
 * Leaves the casing lower; the chip's CSS handles visual emphasis.
 * @param {unknown} tag
 * @returns {string}
 */
export function cleanAllergenTag(tag) {
  if (typeof tag !== 'string') return '';
  let t = tag.trim();
  // Strip an optional `xx:` language prefix (2-3 letter ISO code).
  const colon = t.indexOf(':');
  if (colon > 0 && colon <= 3 && /^[a-zA-Z]+$/.test(t.slice(0, colon))) {
    t = t.slice(colon + 1);
  }
  return t.replace(/_/g, ' ').trim().toLowerCase();
}

// ── URL building ─────────────────────────────────────────────────
//
// One entrypoint that picks the right op based on the shape of the
// query. The client component only ever calls buildLookupUrl(query) —
// the GTIN-vs-FTS branching lives here so the test suite can pin the
// behaviour without React in the loop.

/**
 * Build the /api/datapack/search URL for a user query. Returns null
 * if the query is blank after trimming.
 * @param {unknown} query
 * @param {{ limit?: number }} [opts]
 * @returns {string | null}
 */
export function buildLookupUrl(query, { limit = 20 } = {}) {
  if (typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams();
  if (isGtinQuery(trimmed)) {
    params.set('op', 'off_product');
    params.set('code', stripGtinNoise(trimmed));
  } else {
    params.set('op', 'search');
    params.set('source', 'off');
    params.set('q', trimmed);
    params.set('limit', String(limit));
  }
  return `/api/datapack/search?${params.toString()}`;
}

/**
 * URL for the per-product drill-in (chip resolution).
 * @param {unknown} code
 * @returns {string | null}
 */
export function offProductUrl(code) {
  if (code === null || code === undefined) return null;
  const params = new URLSearchParams();
  params.set('op', 'off_product');
  params.set('code', String(code));
  return `/api/datapack/search?${params.toString()}`;
}
