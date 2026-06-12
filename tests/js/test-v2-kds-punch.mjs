#!/usr/bin/env node
// Static contract for the second v2 cook-tier route: /v2/kds/punch.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-kds-punch.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_KDS_PUNCH_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'kds', 'punch', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/kds/punch route file', () => {
  it('ships the second cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_KDS_PUNCH_PAGE), 'app/v2/kds/punch/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_KDS_PUNCH_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 punch');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/kds/punch landing content', () => {
  it('keeps cooks anchored to today and 86 follow-through', () => {
    const source = read(V2_KDS_PUNCH_PAGE);
    for (const href of ['/v2/today', '/v2/eighty-six']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/kds/punch`);
    }
  });

  it('reuses the live punch form instead of a dead stub', () => {
    const source = read(V2_KDS_PUNCH_PAGE);
    assert.match(source, /from ['"].*kds\/punch\/page\.jsx['"]/, 'v2 route should import the live punch form');
    assert.match(source, /<PunchTicketPage\s*\/?>/, 'v2 route should render the live punch form');
  });

  it('uses short kitchen copy for the shell (via the i18n catalog)', () => {
    // Copy moved to lib/i18n/messages/en.ts (roadmap 3.8); the shell must
    // render through t() and the catalog carries the kitchen wording
    // (pinned by tests/js/test-i18n-catalog.mjs banned-word checks).
    const source = read(V2_KDS_PUNCH_PAGE);
    assert.match(source, /from ['"].*lib\/i18n\/index\.ts['"]/, 'shell should import the i18n helper');
    assert.match(source, /t\(m, ['"]shells\.punch\./, 'shell copy should render through t()');
    const catalog = read(path.join(REPO_ROOT, 'lib', 'i18n', 'messages', 'en.ts'));
    for (const text of ['Punch now', 'Send to line', 'Back to today', 'Watch 86']) {
      assert.match(catalog, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the en catalog`);
    }
    assert.doesNotMatch(source, /dashboard|workflow|analytics|submit|configure/i, 'v2 punch should avoid SaaS-style wording');
  });
});
