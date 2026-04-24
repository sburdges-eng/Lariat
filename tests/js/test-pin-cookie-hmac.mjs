#!/usr/bin/env node
// Tests for lib/pinCookie — HMAC-signed PIN cookie (A2 hardening).
// Run: node --test tests/js/test-pin-cookie-hmac.mjs
//
// Cookie format: `v1.<base64url(hmac-sha256(secret, "1"))>`.
// Legacy unsigned `1` is accepted only when the secret is unset.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIGNED_COOKIE_PREFIX,
  signPinCookieValue,
  verifyPinCookieValue,
  hasValidPinCookie,
} from '../../lib/pinCookie.ts';

const SECRET = '813b7d4d4bac2cd4ce19db8574a598704c288455f3e6cc5ee0d8cd2a12e7288f';
const SECRET_ALT = 'a'.repeat(64); // different secret → different mac

describe('signPinCookieValue', () => {
  it('returns v1.<hmac> when secret is set', () => {
    const v = signPinCookieValue(SECRET);
    assert.ok(v.startsWith(SIGNED_COOKIE_PREFIX));
    assert.ok(v.length > SIGNED_COOKIE_PREFIX.length + 10);
  });

  it('is deterministic for the same secret', () => {
    assert.strictEqual(signPinCookieValue(SECRET), signPinCookieValue(SECRET));
  });

  it('differs per secret', () => {
    assert.notStrictEqual(signPinCookieValue(SECRET), signPinCookieValue(SECRET_ALT));
  });

  it('falls back to legacy "1" when secret is missing', () => {
    assert.strictEqual(signPinCookieValue(undefined), '1');
    assert.strictEqual(signPinCookieValue(''), '1');
  });
});

describe('verifyPinCookieValue', () => {
  const signed = signPinCookieValue(SECRET);

  it('accepts a freshly-signed cookie', () => {
    assert.strictEqual(verifyPinCookieValue(signed, SECRET), true);
  });

  it('rejects a forged bare "1" when secret is set', () => {
    // This is the whole point of the hardening: stop the naked cookie.
    assert.strictEqual(verifyPinCookieValue('1', SECRET), false);
  });

  it('rejects a cookie signed with a different secret', () => {
    assert.strictEqual(verifyPinCookieValue(signed, SECRET_ALT), false);
  });

  it('rejects a cookie with a mangled tail', () => {
    const bad = signed.slice(0, -2) + 'xx';
    assert.strictEqual(verifyPinCookieValue(bad, SECRET), false);
  });

  it('rejects a cookie with a v1 prefix but empty body', () => {
    assert.strictEqual(verifyPinCookieValue('v1.', SECRET), false);
  });

  it('rejects a cookie that looks signed when secret is missing', () => {
    // Operator set PIN but forgot PIN_SECRET in some step. Don't let
    // the ghosts through the unchecked legacy path.
    assert.strictEqual(verifyPinCookieValue(signed, undefined), false);
  });

  it('accepts legacy "1" in no-secret fallback', () => {
    assert.strictEqual(verifyPinCookieValue('1', undefined), true);
  });

  it('rejects junk input in all modes', () => {
    assert.strictEqual(verifyPinCookieValue('', SECRET), false);
    assert.strictEqual(verifyPinCookieValue(null, SECRET), false);
    assert.strictEqual(verifyPinCookieValue(undefined, SECRET), false);
    assert.strictEqual(verifyPinCookieValue('0', SECRET), false);
    assert.strictEqual(verifyPinCookieValue('', undefined), false);
  });
});

describe('hasValidPinCookie (Request shape)', () => {
  function reqWithCookie(value) {
    return new Request('http://local/', {
      headers: value == null ? {} : { cookie: `lariat_pin_ok=${value}` },
    });
  }

  it('true for a valid signed cookie', () => {
    const v = signPinCookieValue(SECRET);
    assert.strictEqual(hasValidPinCookie(reqWithCookie(v), SECRET), true);
  });

  it('false for a forged bare "1" when secret is set', () => {
    assert.strictEqual(hasValidPinCookie(reqWithCookie('1'), SECRET), false);
  });

  it('true for legacy "1" when secret is unset', () => {
    assert.strictEqual(hasValidPinCookie(reqWithCookie('1'), undefined), true);
  });

  it('false when cookie header is absent', () => {
    assert.strictEqual(hasValidPinCookie(reqWithCookie(null), SECRET), false);
  });

  it('ignores other cookies in the header', () => {
    const v = signPinCookieValue(SECRET);
    const req = new Request('http://local/', {
      headers: { cookie: `other=xxx; lariat_pin_ok=${v}; another=yyy` },
    });
    assert.strictEqual(hasValidPinCookie(req, SECRET), true);
  });
});
