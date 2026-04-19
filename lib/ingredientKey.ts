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
