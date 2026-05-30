#!/usr/bin/env node
// Browsers request /favicon.ico automatically. The packaged app must not
// log a 404 on every page.
//
// Run: node --experimental-strip-types --test tests/js/test-favicon-route.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { GET } = await import('../../app/favicon.ico/route.js');

test('GET /favicon.ico returns an icon response', async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^image\//);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.length > 1000);
});
