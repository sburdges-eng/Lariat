#!/usr/bin/env node
// Static-asset tests for the LaRiOS design tokens baseline.
//
// This is the additive token rollout from the 2026-05-11 design drop —
// styles/tokens.css ships verbatim from the drop and gets @imported at
// the top of styles/globals.css. The existing token definitions in
// globals.css remain authoritative for currently-shipped UI (CSS
// cascade — later rules win on equal specificity), so importing first
// means tokens.css is the floor, globals.css is the ceiling, and
// future surfaces can opt into the new palette by writing the new
// token names directly.
//
// Run: node --test tests/js/test-design-tokens.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../../', import.meta.url).pathname;
const tokensPath = join(repoRoot, 'styles', 'tokens.css');
const globalsPath = join(repoRoot, 'styles', 'globals.css');

describe('styles/tokens.css — LaRiOS baseline tokens', () => {
  it('the tokens file exists', () => {
    assert.ok(existsSync(tokensPath), `expected ${tokensPath} to exist`);
  });

  it('defines the core paper-stack tokens', () => {
    const css = readFileSync(tokensPath, 'utf8');
    // Bone is the canonical paper background — every surface inherits from it.
    assert.match(css, /--bone\s*:\s*#f3ece0/i, '--bone should be defined');
    assert.match(css, /--paper\s*:\s*#ece2cf/i, '--paper should be defined');
    assert.match(css, /--cream\s*:/i, '--cream should be defined');
  });

  it('defines the ember accent + the new ember-glow signal', () => {
    const css = readFileSync(tokensPath, 'utf8');
    assert.match(css, /--ember\s*:\s*#c85a2a/i, '--ember should be defined');
    // ember-glow is new in this drop — it's the LaRi confidence signal.
    assert.match(css, /--ember-glow\s*:/i, '--ember-glow should be defined');
  });

  it('defines sage/brass/rust supporting accents', () => {
    const css = readFileSync(tokensPath, 'utf8');
    assert.match(css, /--sage\s*:/i, '--sage should be defined');
    assert.match(css, /--brass\s*:/i, '--brass should be defined');
    assert.match(css, /--rust\s*:/i, '--rust should be defined');
  });

  it('exposes the .k-dark and .k-night theme classes', () => {
    const css = readFileSync(tokensPath, 'utf8');
    assert.match(css, /\.k-dark\s*\{/, '.k-dark theme class should be present');
    assert.match(css, /\.k-night\s*\{/, '.k-night theme class should be present');
  });

  it('loads the design fonts via Google Fonts @import', () => {
    const css = readFileSync(tokensPath, 'utf8');
    assert.match(css, /Instrument\+Serif/i, 'Instrument Serif font import expected');
    assert.match(css, /Inter\+Tight/i, 'Inter Tight font import expected');
    assert.match(css, /JetBrains\+Mono/i, 'JetBrains Mono font import expected');
  });
});

describe('styles/globals.css — imports the baseline tokens', () => {
  it('@imports styles/tokens.css before its own :root block', () => {
    const css = readFileSync(globalsPath, 'utf8');
    // Order matters — tokens.css must be loaded BEFORE the existing :root
    // definitions in globals.css so that globals.css overrides where they
    // conflict (no visual regression on currently-shipped UI).
    const importMatch = css.match(/@import\s+(?:url\()?["']\.?\/?tokens\.css["']\)?\s*;/i);
    assert.ok(importMatch, 'globals.css should @import "./tokens.css"');
    const importIdx = importMatch.index ?? -1;
    // Match the actual rule selector, not bare ":root" — the comment above
    // the import legitimately mentions ":root" in prose.
    const rootIdx = css.search(/:root\s*\{/);
    assert.ok(importIdx >= 0, 'import location should be found');
    assert.ok(rootIdx >= 0, ':root rule should still be present in globals.css');
    assert.ok(
      importIdx < rootIdx,
      'the tokens.css @import must precede the :root block so globals.css wins on conflicts',
    );
  });

  it('preserves the existing --ember / --bone / --paper definitions in globals.css', () => {
    // Sanity check that the additive import didn't accidentally delete
    // existing tokens — they're still the authoritative values for
    // currently-shipped UI.
    const css = readFileSync(globalsPath, 'utf8');
    assert.match(css, /--ember\s*:/i, 'globals.css should still define --ember');
    assert.match(css, /--bone\s*:/i, 'globals.css should still define --bone');
    assert.match(css, /--paper\s*:/i, 'globals.css should still define --paper');
  });
});
