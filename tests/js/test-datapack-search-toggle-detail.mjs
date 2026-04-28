#!/usr/bin/env node
// Tests for app/datapack-search/detailsState — the pure state-machine
// helper extracted from DatapackSearchClient.jsx so the per-row
// drill-in toggle logic can be exercised without React.
//
// Run: node --experimental-strip-types --test tests/js/test-datapack-search-toggle-detail.mjs
//
// The state machine is documented in detailsState.ts. These tests
// cover the four observable transitions (open-fresh, reopen-cached,
// collapse, noop-loading) plus the full happy-path lifecycle:
//   undefined -> loading -> ok -> closed -> reopen-cached(ok)
// — which is the round-trip the previous reviewer flagged as the
// motivating use case.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nextDetails } from '../../app/datapack-search/detailsState.ts';

const KEY = 'usda:12345';

describe('nextDetails — open-fresh', () => {
  it('flips an undefined row to loading and signals open-fresh', () => {
    const prev = {};
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'open-fresh');
    assert.deepEqual(next[KEY], { status: 'loading' });
  });

  it('treats an existing key with an unrelated value the same as missing', () => {
    // A previously-closed row WITHOUT cached `data` (e.g. a row that
    // errored, then was collapsed) should refetch on the next click.
    const prev = { [KEY]: { status: 'closed' } };
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'open-fresh');
    assert.deepEqual(next[KEY], { status: 'loading' });
  });

  it('does not mutate the prev map', () => {
    const prev = {};
    const { next } = nextDetails(prev, KEY);
    assert.notEqual(next, prev);
    assert.equal(prev[KEY], undefined);
  });
});

describe('nextDetails — collapse', () => {
  it('flips an ok row to closed while preserving the cached data', () => {
    const data = { food: { fdc_id: 12345, description: 'Egg' } };
    const prev = { [KEY]: { status: 'ok', data } };
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'collapse');
    assert.equal(next[KEY].status, 'closed');
    assert.equal(next[KEY].data, data);
  });

  it('flips an error row to closed (preserving error), so the next click refetches', () => {
    const prev = { [KEY]: { status: 'error', error: 'HTTP 500' } };
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'collapse');
    assert.equal(next[KEY].status, 'closed');
    assert.equal(next[KEY].data, undefined);
    // Next click on an errored-then-closed row should refetch.
    const second = nextDetails(next, KEY);
    assert.equal(second.action, 'open-fresh');
  });
});

describe('nextDetails — reopen-cached', () => {
  it('flips a closed-with-cache row back to ok without a fetch', () => {
    const data = { food: { fdc_id: 12345, description: 'Egg' } };
    const prev = { [KEY]: { status: 'closed', data } };
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'reopen-cached');
    assert.deepEqual(next[KEY], { status: 'ok', data });
  });
});

describe('nextDetails — noop-loading (concurrent-click guard)', () => {
  it('returns prev unchanged when the row is already loading', () => {
    const prev = { [KEY]: { status: 'loading' } };
    const { next, action } = nextDetails(prev, KEY);
    assert.equal(action, 'noop-loading');
    assert.equal(next, prev, 'should return the same object reference');
  });
});

describe('nextDetails — full lifecycle', () => {
  it('walks open-fresh -> ok -> collapse -> reopen-cached without a refetch', () => {
    // 1) First click: undefined -> loading.
    let state = {};
    const r1 = nextDetails(state, KEY);
    assert.equal(r1.action, 'open-fresh');
    state = r1.next;
    assert.deepEqual(state[KEY], { status: 'loading' });

    // 2) Click while loading: dropped.
    const r2 = nextDetails(state, KEY);
    assert.equal(r2.action, 'noop-loading');
    assert.equal(r2.next, state);

    // 3) Fetch resolves — caller sets ok with data.
    const data = { food: { fdc_id: 12345 } };
    state = { ...state, [KEY]: { status: 'ok', data } };

    // 4) Second click: collapse (preserves data).
    const r3 = nextDetails(state, KEY);
    assert.equal(r3.action, 'collapse');
    state = r3.next;
    assert.equal(state[KEY].status, 'closed');
    assert.equal(state[KEY].data, data);

    // 5) Third click: reopen-cached (no refetch).
    const r4 = nextDetails(state, KEY);
    assert.equal(r4.action, 'reopen-cached');
    state = r4.next;
    assert.deepEqual(state[KEY], { status: 'ok', data });

    // 6) Fourth click: collapse again — state still has data.
    const r5 = nextDetails(state, KEY);
    assert.equal(r5.action, 'collapse');
    assert.equal(r5.next[KEY].data, data);
  });

  it('keeps unrelated rows untouched on every transition', () => {
    const otherKey = 'wikibooks:99';
    const otherEntry = { status: 'ok', data: { page: { id: 99 } } };
    let state = { [otherKey]: otherEntry };

    const r1 = nextDetails(state, KEY);
    assert.equal(r1.next[otherKey], otherEntry);

    state = r1.next;
    state = { ...state, [KEY]: { status: 'ok', data: { food: {} } } };

    const r2 = nextDetails(state, KEY);
    assert.equal(r2.next[otherKey], otherEntry);
  });
});

describe('nextDetails — determinism', () => {
  it('returns equivalent next states for the same prev (StrictMode-safe)', () => {
    // React 18 StrictMode invokes setState updaters twice in dev. Both
    // calls receive the same prev and must produce the same next.
    const prev = { [KEY]: { status: 'closed', data: { food: {} } } };
    const a = nextDetails(prev, KEY);
    const b = nextDetails(prev, KEY);
    assert.equal(a.action, b.action);
    assert.deepEqual(a.next, b.next);
  });
});
