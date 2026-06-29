// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// T5 (Service Ledger reskin): the client-facing BEO share sheet must render as a
// bright `.paper` document on the dark app. The page is an async server component
// that calls notFound() and hits the DB, so rendering it through RTL is
// impractical here. Instead we assert the *document root wrapper* (the first
// element opened inside the page's returned fragment, which wraps the whole
// sheet) carries the `paper` class — that's the load-bearing change the reskin
// depends on. A bare substring check would pass on the unrelated `--paper` token
// already in the file, so we anchor on the wrapper's className attribute.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// jest's rootDir is the project root (process.cwd()), so resolve from there.
const PAGE_PATH = path.join(process.cwd(), 'app', 'beo', 'share', '[token]', 'page.jsx');

describe('BEO share page — .paper document surface', () => {
  const src = readFileSync(PAGE_PATH, 'utf8');

  test('the document root wrapper carries the `paper` class', () => {
    // Find the FIRST `<div` opening tag that appears after the chrome-hiding
    // <style dangerouslySetInnerHTML .../> block — that is the document root
    // wrapper. (The notFound() helper also opens a <div>, but it sits before
    // this style block in source, so anchoring here skips it.)
    const styleIdx = src.indexOf('dangerouslySetInnerHTML');
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    const afterStyle = src.slice(styleIdx);
    const divOpenIdx = afterStyle.indexOf('<div');
    expect(divOpenIdx).toBeGreaterThanOrEqual(0);

    // Slice across the wrapper's opening tag (className + style object span
    // several lines; the {{...}} style object holds no top-level `>` before the
    // tag closes), then require className to include the `paper` token.
    const tagSlice = afterStyle.slice(divOpenIdx, divOpenIdx + 600);
    // className="paper" (allow extra classes, e.g. className="paper sheet")
    expect(tagSlice).toMatch(/className=("|')[^"']*\bpaper\b[^"']*\1/);
  });
});
