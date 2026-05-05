#!/usr/bin/env node
// Pure-fn tests for lib/hubFailover.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-hub-failover.mjs
//
// detectHubChange() compares the LAST known hub to a fresh discover() peer
// list and reports what changed. Pure function — no I/O, no clock, no input
// mutation. Layered on top of electHub() (PR #157); this file does not
// re-test election order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { detectHubChange } = await import('../../lib/hubFailover.ts');
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

describe('detectHubChange', () => {
  it('cold start, no peers → no-peers', () => {
    const result = detectHubChange({ hub: null }, []);
    assert.deepEqual(result, {
      action: 'no-peers',
      hub: null,
      prevHub: null,
    });
  });

  it('cold start, single peer → first-election picks that peer', () => {
    const only = peer({
      name: 'Lariat',
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const result = detectHubChange({ hub: null }, [only]);
    assert.equal(result.action, 'first-election');
    assert.equal(result.hub, only);
  });

  it('cold start, three peers → first-election agrees with electHub', () => {
    const a = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const b = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const c = peer({
      name: 'Lariat (3)',
      addresses: ['192.168.1.12'],
      started_at: '2026-05-01T08:00:00.000Z',
    });
    const peers = [a, b, c];
    const result = detectHubChange({ hub: null }, peers);
    assert.equal(result.action, 'first-election');
    assert.equal(result.hub, electHub(peers));
  });

  it('hub set, peers list goes empty → lost-hub keeps prevHub', () => {
    const prevHub = peer({
      name: 'Lariat',
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const result = detectHubChange({ hub: prevHub }, []);
    assert.deepEqual(result, {
      action: 'lost-hub',
      hub: null,
      prevHub,
    });
    assert.equal(result.prevHub, prevHub);
  });

  it('hub set, prev hub still in peers (by name) → unchanged returns prev reference', () => {
    const prevHub = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    // Freshly-discovered "same" peer — same name, fresh object.
    const fresh = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const other = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const result = detectHubChange({ hub: prevHub }, [fresh, other]);
    assert.equal(result.action, 'unchanged');
    // Critical: must be the PREV reference, not the fresh copy. Callers
    // ===-compare to detect change.
    assert.equal(result.hub, prevHub);
    assert.notEqual(result.hub, fresh);
  });

  it('hub set, prev hub still in peers but started_at changed → unchanged', () => {
    // Design choice (documented in lib/hubFailover.ts): match key is `name`
    // only. A restart with the same name and a fresher started_at keeps the
    // hub assignment — we don't conflate restart-detection with failover.
    // Future callers that care about restarts can compare started_at
    // separately; this function deliberately doesn't.
    const prevHub = peer({
      name: 'Lariat',
      started_at: '2026-05-01T08:00:00.000Z',
    });
    const restarted = peer({
      name: 'Lariat',
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const result = detectHubChange({ hub: prevHub }, [restarted]);
    assert.equal(result.action, 'unchanged');
    assert.equal(result.hub, prevHub);
  });

  it('hub set, prev hub gone from peers → elected-new with electHub winner', () => {
    const prevHub = peer({
      name: 'Lariat',
      addresses: ['192.168.1.10'],
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const survivor1 = peer({
      name: 'Lariat (2)',
      addresses: ['192.168.1.11'],
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const survivor2 = peer({
      name: 'Lariat (3)',
      addresses: ['192.168.1.12'],
      started_at: '2026-05-04T10:00:00.000Z',
    });
    const peers = [survivor1, survivor2];
    const result = detectHubChange({ hub: prevHub }, peers);
    assert.equal(result.action, 'elected-new');
    assert.equal(result.hub, electHub(peers));
    assert.equal(result.prevHub, prevHub);
  });

  it('is deterministic — repeated calls return same action and same hub reference', () => {
    const prevHub = peer({
      name: 'Lariat',
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const survivor = peer({
      name: 'Lariat (2)',
      started_at: '2026-05-05T12:00:00.000Z',
    });
    const peers = [survivor];
    const r1 = detectHubChange({ hub: prevHub }, peers);
    const r2 = detectHubChange({ hub: prevHub }, peers);
    assert.equal(r1.action, r2.action);
    assert.equal(r1.action, 'elected-new');
    assert.equal(r1.hub, r2.hub);
    assert.equal(r1.hub, survivor);

    // Also confirm 'unchanged' is stable across calls.
    const peersWithPrev = [
      peer({ name: 'Lariat', started_at: '2026-05-03T09:30:00.000Z' }),
    ];
    const u1 = detectHubChange({ hub: prevHub }, peersWithPrev);
    const u2 = detectHubChange({ hub: prevHub }, peersWithPrev);
    assert.equal(u1.action, 'unchanged');
    assert.equal(u2.action, 'unchanged');
    assert.equal(u1.hub, prevHub);
    assert.equal(u2.hub, prevHub);
  });

  it('does not mutate prev or peers', () => {
    const prevHub = peer({
      name: 'Lariat',
      started_at: '2026-05-03T09:30:00.000Z',
    });
    const prev = { hub: prevHub };
    const peers = [
      peer({ name: 'Lariat (2)', started_at: '2026-05-05T12:00:00.000Z' }),
      peer({ name: 'Lariat', started_at: '2026-05-03T09:30:00.000Z' }),
      peer({ name: 'Lariat (3)', started_at: '2026-05-01T08:00:00.000Z' }),
    ];
    const prevSnapshot = JSON.parse(JSON.stringify(prev));
    const peersSnapshot = JSON.parse(JSON.stringify(peers));
    const peersOrderBefore = peers.map((p) => p.name);
    detectHubChange(prev, peers);
    assert.deepEqual(prev, prevSnapshot, 'prev must be unchanged');
    assert.deepEqual(peers, peersSnapshot, 'peers contents must be unchanged');
    assert.deepEqual(
      peers.map((p) => p.name),
      peersOrderBefore,
      'peers order must be unchanged'
    );
  });
});
