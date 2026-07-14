// @ts-check
// Pure food-safety display model for the Open Food Facts drill-in panel in
// DatapackSearchClient. Lives in its own module so `node --test` can exercise
// the render decision without React, and so the datapack panel reuses the
// SAME allergen parser as the allergen-lookup page (no divergent copy).

import { parseAllergenTagsResult } from '../allergen-lookup/allergenLookupHelpers.js';

/**
 * Render state for an allergen/traces chip row:
 *   - 'has'     — one or more declared tags.
 *   - 'none'    — the OFF field was a valid empty array → declares none.
 *   - 'unknown' — the field was absent / null / malformed → we DON'T know,
 *                 and the panel must not render it as an authoritative
 *                 "no allergens" (a food-safety false-negative on the line).
 * @typedef {'has' | 'none' | 'unknown'} AllergenChipState
 */

/**
 * @param {{ known: boolean, tags: string[] }} res
 * @returns {AllergenChipState}
 */
export function chipState(res) {
  if (res.tags.length > 0) return 'has';
  return res.known ? 'none' : 'unknown';
}

/**
 * Build the allergen + traces display model for one OFF product row.
 * @param {{ allergens_tags_json?: unknown, traces_tags_json?: unknown } | null | undefined} product
 * @returns {{
 *   allergens: { tags: string[], state: AllergenChipState },
 *   traces:    { tags: string[], state: AllergenChipState },
 * }}
 */
export function offAllergenView(product) {
  const a = parseAllergenTagsResult(product?.allergens_tags_json);
  const t = parseAllergenTagsResult(product?.traces_tags_json);
  return {
    allergens: { tags: a.tags, state: chipState(a) },
    traces: { tags: t.tags, state: chipState(t) },
  };
}
