#!/usr/bin/env node
// Unit tests for the pure helpers in scripts/toast_api/ plus the
// .env.local-aware token-cache staleness check. No network calls.
//
// Run: npm run test:toast-api-helpers

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isCacheStale } from '../../scripts/toast_api/auth.mjs';
import { toIsoZ, utcMidnightDaysAgo } from '../../scripts/toast_api/client.mjs';

describe('isCacheStale', () => {
  it('is stale for null/undefined entries', () => {
    assert.equal(isCacheStale(null, 1_000_000), true);
    assert.equal(isCacheStale(undefined, 1_000_000), true);
  });

  it('is stale when expiresAt is missing or wrong-typed', () => {
    assert.equal(isCacheStale({ accessToken: 'x' }, 1_000_000), true);
    assert.equal(isCacheStale({ accessToken: 'x', expiresAt: '123' }, 1_000_000), true);
  });

  it('is fresh when expiry is well in the future', () => {
    // expires in 1 hour, now=0 → 3600s of headroom > the 300s early-refresh window
    assert.equal(isCacheStale({ accessToken: 'x', expiresAt: 3600 }, 0), false);
  });

  it('triggers early refresh inside the 300s window', () => {
    // expiresAt - 300 <= now  ⇒  stale.
    // For now=10_000, the boundary is expiresAt=10_300.
    assert.equal(isCacheStale({ accessToken: 'x', expiresAt: 10_300 }, 10_000), true);
    assert.equal(isCacheStale({ accessToken: 'x', expiresAt: 10_301 }, 10_000), false);
  });

  it('is stale when expiry is in the past', () => {
    assert.equal(isCacheStale({ accessToken: 'x', expiresAt: 100 }, 10_000), true);
  });
});

describe('toIsoZ', () => {
  it('formats a Date as ISO 8601 with Z suffix', () => {
    const d = new Date(Date.UTC(2026, 3, 20, 0, 0, 0)); // 2026-04-20T00:00:00Z
    assert.equal(toIsoZ(d), '2026-04-20T00:00:00.000Z');
  });

  it('throws on non-Date inputs', () => {
    assert.throws(() => toIsoZ('2026-04-20'), /valid Date/);
    assert.throws(() => toIsoZ(null), /valid Date/);
    assert.throws(() => toIsoZ(new Date('not a date')), /valid Date/);
  });
});

describe('utcMidnightDaysAgo', () => {
  it('returns UTC midnight of the same day for daysAgo=0', () => {
    const now = new Date('2026-04-26T17:30:45Z');
    const d = utcMidnightDaysAgo(now, 0);
    assert.equal(d.toISOString(), '2026-04-26T00:00:00.000Z');
  });

  it('walks back N days at UTC midnight', () => {
    const now = new Date('2026-04-26T17:30:45Z');
    const d = utcMidnightDaysAgo(now, 7);
    assert.equal(d.toISOString(), '2026-04-19T00:00:00.000Z');
  });

  it('crosses month + year boundaries correctly', () => {
    const now = new Date('2026-01-03T05:00:00Z');
    const d = utcMidnightDaysAgo(now, 7);
    assert.equal(d.toISOString(), '2025-12-27T00:00:00.000Z');
  });

  it('does not mutate the input Date', () => {
    const now = new Date('2026-04-26T17:30:45Z');
    const before = now.toISOString();
    utcMidnightDaysAgo(now, 14);
    assert.equal(now.toISOString(), before);
  });
});
