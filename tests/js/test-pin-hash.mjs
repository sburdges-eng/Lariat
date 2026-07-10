#!/usr/bin/env node
// Unit tests for lib/pinHash.ts — salted PBKDF2 PIN hashing with a
// migration-safe verify that also accepts the legacy unsalted SHA-256 hex.
//
// Run: node --experimental-strip-types --test tests/js/test-pin-hash.mjs
//
// Security intent (audit 2026-07-10 P0-3): a copied DB must not yield the
// raw PINs. Per-user salt + a slow KDF forces a fresh, non-portable crack
// per row; verifyPin stays constant-time and never throws on junk input.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { hashPinSecure, verifyPin, isLegacyHash } = await import('../../lib/pinHash.ts');

const legacySha256 = (pin) => createHash('sha256').update(pin).digest('hex');

describe('hashPinSecure', () => {
  it('produces a self-describing PBKDF2 string, never the raw PIN or a bare hash', () => {
    const out = hashPinSecure('1234');
    assert.match(out, /^p1\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.notEqual(out, '1234');
    assert.notEqual(out, legacySha256('1234'));
    assert.equal(isLegacyHash(out), false);
  });

  it('salts: the same PIN hashes to two different values', () => {
    assert.notEqual(hashPinSecure('1234'), hashPinSecure('1234'));
  });
});

describe('verifyPin — PBKDF2 round trip', () => {
  it('accepts the correct PIN and rejects a wrong one', () => {
    const stored = hashPinSecure('4242');
    assert.equal(verifyPin('4242', stored), true);
    assert.equal(verifyPin('4243', stored), false);
    assert.equal(verifyPin('424', stored), false);
    assert.equal(verifyPin('42420', stored), false);
  });

  it('two users with the same PIN both verify against their own salted hash', () => {
    const a = hashPinSecure('0000');
    const b = hashPinSecure('0000');
    assert.notEqual(a, b);
    assert.equal(verifyPin('0000', a), true);
    assert.equal(verifyPin('0000', b), true);
  });
});

describe('verifyPin — legacy SHA-256 migration path', () => {
  it('accepts a correct PIN against a legacy unsalted SHA-256 hex hash', () => {
    const legacy = legacySha256('9753');
    assert.equal(isLegacyHash(legacy), true);
    assert.equal(verifyPin('9753', legacy), true);
    assert.equal(verifyPin('0000', legacy), false);
  });
});

describe('verifyPin — never throws, fails closed on junk', () => {
  it('returns false for empty/garbage stored values instead of throwing', () => {
    for (const bad of ['', 'not-a-hash', 'p1$', 'p1$200000$$', 'deadbeef', null, undefined]) {
      assert.equal(verifyPin('1234', bad), false);
    }
  });

  it('returns false (no DoS) when stored iteration count is absurdly large', () => {
    const stored = `p1$999999999999$${Buffer.from('salt').toString('base64')}$${Buffer.from('x').toString('base64')}`;
    assert.equal(verifyPin('1234', stored), false);
  });

  it('returns false when the PIN is not a string', () => {
    const stored = hashPinSecure('1234');
    assert.equal(verifyPin(1234, stored), false);
    assert.equal(verifyPin(null, stored), false);
  });
});

describe('isLegacyHash', () => {
  it('recognizes 64-char lowercase hex as legacy, everything else as not', () => {
    assert.equal(isLegacyHash(legacySha256('1')), true);
    assert.equal(isLegacyHash(hashPinSecure('1')), false);
    assert.equal(isLegacyHash('ABC'), false);
    assert.equal(isLegacyHash('g'.repeat(64)), false);
    assert.equal(isLegacyHash(''), false);
  });
});
