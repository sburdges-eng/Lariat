/**
 * Byte-exact mirror of scripts/lib/ingredient_key.py.
 *
 * Python is authoritative. If the algorithm changes, update Python first,
 * regenerate the parity fixture, and fix TS to match. Parity is enforced
 * by tests/js/test-ingredient-key-parity.mjs.
 *
 * Algorithm: lower-case, strip bracketed prefix, drop non-alphanumerics,
 * collapse whitespace.
 */
const BRACKET_PREFIX = /^\s*\[[^\]]*\]\s*/;
// /g is load-bearing — Python re.sub replaces all occurrences by default
const NONALNUM = /[^a-z0-9]+/g;
// /g is load-bearing — Python re.sub replaces all occurrences by default
const WHITESPACE = /\s+/g;

export function normalizeIngredientKey(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value).toLowerCase().trim();
  s = s.replace(BRACKET_PREFIX, '');
  s = s.replace(NONALNUM, ' ').trim();
  s = s.replace(WHITESPACE, ' ');
  return s;
}

/**
 * Derive a stable slug from a recipe-ingredient string. Mirror of the
 * old function in scripts/ingest-costing.mjs (moved here so lib/ → scripts/
 * import direction is eliminated and the script's @ts-nocheck can come off).
 *
 * v1 formula: normalizeIngredientKey(x).replace(/ /g, '_').
 * Returns null when the input normalizes to empty (caller skips the row).
 */
export function deriveMasterId(recipeIngredient: string | null | undefined): string | null {
  const norm = normalizeIngredientKey(recipeIngredient ?? '');
  if (!norm) return null;
  return norm.replace(/ /g, '_');
}
