#!/usr/bin/env node
// Static contract for the fourth v2 cook-tier route: /v2/stations.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-stations.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_STATIONS_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'stations', 'page.jsx');
const V2_STATION_DETAIL_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'stations', '[id]', 'page.jsx');
const V2_TODAY_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'today', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/stations route files', () => {
  it('ships the fourth cook-tier migration pages', () => {
    assert.ok(fs.existsSync(V2_STATIONS_PAGE), 'app/v2/stations/page.jsx should exist');
    assert.ok(fs.existsSync(V2_STATION_DETAIL_PAGE), 'app/v2/stations/[id]/page.jsx should exist');
  });

  it('keeps both routes server-rendered and location-aware', () => {
    const indexSource = read(V2_STATIONS_PAGE);
    const detailSource = read(V2_STATION_DETAIL_PAGE);

    for (const source of [indexSource, detailSource]) {
      assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 stations');
      assert.match(source, /searchParams\?\.location|sp\.location/, 'route should read the location param');
      assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
    }
  });
});

describe('/v2/stations live route reuse', () => {
  it('reuses the live station pages instead of dead stubs', () => {
    const indexSource = read(V2_STATIONS_PAGE);
    const detailSource = read(V2_STATION_DETAIL_PAGE);

    assert.match(indexSource, /from ['"].*stations\/page\.jsx['"]/, 'v2 stations should import the live stations page');
    assert.match(indexSource, /<StationsPage\s+searchParams=\{searchParams\}\s*\/?>/, 'v2 stations should pass searchParams through');

    assert.match(detailSource, /from ['"].*stations\/\[id\]\/page\.jsx['"]/, 'v2 station detail should import the live station detail page');
    assert.match(detailSource, /<StationPage\s+params=\{params\}\s+searchParams=\{searchParams\}\s*\/?>/, 'v2 station detail should pass params and searchParams through');
  });

  it('keeps cooks moving between today, stations, and each board', () => {
    const detailSource = read(V2_STATION_DETAIL_PAGE);
    for (const href of ['/v2/today', '/v2/stations']) {
      assert.match(detailSource, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${href} should be linked from /v2/stations/[id]`);
    }
  });
});

describe('/v2/today station follow-through', () => {
  it('sends cooks into the v2 station boards', () => {
    const source = read(V2_TODAY_PAGE);
    assert.match(source, /\/v2\/stations\//, 'today cards should open v2 station boards');
  });
});
