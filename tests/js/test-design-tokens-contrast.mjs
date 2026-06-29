// Computes WCAG 2.1 contrast from the resolved token hexes in styles/tokens.css
// and asserts the Service Ledger accessibility floors. The role tokens must
// carry literal #rrggbb values (never var(...)) so this regex can read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');

// Reads the FIRST literal-hex definition of a token. The :root dark block must
// precede .paper / .k-night in tokens.css or this would read the wrong surface.
const tok = (n) => (css.match(new RegExp(`--${n}\\s*:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];

// Reads a literal-hex token from the .paper{} block specifically
const tokPaper = (n) => {
  const paperBlock = css.match(/\.paper\s*\{([^}]+)\}/s)?.[1] ?? '';
  return (paperBlock.match(new RegExp(`--${n}\\s*:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
};

function L(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const ratio = (a, b) => {
  const l1 = L(a);
  const l2 = L(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

test('text on bg ≥ 7:1', () =>
  assert.ok(
    ratio(tok('text'), tok('bg')) >= 7,
    `got ${ratio(tok('text'), tok('bg')).toFixed(2)}`,
  ));

for (const a of ['accent', 'fire', 'ok', 'info', 'metal']) {
  test(`${a} on panel ≥ 4.5:1`, () =>
    assert.ok(
      ratio(tok(a), tok('panel')) >= 4.5,
      `${a}=${ratio(tok(a), tok('panel')).toFixed(2)}`,
    ));
}

// .paper surface: every accent must clear 4.5:1 against .paper --bg
const paperBg = tokPaper('bg');
for (const a of ['accent', 'fire', 'ok', 'info', 'metal']) {
  test(`.paper ${a} on paper bg ≥ 4.5:1`, () => {
    const hex = tokPaper(a);
    assert.ok(
      hex,
      `tokPaper('${a}') returned undefined — check .paper block has --${a}:#rrggbb`,
    );
    assert.ok(
      ratio(hex, paperBg) >= 4.5,
      `.paper ${a}=${hex} on bg=${paperBg}: got ${ratio(hex, paperBg).toFixed(2)}`,
    );
  });
}
