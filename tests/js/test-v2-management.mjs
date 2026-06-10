#!/usr/bin/env node
// Static contract for the second v2 manager-tier route: /v2/management.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-management.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_MANAGEMENT_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'management', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/management route file', () => {
  it('ships the second manager-tier migration page', () => {
    assert.ok(fs.existsSync(V2_MANAGEMENT_PAGE), 'app/v2/management/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_MANAGEMENT_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 management');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/management live route reuse', () => {
  it('reuses the live management page instead of a dead stub', () => {
    const source = read(V2_MANAGEMENT_PAGE);
    assert.match(source, /from ['"].*management\/page\.jsx['"]/, 'v2 management should import the live management page');
    assert.match(source, /<ManagementPage\s+searchParams=\{sp\}\s*\/?>/, 'v2 management should pass awaited searchParams through');
  });

  it('keeps managers moving between command, management, and analytics', () => {
    const source = read(V2_MANAGEMENT_PAGE);
    for (const href of ['/v2/command', '/v2/analytics']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/management`);
    }
  });

  it('uses short manager copy instead of dashboard jargon', () => {
    const source = read(V2_MANAGEMENT_PAGE);
    for (const text of ['Management rollup', 'Check the whole house', 'Back to command']) {
      assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the v2 management copy`);
    }
    assert.doesNotMatch(source, /workflow|synergy|optimization platform/i, 'v2 management should avoid SaaS-style wording');
  });
});
