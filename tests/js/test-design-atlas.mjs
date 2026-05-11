#!/usr/bin/env node
// Static-asset tests for the LaRiOS Design Atlas drop under public/design-atlas/.
//
// The Atlas is pure static reference material served by Next.js out of
// public/. There's no API or route handler — just files. These tests pin
// the expected shape so a future cleanup doesn't accidentally evict the
// drop, and they verify the management page exposes a link to it.
//
// Run: node --test tests/js/test-design-atlas.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../../', import.meta.url).pathname;
const atlasDir = join(repoRoot, 'public', 'design-atlas');

describe('public/design-atlas — static drop', () => {
  it('the design-atlas directory exists', () => {
    assert.ok(existsSync(atlasDir), `expected ${atlasDir} to exist`);
    assert.ok(statSync(atlasDir).isDirectory(), 'design-atlas should be a directory');
  });

  it('serves an index.html landing page', () => {
    const indexPath = join(atlasDir, 'index.html');
    assert.ok(existsSync(indexPath), 'public/design-atlas/index.html missing');
    const html = readFileSync(indexPath, 'utf8');
    // Landing page must link to both prototypes + floorplan + at least one
    // ref image. We don't pin exact markup — just that the hrefs are present.
    assert.match(html, /href=["']\.?\/?LaRiOS\.html["']/i, 'landing should link to LaRiOS.html');
    assert.match(html, /href=["']\.?\/?v2\.html["']/i, 'landing should link to v2.html (renamed from "LaRiOS v2 · Current.html")');
    assert.match(html, /href=["']\.?\/?floorplan\/(index\.html)?["']/i, 'landing should link to floorplan/');
    assert.match(html, /href=["']\.?\/?lariat-vi\/atlas\.html["']/i, 'landing should link to lariat-vi/atlas.html');
    assert.match(html, /ref\/(atlas|handoff|management|lariat-logo)\.png/i, 'landing should reference at least one ref/*.png');
  });

  it('ships the two prototype HTMLs with the renamed v2', () => {
    assert.ok(existsSync(join(atlasDir, 'LaRiOS.html')), 'LaRiOS.html should ship as-is');
    assert.ok(existsSync(join(atlasDir, 'v2.html')), 'v2.html should be present (renamed from "LaRiOS v2 · Current.html")');
    // The original unicode-middle-dot filename must NOT be checked in — URLs
    // with " · " are a foot-gun (browser-dependent percent-encoding).
    assert.ok(
      !existsSync(join(atlasDir, 'LaRiOS v2 · Current.html')),
      'the unicode-middle-dot filename must not be present in public/',
    );
  });

  it('ships the floorplan sub-app', () => {
    const fpIndex = join(atlasDir, 'floorplan', 'index.html');
    assert.ok(existsSync(fpIndex), 'floorplan/index.html missing');
    const size = statSync(fpIndex).size;
    // The drop's floorplan is ~530KB. Sanity-check we shipped the real file,
    // not an empty placeholder.
    assert.ok(size > 100_000, `floorplan/index.html should be the real ~530KB asset, got ${size} bytes`);
  });

  it('ships the lariat-vi atlas sub-prototype', () => {
    assert.ok(
      existsSync(join(atlasDir, 'lariat-vi', 'atlas.html')),
      'lariat-vi/atlas.html missing',
    );
  });

  it('ships the ref PNGs', () => {
    for (const png of ['atlas.png', 'handoff.png', 'lariat-logo.png', 'management.png']) {
      assert.ok(
        existsSync(join(atlasDir, 'ref', png)),
        `ref/${png} missing under public/design-atlas/`,
      );
    }
  });
});

describe('app/management — Design Atlas link', () => {
  it('management page links to /design-atlas/', () => {
    const mgmtPath = join(repoRoot, 'app', 'management', 'page.jsx');
    assert.ok(existsSync(mgmtPath), 'app/management/page.jsx missing');
    const src = readFileSync(mgmtPath, 'utf8');
    assert.match(
      src,
      /\/design-atlas\/?/,
      'management page should expose a link/tile pointing to /design-atlas/',
    );
  });
});
