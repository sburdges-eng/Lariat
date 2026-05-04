#!/usr/bin/env node
// Tests for lib/tempPin — pure rule module for temp-PIN issuance and validation.
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPin,
  validatePinFormat,
  isExpired,
  hasScope,
  parseScopes,
  serializeScopes,
  KNOWN_SCOPES,
  PIN_MIN_LEN,
  PIN_MAX_LEN,
} from '../../lib/tempPin.ts';

// ── hashPin ────────────────────────────────────────────────────────

describe('hashPin', () => {
  it('returns 64-char hex (SHA-256)', () => {
    const h = hashPin('1234');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    assert.equal(hashPin('842715'), hashPin('842715'));
  });

  it('distinguishes adjacent PINs', () => {
    assert.notEqual(hashPin('1234'), hashPin('1235'));
  });

  it('does not echo the raw PIN', () => {
    assert.equal(hashPin('1234').includes('1234'), false);
  });
});

// ── validatePinFormat ──────────────────────────────────────────────

describe('validatePinFormat', () => {
  it('accepts a 4-digit PIN', () => {
    const r = validatePinFormat('1234');
    assert.equal(r.ok, true);
  });

  it('accepts a 6-digit PIN', () => {
    const r = validatePinFormat('123456');
    assert.equal(r.ok, true);
  });

  it('rejects a 3-digit PIN as too short', () => {
    const r = validatePinFormat('123');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /short/i);
  });

  it('rejects a 7-digit PIN as too long', () => {
    const r = validatePinFormat('1234567');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /long/i);
  });

  it('rejects non-digit characters', () => {
    const r = validatePinFormat('12a4');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /digits/i);
  });

  it('rejects non-string inputs', () => {
    assert.equal(validatePinFormat(1234).ok, false);
    assert.equal(validatePinFormat(null).ok, false);
    assert.equal(validatePinFormat(undefined).ok, false);
  });

  it('exports PIN_MIN_LEN and PIN_MAX_LEN constants', () => {
    assert.equal(PIN_MIN_LEN, 4);
    assert.equal(PIN_MAX_LEN, 6);
  });
});

// ── isExpired ──────────────────────────────────────────────────────

describe('isExpired', () => {
  it('returns false for a future expires_at', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(isExpired(future), false);
  });

  it('returns true for a past expires_at', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(isExpired(past), true);
  });

  it('returns true for "now" (boundary — expired-on-equal)', () => {
    const now = new Date().toISOString();
    // Sleep 1ms equivalent: any non-future moment is expired.
    assert.equal(isExpired(now, new Date(Date.now() + 1)), true);
  });

  it('accepts an explicit `now` for deterministic testing', () => {
    const t = '2026-05-04T19:00:00.000Z';
    const before = new Date('2026-05-04T18:59:59.999Z');
    const after = new Date('2026-05-04T19:00:00.001Z');
    assert.equal(isExpired(t, before), false);
    assert.equal(isExpired(t, after), true);
  });

  it('treats malformed expires_at as expired (fail-closed)', () => {
    assert.equal(isExpired('not a date'), true);
    assert.equal(isExpired(''), true);
  });
});

// ── parseScopes / serializeScopes ──────────────────────────────────

describe('parseScopes', () => {
  it('parses a JSON array string', () => {
    assert.deepEqual(parseScopes('["beo.fire_at_edit"]'), ['beo.fire_at_edit']);
  });

  it('returns [] for null / undefined / empty string', () => {
    assert.deepEqual(parseScopes(null), []);
    assert.deepEqual(parseScopes(undefined), []);
    assert.deepEqual(parseScopes(''), []);
  });

  it('returns [] for malformed JSON (fail-closed: no scopes)', () => {
    assert.deepEqual(parseScopes('not json'), []);
    assert.deepEqual(parseScopes('{}'), []);
  });

  it('drops non-string entries', () => {
    assert.deepEqual(parseScopes('["beo.fire_at_edit", 42, null]'), ['beo.fire_at_edit']);
  });
});

describe('serializeScopes', () => {
  it('round-trips a known-scope array through parseScopes', () => {
    const original = ['beo.fire_at_edit'];
    assert.deepEqual(parseScopes(serializeScopes(original)), original);
  });

  it('round-trips an empty scope array', () => {
    assert.deepEqual(parseScopes(serializeScopes([])), []);
  });

  it('rejects unknown scope strings', () => {
    assert.throws(() => serializeScopes(['not.a.real.scope']), /unknown scope/i);
  });
});

// ── hasScope ───────────────────────────────────────────────────────

describe('hasScope', () => {
  it('true when the scope is in the array', () => {
    assert.equal(hasScope(['beo.fire_at_edit'], 'beo.fire_at_edit'), true);
  });

  it('false when the scope is not in the array', () => {
    assert.equal(hasScope(['beo.fire_at_edit'], 'kds.bump'), false);
  });

  it('false on empty scopes', () => {
    assert.equal(hasScope([], 'beo.fire_at_edit'), false);
  });
});

// ── KNOWN_SCOPES ───────────────────────────────────────────────────

describe('KNOWN_SCOPES', () => {
  it('includes beo.fire_at_edit', () => {
    assert.ok(KNOWN_SCOPES.includes('beo.fire_at_edit'));
  });

  it('is non-empty (at least one scope to issue)', () => {
    assert.ok(KNOWN_SCOPES.length >= 1);
  });
});
