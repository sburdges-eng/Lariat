#!/usr/bin/env node
// Static contract for the opt-in /v2 shell.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-shell.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { NAV_ITEMS, NAV_ROUTE_EXCLUSIONS } = await import('../../app/_components/navRegistry.js');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_DIR = path.join(REPO_ROOT, 'app', 'v2');
const V2_LAYOUT = path.join(V2_DIR, 'layout.jsx');
const V2_PAGE = path.join(V2_DIR, 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2 opt-in shell route files', () => {
  it('ships a v2 layout and landing page', () => {
    assert.ok(fs.existsSync(V2_LAYOUT), 'app/v2/layout.jsx should exist');
    assert.ok(fs.existsSync(V2_PAGE), 'app/v2/page.jsx should exist');
  });

  it('gates the shell on the lariat_v2 preview cookie', () => {
    const source = read(V2_LAYOUT);
    assert.match(source, /from ['"]next\/headers['"]/, 'v2 layout should read request cookies');
    assert.match(source, /V2_PREVIEW_COOKIE\s*=\s*['"]lariat_v2['"]/, 'cookie name should be stable');
    assert.match(source, /cookies\s*\(\s*\)/, 'v2 layout should call cookies()');
    assert.match(source, /\.get\(\s*V2_PREVIEW_COOKIE\s*\)/, 'v2 layout should read the preview cookie');
    assert.match(source, /\.value\s*===\s*['"]1['"]/, 'only lariat_v2=1 should enable the shell');
  });

  it('owns a side-by-side shell instead of reusing the v1 cockpit chrome', () => {
    const source = read(V2_LAYOUT);
    assert.match(source, /data-v2-shell/, 'v2 layout should mark the subtree for shell styling');
    assert.match(source, /\.strip,\s*\.sidebar,\s*\.command/s, 'v2 route should hide v1 chrome');
    assert.match(source, /#main-content/, 'v2 route should reset the root main container');
  });
});

describe('/v2 opt-in shell navigation boundary', () => {
  it('keeps /v2 out of the v1 nav registry and palette', () => {
    assert.deepEqual(
      NAV_ITEMS.filter((item) => item.href === '/v2' || item.href.startsWith('/v2/')),
      [],
      'v2 preview routes must not appear in v1 sidebar or command palette',
    );
  });

  it('documents every shipped v2 preview route as an explicit exclusion', () => {
    const excluded = new Map(NAV_ROUTE_EXCLUSIONS.map((route) => [route.href, route.reason]));
    for (const href of ['/v2', '/v2/today', '/v2/kds/punch', '/v2/eighty-six', '/v2/stations']) {
      assert.ok(excluded.has(href), `${href} should be explicitly excluded from v1 nav coverage`);
      assert.match(excluded.get(href), /cookie/i, `${href} exclusion should explain the preview cookie gate`);
    }
    assert.match(excluded.get('/v2'), /side-by-side/i);
  });
});

describe('/v2 opt-in shell landing content', () => {
  it('anchors the first shell around cook-tier v2 migration routes', () => {
    const source = read(V2_PAGE);
    for (const href of ['/v2/today', '/v2/kds/punch', '/v2/eighty-six', '/v2/stations']) {
      assert.match(source, new RegExp(`href=["']${href.replace('/', '\\/')}["']`), `${href} should be listed`);
    }
  });
});
