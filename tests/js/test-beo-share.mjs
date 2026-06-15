#!/usr/bin/env node
// Unit tests for the pure BEO sharing rule module (lib/beoShare.ts).
//
// Characterization tests against the REAL exports: SHARE_TOKEN_BYTES,
// SHARE_TOKEN_LENGTH, generateShareToken (no args), isValidShareTokenShape,
// MAX_SIGNED_NAME_LENGTH, MAX_USER_AGENT_LENGTH, sanitizeSignedName,
// clipUserAgent, extractClientIp, buildShareUrl.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-share.mjs

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_LENGTH,
  generateShareToken,
  isValidShareTokenShape,
  MAX_SIGNED_NAME_LENGTH,
  MAX_USER_AGENT_LENGTH,
  sanitizeSignedName,
  clipUserAgent,
  extractClientIp,
  buildShareUrl,
} from '../../lib/beoShare.ts';

// ── token constants ─────────────────────────────────────────────

describe('share token constants', () => {
  it('uses 16 random bytes → 32 hex chars (128-bit token)', () => {
    assert.equal(SHARE_TOKEN_BYTES, 16);
    assert.equal(SHARE_TOKEN_LENGTH, 32);
    assert.equal(SHARE_TOKEN_LENGTH, SHARE_TOKEN_BYTES * 2);
  });
});

// ── generateShareToken ──────────────────────────────────────────

describe('generateShareToken', () => {
  it('returns a hex string of length SHARE_TOKEN_LENGTH', () => {
    const tok = generateShareToken();
    assert.equal(typeof tok, 'string');
    assert.equal(tok.length, SHARE_TOKEN_LENGTH);
    assert.match(tok, /^[0-9a-f]+$/);
  });

  it('produces a token that passes isValidShareTokenShape', () => {
    assert.equal(isValidShareTokenShape(generateShareToken()), true);
  });

  it('two calls return different tokens', () => {
    assert.notEqual(generateShareToken(), generateShareToken());
  });
});

// ── isValidShareTokenShape ──────────────────────────────────────

describe('isValidShareTokenShape', () => {
  it('accepts a valid 32-char lowercase hex token', () => {
    assert.equal(isValidShareTokenShape('0123456789abcdef0123456789abcdef'), true);
  });

  it('rejects a token of the wrong length', () => {
    assert.equal(isValidShareTokenShape('0123456789abcdef'), false); // too short
    assert.equal(isValidShareTokenShape('0123456789abcdef0123456789abcdef0'), false); // too long
  });

  it('rejects non-hex characters (incl. uppercase hex)', () => {
    assert.equal(isValidShareTokenShape('0123456789abcdef0123456789abcdeg'), false);
    assert.equal(isValidShareTokenShape('0123456789ABCDEF0123456789ABCDEF'), false);
  });

  it('rejects non-string inputs', () => {
    assert.equal(isValidShareTokenShape(null), false);
    assert.equal(isValidShareTokenShape(undefined), false);
    assert.equal(isValidShareTokenShape(123), false);
    assert.equal(isValidShareTokenShape({}), false);
  });
});

// ── sanitizeSignedName ──────────────────────────────────────────

describe('sanitizeSignedName', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(sanitizeSignedName('  Jane Doe  '), 'Jane Doe');
  });

  it('accepts a bare single-character signature', () => {
    assert.equal(sanitizeSignedName('J'), 'J');
  });

  it('caps to MAX_SIGNED_NAME_LENGTH', () => {
    const long = 'a'.repeat(MAX_SIGNED_NAME_LENGTH + 50);
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
});

// ── clipUserAgent ───────────────────────────────────────────────

describe('clipUserAgent', () => {
  it('trims and returns a normal UA string', () => {
    assert.equal(clipUserAgent('  Mozilla/5.0  '), 'Mozilla/5.0');
  });

  it('caps to MAX_USER_AGENT_LENGTH', () => {
    const long = 'x'.repeat(MAX_USER_AGENT_LENGTH + 100);
    const out = clipUserAgent(long);
    assert.equal(out.length, MAX_USER_AGENT_LENGTH);
  });

  it('returns null for empty / whitespace-only input', () => {
    assert.equal(clipUserAgent(''), null);
    assert.equal(clipUserAgent('   '), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(clipUserAgent(null), null);
    assert.equal(clipUserAgent(undefined), null);
    assert.equal(clipUserAgent(99), null);
  });
});

// ── extractClientIp ─────────────────────────────────────────────

describe('extractClientIp', () => {
  it('prefers the left-most X-Forwarded-For entry', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }) };
    assert.equal(extractClientIp(req), '203.0.113.7');
  });

  it('falls back to X-Real-IP when no XFF', () => {
    const req = { headers: new Headers({ 'x-real-ip': '198.51.100.42' }) };
    assert.equal(extractClientIp(req), '198.51.100.42');
  });

  it('returns null when neither header is present', () => {
    const req = { headers: new Headers({}) };
    assert.equal(extractClientIp(req), null);
  });

  it('caps a pathologically long forwarded IP to 64 chars', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': 'a'.repeat(200) }) };
    assert.equal(extractClientIp(req).length, 64);
  });
});

// ── buildShareUrl ───────────────────────────────────────────────

describe('buildShareUrl', () => {
  const originalBase = process.env.LARIAT_BASE_URL;
  afterEach(() => {
    if (originalBase === undefined) delete process.env.LARIAT_BASE_URL;
    else process.env.LARIAT_BASE_URL = originalBase;
  });

  it('returns a relative path when no base URL is set, and includes the token', () => {
    delete process.env.LARIAT_BASE_URL;
    const token = '0123456789abcdef0123456789abcdef';
    const url = buildShareUrl(token);
    assert.equal(url, `/beo/share/${token}`);
  });

  it('honors LARIAT_BASE_URL and strips trailing slashes', () => {
    process.env.LARIAT_BASE_URL = 'https://lariat.local/';
    const token = '0123456789abcdef0123456789abcdef';
    const url = buildShareUrl(token);
    assert.equal(url, `https://lariat.local/beo/share/${token}`);
  });
});
