#!/usr/bin/env node
// Static contract for the third v2 manager-tier route: /v2/analytics.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-analytics.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_ANALYTICS_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'analytics', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/analytics route file', () => {
  it('ships the third manager-tier migration page', () => {
    assert.ok(fs.existsSync(V2_ANALYTICS_PAGE), 'app/v2/analytics/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_ANALYTICS_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 analytics');
    assert.match(source, /(searchParams\?\.location|sp\.location)/, 'route should read location from search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/analytics live route reuse', () => {
  it('reuses the live analytics page instead of a dead stub', () => {
    const source = read(V2_ANALYTICS_PAGE);
    assert.match(source, /from ['"].*analytics\/page\.jsx['"]/, 'v2 analytics should import the live analytics page');
    assert.match(source, /<AnalyticsPage\s*\/?>/, 'v2 analytics should render the live analytics page');
  });

  it('keeps managers moving between analytics, management, and morning', () => {
    const source = read(V2_ANALYTICS_PAGE);
    for (const href of ['/v2/management', '/morning']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/analytics`);
    }
  });

  it('uses short kitchen-floor copy instead of dashboard jargon', () => {
    const source = read(V2_ANALYTICS_PAGE);
    for (const text of ['Sales numbers', 'Read the numbers fast', 'Back to management']) {
      assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the v2 analytics copy`);
    }
    assert.doesNotMatch(source, /workflow|synergy|optimization platform/i, 'v2 analytics should avoid SaaS-style wording');
  });
});