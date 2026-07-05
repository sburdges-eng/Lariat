#!/usr/bin/env node
// GET /v2/enable and GET /v2/disable — the one-tap bootstrap for the v2
// preview cookie (docs/OPERATIONS_HANDOFF.md §2 Stage-1 pilot). Visiting
// /v2/enable on a device sets `lariat_v2=1` and lands on /v2/today;
// /v2/disable clears it and lands back on v1's `/`. Replaces the
// devtools-cookie-editing step with a single URL a pilot device can visit
// or bookmark.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-enable-disable-routes.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const enableRoute = await import('../../app/v2/enable/route.js');
const disableRoute = await import('../../app/v2/disable/route.js');

function req(path) {
  return new Request(`http://localhost${path}`);
}

describe('GET /v2/enable', () => {
  it('redirects to /v2/today and sets the lariat_v2 preview cookie', async () => {
    const res = await enableRoute.GET(req('/v2/enable'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/v2/today');

    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie, 'must set a cookie');
    assert.match(cookie, /lariat_v2=1\b/);
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, /SameSite=Lax/i);
    // A long-lived opt-in, not a session cookie — mirrors the locale
    // cookie's 1-year Max-Age (app/_components/LocalePicker.jsx).
    const maxAgeMatch = cookie.match(/Max-Age=(\d+)/i);
    assert.ok(maxAgeMatch, 'must set a Max-Age');
    assert.ok(Number(maxAgeMatch[1]) > 60 * 60 * 24 * 30, 'Max-Age should be long-lived (> 30 days)');
  });
});

describe('GET /v2/disable', () => {
  it('redirects to / and clears the lariat_v2 preview cookie', async () => {
    const res = await disableRoute.GET(req('/v2/disable'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');

    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie, 'must set a cookie to clear it');
    assert.match(cookie, /lariat_v2=;?/);
    assert.match(cookie, /Max-Age=0\b/i);
  });
});
