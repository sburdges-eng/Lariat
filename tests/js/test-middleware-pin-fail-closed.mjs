#!/usr/bin/env node
// Manager surfaces must fail closed when no PIN is configured.
//
// Run: node --experimental-strip-types --test tests/js/test-middleware-pin-fail-closed.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./next-server-mock-loader.mjs', import.meta.url));
register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
delete process.env.LARIAT_PIN;
delete process.env.LARIAT_PIN_SECRET;

const { middleware } = await import('../../middleware.js');

after(() => {
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

function req(pathname) {
  const url = new URL(`http://localhost${pathname}`);
  return {
    url: url.toString(),
    nextUrl: url,
    cookies: { get: () => undefined },
  };
}

describe('middleware PIN fail-closed mode', () => {
  it('redirects manager pages to PIN setup when LARIAT_PIN is unset', async () => {
    const res = await middleware(req('/management/cloud-bridge'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'http://localhost/login-pin?next=%2Fmanagement%2Fcloud-bridge&setup=1');
  });

  it('also redirects the morning digest page when LARIAT_PIN is unset', async () => {
    const res = await middleware(req('/morning'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'http://localhost/login-pin?next=%2Fmorning&setup=1');
  });

  it('returns 503 JSON for sensitive APIs when LARIAT_PIN is unset', async () => {
    const res = await middleware(req('/api/costing'));
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.equal(body.error, 'PIN setup required');
  });

  it('also returns 503 JSON for the morning digest API when LARIAT_PIN is unset', async () => {
    const res = await middleware(req('/api/morning'));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'PIN setup required');
  });

  it('still allows public discovery when LARIAT_PIN is unset', async () => {
    const res = await middleware(req('/api/discover'));
    assert.equal(res.status, 200);
  });
});
