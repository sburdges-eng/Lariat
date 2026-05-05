#!/usr/bin/env node
// Pure-fn tests for lib/hubElection.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-hub-election.mjs
//
// Hub election picks the most-stable peer from a set of mDNS-discovered
// instances. Oldest started_at wins; tie-break on name; missing started_at
// sorts last. Pure function — no I/O, no clock, no input mutation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { electHub } = await import('../../lib/hubElection.ts');

/**
 * Build a DiscoveredInstance with sensible defaults; override any field via
 * the optional partial. `started_at` is included in the txt record only when
 * passed (so `undefined` truly means "missing").
 */
function peer(overrides = {}) {
  const {
    name = 'Lariat',
    host = 'lariat.local.',
    addresses = ['192.168.1.10'],
    port = 3000,
    version,
    location_id = 'default',
    started_at,
  } = overrides;
  const txt = { location_id };
  if (version !== undefined) txt.version = version;
  if (started_at !== undefined) txt.started_at = started_at;
  return { name, host, addresses, port, txt };
}

describe('electHub', () => {
  it('returns null for an empty array', () => {
    assert.equal(electHub([]), null);
  });

  it('returns the sole peer when given exactly one (even with no started_at)', () => {
    const only = peer({ name: 'Lariat' }); // started_at intentionally missing
    assert.equal(electHub([only]), only);
  });

  it('returns the sole peer when given one (with started_at)', () => {
    const only = peer({ name: 'Lariat', started_at: '2026-05-05T12:00:00.000Z' });
    assert.equal(electHub([only]), only);
  });

  it('picks the peer with the earliest started_at (oldest = most stable)', () => {
    const oldest = peer({
      name: 'Lariat (3)',
      addresses: ['192.168.1.12'],
      started_at: '2026-05-01T08:00:00.000Z',
    });
    const middle = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const newest = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    assert.equal(electHub([newest, middle, oldest]), oldest);
    assert.equal(electHub([oldest, middle, newest]), oldest);
  });

  it('breaks started_at ties by lexicographically smallest name', () => {
    const a = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const b = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    assert.equal(electHub([a, b]), a);
    assert.equal(electHub([b, a]), a);
  });

  it('sorts peers with a real started_at ahead of peers missing it', () => {
    const withTs = peer({
      name: 'Zeta', // alphabetically last — would lose on name alone
      addresses: ['192.168.1.20'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const missing = peer({
      name: 'Alpha', // alphabetically first
      addresses: ['192.168.1.21'],
      // started_at omitted
    });
    assert.equal(electHub([withTs, missing]), withTs);
    assert.equal(electHub([missing, withTs]), withTs);
  });

  it('treats empty-string started_at as missing', () => {
    const withTs = peer({
      name: 'Zeta',
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const empty = peer({ name: 'Alpha', started_at: '' });
    assert.equal(electHub([withTs, empty]), withTs);
    assert.equal(electHub([empty, withTs]), withTs);
  });

  it('falls through to name tie-break when all peers are missing started_at', () => {
    const a = peer({ name: 'Lariat', addresses: ['192.168.1.10'] });
    const b = peer({ name: 'Lariat (2)', addresses: ['192.168.1.11'] });
    const c = peer({ name: 'Lariat (3)', addresses: ['192.168.1.12'] });
    assert.equal(electHub([c, b, a]), a);
    assert.equal(electHub([a, b, c]), a);
  });

  it('is deterministic — every permutation elects the same peer reference', () => {
    const a = peer({ name: 'Lariat (2)', started_at: '2026-05-05T12:00:00.000Z' });
    const b = peer({ name: 'Lariat', started_at: '2026-05-03T09:30:00.000Z' });
    const c = peer({ name: 'Lariat (3)', started_at: '2026-05-01T08:00:00.000Z' });
    // c has the earliest started_at, so it must win every time regardless of
    // input order. All 6 permutations of [a,b,c] catch a non-deterministic
    // tie-breaker (e.g. a random pick among equals) that a single rotation
    // would miss.
    const expected = c;
    const permutations = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const perm of permutations) {
      assert.equal(
        electHub(perm),
        expected,
        `permutation ${perm.map((p) => p.name).join(',')} must elect ${expected.name}`
      );
    }
    // Same input twice in a row returns the same object reference (the
    // narrower "stable across repeated calls" claim, kept explicit).
    const winner1 = electHub([a, b, c]);
    const winner2 = electHub([a, b, c]);
    assert.equal(winner1, winner2);
    assert.equal(winner1, expected);
  });

  it('does not mutate the caller’s array', () => {
    const peers = [
      peer({ name: 'Lariat (2)', started_at: '2026-05-05T12:00:00.000Z' }),
      peer({ name: 'Lariat', started_at: '2026-05-03T09:30:00.000Z' }),
      peer({ name: 'Lariat (3)', started_at: '2026-05-01T08:00:00.000Z' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(peers));
    const orderBefore = peers.map((p) => p.name);
    electHub(peers);
    assert.deepEqual(peers, snapshot, 'peers contents must be unchanged');
    assert.deepEqual(
      peers.map((p) => p.name),
      orderBefore,
      'peers order must be unchanged'
    );
  });
});
