#!/usr/bin/env node
// Tests for lib/localIdentity.ts (audit C2 helper).
//
// Run: node --experimental-strip-types --test tests/js/test-local-identity.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getLocalHost, getStartedAt, newOpId, localIdentityFields } = await import(
  '../../lib/localIdentity.ts'
);

test('getLocalHost returns a non-empty string', () => {
  const h = getLocalHost();
  assert.equal(typeof h, 'string');
  assert.ok(h.length > 0);
});

test('getStartedAt is a parseable ISO timestamp', () => {
  const t = getStartedAt();
  const parsed = Date.parse(t);
  assert.ok(!Number.isNaN(parsed));
  assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('getStartedAt is captured at module load (stable across calls)', () => {
  const a = getStartedAt();
  const b = getStartedAt();
  assert.strictEqual(a, b);
});

test('newOpId returns a UUID-shaped string with version 7', () => {
  const id = newOpId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('newOpId yields distinct ids on consecutive calls', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(newOpId());
  assert.strictEqual(ids.size, 100);
});

test('newOpId timestamps are roughly monotonic', () => {
  const a = newOpId();
  const b = newOpId();
  // First 12 hex chars = 48-bit ms timestamp. b's prefix must be >= a's.
  const aPrefix = a.replace(/-/g, '').slice(0, 12);
  const bPrefix = b.replace(/-/g, '').slice(0, 12);
  assert.ok(bPrefix >= aPrefix, `expected ${bPrefix} >= ${aPrefix}`);
});

test('localIdentityFields bundles the four fields', () => {
  const f = localIdentityFields();
  assert.equal(typeof f.sourceHost, 'string');
  assert.equal(typeof f.sourceStartedAt, 'string');
  assert.match(f.opId, /^[0-9a-f]{8}-/);
  assert.match(f.createdAt, /^\d{4}-/);
});

test('localIdentityFields generates a fresh opId + createdAt each call', () => {
  const a = localIdentityFields();
  const b = localIdentityFields();
  assert.notStrictEqual(a.opId, b.opId);
  // Host + startedAt are stable.
  assert.strictEqual(a.sourceHost, b.sourceHost);
  assert.strictEqual(a.sourceStartedAt, b.sourceStartedAt);
});
