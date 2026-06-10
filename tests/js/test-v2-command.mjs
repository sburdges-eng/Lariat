#!/usr/bin/env node
// Static contract for the first v2 manager-tier route: /v2/command.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-command.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_COMMAND_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'command', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/command route file', () => {
  it('ships the first manager-tier migration page', () => {
    assert.ok(fs.existsSync(V2_COMMAND_PAGE), 'app/v2/command/page.jsx should exist');
  });

  it('keeps the route server-rendered and location-aware', () => {
    const source = read(V2_COMMAND_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 command');
    assert.match(source, /(searchParams\?\.location|sp\.location)/, 'route should read location from search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    assert.match(source, /locationId !== DEFAULT_LOCATION_ID \? `\?location=\$\{encodeURIComponent\(locationId\)\}` : ''/, 'default location should not add a redundant query string');
  });
});

describe('/v2/command live route reuse', () => {
  it('reuses the live command page instead of a dead stub', () => {
    const source = read(V2_COMMAND_PAGE);
    assert.match(source, /from ['"].*command\/page\.jsx['"]/, 'v2 command should import the live command page');
    assert.match(source, /<CommandCenter\s+searchParams=\{searchParams\}\s*\/?>/, 'v2 command should pass searchParams through');
  });

  it('keeps managers moving between command, morning, and the cook preview', () => {
    const source = read(V2_COMMAND_PAGE);
    for (const href of ['/v2/today', '/morning']) {
      assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/command`);
    }
  });

  it('uses short line-ready copy instead of dashboard jargon', () => {
    const source = read(V2_COMMAND_PAGE);
    for (const text of ['Command center', 'Open the day', 'Back to line']) {
      assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${text} should appear in the v2 command copy`);
    }
    assert.doesNotMatch(source, /workflow|synergy|optimization platform/i, 'v2 command should avoid SaaS-style wording');
  });
});
