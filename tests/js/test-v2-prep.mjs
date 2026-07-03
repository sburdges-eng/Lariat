#!/usr/bin/env node
// Static contract for the fifth cook-tier v2 route: /v2/prep.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-prep.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_PREP_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'prep', 'page.jsx');
const V2_HUB_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/prep route file', () => {
  it('ships the fifth cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_PREP_PAGE), 'app/v2/prep/page.jsx should exist');
  });

  it('stays server-rendered and location-aware like v1 prep', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 prep');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
  });

  it('reuses the live v1 prep page instead of a dead stub', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /from ['"].*\/prep\/page\.jsx['"]/, 'v2 prep should import the live prep page');
    assert.match(source, /<PrepPage\s+searchParams=\{sp\}\s*\/?>/, 'v2 prep should pass awaited searchParams through');
  });

  it('keeps cooks moving back to today', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /\/v2\/today/, '/v2/today should be linked from /v2/prep');
  });

  it('is listed on the v2 hub', () => {
    const source = read(V2_HUB_PAGE);
    assert.match(source, /href=["']\/v2\/prep["']/, '/v2/prep should be listed on the v2 hub');
  });
});
