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
    assert.match(source, /searchParams\?\.location/, 'route should read searchParams.location');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /location=/, 'route should preserve location in child links');
  });

  it('keeps default-location links clean', () => {
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/today landing content', () => {
  it('anchors cooks around today, punch, 86, and station follow-through', () => {
    const source = read(V2_TODAY_PAGE);
    for (const href of ['/v2/kds/punch', '/v2/eighty-six', '/stations/']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/today`);
    }
  });

  it('uses short kitchen copy for the main cards', () => {
    const source = read(V2_TODAY_PAGE);
    for (const text of ['Line now', '86 right now', 'Stock moves', 'Open line']) {
      assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the v2 today copy`);
    }
    assert.doesNotMatch(source, /dashboard|workflow|analytics|submit/i, 'v2 today should avoid SaaS-style wording');
  });
});
