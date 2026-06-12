#!/usr/bin/env node
// Static contract for the third v2 cook-tier route: /v2/eighty-six.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-eighty-six.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_EIGHTY_SIX_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'eighty-six', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/eighty-six route file', () => {
  it('ships the third cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_EIGHTY_SIX_PAGE), 'app/v2/eighty-six/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_EIGHTY_SIX_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 86');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/eighty-six landing content', () => {
  it('keeps cooks anchored to today and punch follow-through', () => {
    const source = read(V2_EIGHTY_SIX_PAGE);
    for (const href of ['/v2/today', '/v2/kds/punch']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/eighty-six`);
    }
  });

  it('reuses the live 86 board instead of a dead stub', () => {
    const source = read(V2_EIGHTY_SIX_PAGE);
    assert.match(source, /from ['"].*eighty-six\/page\.jsx['"]/, 'v2 route should import the live 86 page');
    assert.match(source, /<EightySixPage\s+searchParams=\{sp\}\s*\/?>/, 'v2 route should pass awaited searchParams into the live 86 page');
  });

  it('uses short kitchen copy for the shell (via the i18n catalog)', () => {
    // Copy moved to lib/i18n/messages/en.ts (roadmap 3.8); the shell must
    // render through t() and the catalog carries the kitchen wording
    // (pinned by tests/js/test-i18n-catalog.mjs banned-word checks).
    const source = read(V2_EIGHTY_SIX_PAGE);
    assert.match(source, /from ['"].*lib\/i18n\/index\.ts['"]/, 'shell should import the i18n helper');
    assert.match(source, /t\(m, ['"]shells\.eightySix\./, 'shell copy should render through t()');
    const catalog = read(path.join(REPO_ROOT, 'lib', 'i18n', 'messages', 'en.ts'));
    for (const text of ['86 now', "What's out", 'Back to today', 'Send to line']) {
      assert.match(catalog, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the en catalog`);
    }
    assert.doesNotMatch(source, /dashboard|workflow|analytics|submit|configure/i, 'v2 86 should avoid SaaS-style wording');
  });
});
