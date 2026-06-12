#!/usr/bin/env node
// Static contract for the first v2 cook-tier route: /v2/today.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-today.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_TODAY_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'today', 'page.jsx');
const EN_CATALOG = path.join(REPO_ROOT, 'lib', 'i18n', 'messages', 'en.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/today route file', () => {
  it('ships the first cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_TODAY_PAGE), 'app/v2/today/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 today');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /location=/, 'route should preserve location in child links');
  });

  it('keeps default-location links clean', () => {
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });

  it('awaits Next 16 search params and reuses the shared station progress helper', () => {
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /export default async function V2TodayPage/, 'v2 today should be async so promised searchParams can be awaited');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'v2 today should await searchParams before reading location');
    assert.match(source, /typeof sp\.location === 'string'/, 'v2 today should read location from awaited search params');
    assert.match(source, /from ['"].*lib\/stationProgress['"]/, 'v2 today should import the shared stationProgress helper');
    assert.doesNotMatch(source, /function stationProgress\(/, 'v2 today should not keep a duplicate stationProgress helper');
  });
});

describe('/v2/today landing content', () => {
  it('anchors cooks around today, punch, 86, and station follow-through', () => {
    const source = read(V2_TODAY_PAGE);
    for (const href of ['/v2/kds/punch', '/v2/eighty-six', '/v2/stations/']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/today`);
    }
  });

  it('uses short kitchen copy for the main cards (via the i18n catalog)', () => {
    // Copy moved to lib/i18n/messages/en.ts (roadmap 3.8); the page must
    // render through t() and the catalog must carry the kitchen wording.
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /from ['"].*lib\/i18n\/index\.ts['"]/, 'v2 today should import the i18n helper');
    assert.match(source, /t\(m, ['"]today\./, 'v2 today copy should render through t()');

    const catalog = read(EN_CATALOG);
    for (const text of ['Line now', '86 right now', 'Stock moves', 'Open line']) {
      assert.match(catalog, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the en catalog`);
    }
    assert.doesNotMatch(source, /dashboard|workflow|analytics|submit/i, 'v2 today should avoid SaaS-style wording');
    assert.doesNotMatch(catalog, /dashboard|workflow|analytics|submit/i, 'the en catalog should avoid SaaS-style wording');
  });
});
