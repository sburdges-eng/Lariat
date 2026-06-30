// T3 lint: No raw #rrggbb literals inside primitive CSS rules (outside token-definition blocks).
//
// TOKEN-DEFINITION BLOCKS — :root{}, .paper{}, .k-dark{}, .k-night{} — legitimately carry
// literal hex and are stripped before scanning.  Everything else (rule bodies for .btn, .chip,
// .allergen-tag, etc.) must express color only through var(--token) references.
//
// VAR() FALLBACKS — var(--token, #fallback) patterns are also stripped before the raw-hex scan
// because the fallback hex is legitimate progressive-enhancement syntax (the token always wins).
//
// Primitive selectors covered: .btn .pill .kpi .surface .tabs .bar .input .card .nav .modal-*
// .chip .allergen-tag  (the last two cover on-accent and allergen violations from T3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const globalsCSS = readFileSync(
  new URL('../../styles/globals.css', import.meta.url),
  'utf8',
);

// ── Strip token-definition blocks so their legitimate literal-hex stays out of scope ──
// Matches :root{…}, .paper{…}, .k-dark{…}, .k-night{…} (flat blocks, no nesting needed).
function stripTokenBlocks(src) {
  return src.replace(
    /(:root|\.paper|\.k-dark|\.k-night)\s*\{[^}]*\}/g,
    (_, sel) => `${sel}{}`,
  );
}

// ── Strip var(--token, #fallback) so fallback hex doesn't trigger the lint ──
function stripVarFallbackHex(src) {
  // Matches var(--anything, #hex) — removes the fallback hex portion
  return src.replace(/var\(--[^,)]+,\s*#[0-9a-fA-F]{3,8}\b[^)]*\)/g, 'var(--stripped)');
}

const strippedGlobals = stripVarFallbackHex(stripTokenBlocks(globalsCSS));

// ── Find raw hex literals inside primitive selector rule bodies ──
// A "rule" = selector text + { body }.  The regex captures selector + body.
// Primitive selectors: .btn .pill .kpi .surface .tabs .bar .input .card .nav .modal-*
//                      .chip .allergen-tag (allergen coverage)
const PRIMITIVE_SELECTOR_RE =
  /(\.[a-z-]*(?:btn|pill|kpi|surface|tabs|bar|input|card|nav|modal|chip|allergen)[a-z0-9-]*[^{]*)\{([^}]*)\}/g;

const RAW_HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

const violations = [];

for (const [, selector, body] of strippedGlobals.matchAll(PRIMITIVE_SELECTOR_RE)) {
  const hexMatches = body.match(RAW_HEX_RE);
  if (hexMatches) {
    for (const hex of hexMatches) {
      violations.push({ selector: selector.trim(), hex });
    }
  }
}

test('no raw hex literals in primitive CSS rules', () => {
  if (violations.length > 0) {
    const detail = violations.map((v) => `  ${v.selector} → ${v.hex}`).join('\n');
    assert.fail(`Found ${violations.length} raw hex literal(s) in primitive rules:\n${detail}`);
  }
});
