// @ts-nocheck -- Jest globals are supplied by the test runner.
//
// T6 — Today rush board in the Service Ledger language (flagship).
//
// The Today page is an async server component that hits the DB, so a full RTL
// render of the visual language is impractical. These are source-level
// assertions on the load-bearing contract of the reskin:
//   1. rushColor() and the .rush-* CSS speak in canonical role tokens
//      (--fire / --ok / --accent) — NOT the legacy --red/--green/--yellow
//      aliases — so status colour resolves through the frozen system.
//   2. The board's primary interactive elements carry a visible amber
//      :focus-visible ring (keyboard a11y on the flagship surface).

import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const pageSrc = readFileSync(path.join(root, 'app', 'page.jsx'), 'utf8');
const cssSrc = readFileSync(path.join(root, 'styles', 'globals.css'), 'utf8');

// Isolate the .rush-* block so we assert on rush rules only (other surfaces
// keep their legacy aliases until Phase 2 and must not fail this test).
function rushCss(src) {
  const start = src.indexOf('/* ── Rush home');
  // The next top-level section after rush is "Install-as-app".
  const end = src.indexOf('/* ── Install-as-app', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not locate the .rush-* CSS block in globals.css');
  }
  return src.slice(start, end);
}

describe('TodayPage — Service Ledger token migration', () => {
  test('rushColor() / page.jsx carries no legacy status aliases', () => {
    expect(pageSrc).not.toMatch(/var\(--red\b/);
    expect(pageSrc).not.toMatch(/var\(--green\b/);
    expect(pageSrc).not.toMatch(/var\(--yellow\b/);
  });

  test('rushColor() references the canonical role tokens', () => {
    expect(pageSrc).toMatch(/var\(--fire\)/);
    expect(pageSrc).toMatch(/var\(--ok\)/);
    expect(pageSrc).toMatch(/var\(--accent\)/);
  });

  test('the .rush-* CSS carries no legacy status aliases', () => {
    const rush = rushCss(cssSrc);
    expect(rush).not.toMatch(/var\(--red\b/);
    expect(rush).not.toMatch(/var\(--green\b/);
    expect(rush).not.toMatch(/var\(--yellow\b/);
  });
});

describe('TodayPage — amber focus-visible ring on the board', () => {
  test('a rush primary action has a :focus-visible outline using --accent', () => {
    const rush = rushCss(cssSrc);
    // Find a :focus-visible rule whose selector targets a rush interactive
    // element (.rush-tile / .rush-action / .rush-86) and whose body sets an
    // amber outline.
    const focusRules = [...rush.matchAll(/([^{}]*:focus-visible[^{]*)\{([^}]*)\}/g)];
    const hit = focusRules.find(
      ([, sel, body]) =>
        /\.rush-(tile|action|86)/.test(sel) &&
        /outline\s*:/.test(body) &&
        /var\(--accent\)/.test(body),
    );
    expect(hit).toBeTruthy();
  });
});
