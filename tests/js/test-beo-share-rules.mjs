#!/usr/bin/env node
// Pure-rule tests for lib/beoShare.ts. No DB, no Request — just the
// validation/sanitization helpers that route handlers use as the front
// edge of the public-share surface.
// Run: node --experimental-strip-types --test tests/js/test-beo-share-rules.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const beoShare = await import('../../lib/beoShare.ts');
const {
  SHARE_TOKEN_LENGTH,
  generateShareToken,
  isValidShareTokenShape,
  sanitizeSignedName,
  MAX_SIGNED_NAME_LENGTH,
  clipUserAgent,
  MAX_USER_AGENT_LENGTH,
  extractClientIp,
  buildShareUrl,
} = beoShare;

describe('generateShareToken', () => {
  it('returns a 32-char lowercase hex string', () => {
    const t = generateShareToken();
    assert.equal(t.length, SHARE_TOKEN_LENGTH);
    assert.equal(t.length, 32);
    assert.ok(/^[0-9a-f]{32}$/.test(t), `unexpected token shape: ${t}`);
  });

  it('returns different values on subsequent calls (crypto.randomBytes)', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(generateShareToken());
    assert.equal(seen.size, 50);
  });
});

describe('isValidShareTokenShape', () => {
  it('accepts a freshly generated token', () => {
    assert.equal(isValidShareTokenShape(generateShareToken()), true);
  });

  it('rejects wrong length', () => {
    assert.equal(isValidShareTokenShape('a'.repeat(31)), false);
    assert.equal(isValidShareTokenShape('a'.repeat(33)), false);
    assert.equal(isValidShareTokenShape(''), false);
  });

  it('rejects uppercase hex', () => {
    assert.equal(isValidShareTokenShape('A'.repeat(32)), false);
  });

  it('rejects non-hex chars', () => {
    assert.equal(isValidShareTokenShape('g'.repeat(32)), false);
    assert.equal(isValidShareTokenShape('0'.repeat(31) + '!'), false);
  });

  it('rejects non-string input', () => {
    assert.equal(isValidShareTokenShape(null), false);
    assert.equal(isValidShareTokenShape(undefined), false);
    assert.equal(isValidShareTokenShape(123), false);
    assert.equal(isValidShareTokenShape({}), false);
  });
});

describe('sanitizeSignedName', () => {
  it('trims and returns the name', () => {
    assert.equal(sanitizeSignedName('  Jane Doe  '), 'Jane Doe');
  });

  it('caps at MAX_SIGNED_NAME_LENGTH', () => {
    const long = 'x'.repeat(MAX_SIGNED_NAME_LENGTH + 50);
    const out = sanitizeSignedName(long);
    assert.equal(out.length, MAX_SIGNED_NAME_LENGTH);
  });

  it('returns null for empty / whitespace-only input', () => {
    assert.equal(sanitizeSignedName(''), null);
    assert.equal(sanitizeSignedName('   '), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(sanitizeSignedName(null), null);
    assert.equal(sanitizeSignedName(undefined), null);
    assert.equal(sanitizeSignedName(42), null);
  });

  it('accepts single-character names — lower-bound is a product concern', () => {
    assert.equal(sanitizeSignedName('X'), 'X');
  });
});

describe('clipUserAgent', () => {
  it('caps at MAX_USER_AGENT_LENGTH', () => {
    const long = 'a'.repeat(MAX_USER_AGENT_LENGTH + 100);
    assert.equal(clipUserAgent(long).length, MAX_USER_AGENT_LENGTH);
  });

  it('returns null for empty / non-string', () => {
    assert.equal(clipUserAgent(''), null);
    assert.equal(clipUserAgent(null), null);
  });
});

describe('extractClientIp', () => {
  const makeReq = (headers) => ({ headers: new Headers(headers) });

  it('reads the leftmost X-Forwarded-For entry', () => {
    const req = makeReq({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 10.0.0.1' });
    assert.equal(extractClientIp(req), '203.0.113.7');
  });

  it('falls back to X-Real-IP', () => {
    const req = makeReq({ 'x-real-ip': '198.51.100.4' });
    assert.equal(extractClientIp(req), '198.51.100.4');
  });

  it('returns null when no header is present', () => {
    assert.equal(extractClientIp(makeReq({})), null);
  });

  it('caps the IP at 64 chars (defensive against header abuse)', () => {
    const huge = 'a'.repeat(200);
    const req = makeReq({ 'x-forwarded-for': huge });
    assert.equal(extractClientIp(req).length, 64);
  });
});

describe('buildShareUrl', () => {
  const ORIGINAL = process.env.LARIAT_BASE_URL;
  before(() => { delete process.env.LARIAT_BASE_URL; });
  after(() => {
    if (ORIGINAL === undefined) delete process.env.LARIAT_BASE_URL;
    else process.env.LARIAT_BASE_URL = ORIGINAL;
  });

  it('returns a relative path when LARIAT_BASE_URL is unset', () => {
    assert.equal(buildShareUrl('deadbeef'), '/beo/share/deadbeef');
  });

  it('returns an absolute URL when LARIAT_BASE_URL is set', () => {
    process.env.LARIAT_BASE_URL = 'https://lariat.local';
    assert.equal(buildShareUrl('deadbeef'), 'https://lariat.local/beo/share/deadbeef');
  });

  it('strips trailing slashes on LARIAT_BASE_URL', () => {
    process.env.LARIAT_BASE_URL = 'https://lariat.local///';
    assert.equal(buildShareUrl('deadbeef'), 'https://lariat.local/beo/share/deadbeef');
  });
});
