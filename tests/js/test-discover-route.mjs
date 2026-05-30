#!/usr/bin/env node
// /api/discover must report the same stamped build version as health, logs,
// and the desktop footer.
//
// Run: node --experimental-strip-types --test tests/js/test-discover-route.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { GET } = await import('../../app/api/discover/route.js');
const { getReleaseInfo } = await import('../../lib/release.ts');

describe('GET /api/discover', () => {
  it('uses the stamped release version, not the package semver fallback', async () => {
    const res = await GET();
    const body = await res.json();
    assert.equal(body.name, 'lariat');
    assert.equal(body.version, getReleaseInfo().version);
    assert.match(body.version, /^v\d+\.\d+\.\d{2}\.\d{3}$/);
  });
});
