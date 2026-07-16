#!/usr/bin/env node
// Unit-pins the cloud-bridge canonical serialization rule (B.5 / PROTECTED_CONTRACTS §11.4).
// The Swift twin (LariatModel/CloudBridge/CanonicalJSON.swift) must match this byte-for-byte.
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-canonical.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));
const { canonicalize, TABLE_WIRE_VERSION } = await import('../../lib/cloudBridgeCanonical.ts');

describe('cloud-bridge canonical serialization', () => {
  it('sorts object keys recursively and emits no whitespace', () => {
    assert.equal(canonicalize({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
  });
  it('does not escape forward slashes (matches V8; Swift default would escape them)', () => {
    assert.equal(canonicalize({ p: 'a/b' }), '{"p":"a/b"}');
  });
  it('preserves array order but sorts keys inside array elements', () => {
    assert.equal(canonicalize({ rows: [{ y: 2, x: 1 }] }), '{"rows":[{"x":1,"y":2}]}');
  });
  it('throws on a non-integer number (fail-loud keeps cross-language parity safe)', () => {
    assert.throws(() => canonicalize({ n: 1.5 }), /non-integer/);
  });
  it('throws on a non-finite number', () => {
    assert.throws(() => canonicalize({ n: Infinity }), /non-integer/);
  });
  it('throws on an integer-like object key (engines reorder these numerically)', () => {
    assert.throws(() => canonicalize({ '10': 1, '9': 2 }), /integer-like object key/);
  });
  it('throws on NaN', () => {
    assert.throws(() => canonicalize({ n: NaN }), /non-integer/);
  });
});

describe('cloud-bridge wire-version map', () => {
  it('is a non-empty map of integer versions', () => {
    const entries = Object.entries(TABLE_WIRE_VERSION);
    assert.ok(entries.length >= 1);
    for (const [, v] of entries) assert.ok(Number.isInteger(v) && v >= 1);
  });
});
