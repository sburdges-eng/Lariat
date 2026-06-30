// @ts-nocheck — source-contract test (no DOM). Same idiom as OperatorEstimateWiring.test.jsx.
//
// The operator-only estimate overlay — per-line food-cost chips, blended margin,
// the new underwater (negative-margin) red flags, and the F&B-minimum meter — is
// all marked data-print="false". It carries operator-sensitive cost data and must
// NEVER reach a client register or a printed/PDF copy. jsdom cannot evaluate
// @media print, so we assert the estimate.css source contract directly.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CSS = readFileSync(path.join(process.cwd(), 'styles', 'estimate.css'), 'utf8');

describe('estimate print/client isolation — operator overlay never leaks', () => {
  test('client register hides every data-print="false" node', () => {
    // .estimate-doc.client [data-print="false"] { display: none }
    expect(CSS).toMatch(
      /\.estimate-doc\.client\s+\[data-print="false"\]\s*\{[^}]*display:\s*none/,
    );
  });

  test('an @media print block exists', () => {
    expect(CSS).toMatch(/@media\s+print\s*\{/);
  });

  test('print hides every data-print="false" node with !important', () => {
    // This selector (no .client) + `!important` only lives inside @media print,
    // and it must appear after the @media print declaration.
    const printIdx = CSS.search(/@media\s+print\s*\{/);
    const rule =
      /\.estimate-doc\s+\[data-print="false"\]\s*\{[^}]*display:\s*none\s*!important/;
    expect(printIdx).toBeGreaterThan(-1);
    expect(CSS.slice(printIdx)).toMatch(rule);
  });
});
