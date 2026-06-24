#!/usr/bin/env node
// Integration test for GET /api/beo/cascade (Task 8).
// Run: node --experimental-strip-types --test tests/js/test-beo-cascade-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/cascade/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => db.setDbPathForTest(null));

beforeEach(() => {
  conn.exec(
    `DELETE FROM beo_line_items;
     DELETE FROM beo_events;`,
  );
});

function makeReq(qs = '') {
  return new Request(`http://localhost/api/beo/cascade${qs}`);
}

function seedEvent({ title = 'Test Event', location = 'default' } = {}) {
  const r = conn
    .prepare(
      `INSERT INTO beo_events (title, event_date, location_id) VALUES (?, '2026-06-01', ?)`,
    )
    .run(title, location);
  return Number(r.lastInsertRowid);
}

function seedLine({ event_id, item_name, quantity = 1 }) {
  conn
    .prepare(
      `INSERT INTO beo_line_items (event_id, item_name, quantity) VALUES (?, ?, ?)`,
    )
    .run(event_id, item_name, quantity);
}

describe('GET /api/beo/cascade', () => {
  it('returns 400 when event_id is missing', async () => {
    const res = await route.GET(makeReq(''));
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.error, 'event_id required');
  });

  it('returns 400 when event_id is non-integer string', async () => {
    const res = await route.GET(makeReq('?event_id=abc'));
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.error, 'event_id required');
  });

  it('returns 400 when event_id is zero', async () => {
    const res = await route.GET(makeReq('?event_id=0'));
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.error, 'event_id required');
  });

  it('returns 400 when event_id is negative', async () => {
    const res = await route.GET(makeReq('?event_id=-5'));
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.error, 'event_id required');
  });

  it('returns 404 for a non-existent event_id', async () => {
    const res = await route.GET(makeReq('?event_id=99999'));
    assert.equal(res.status, 404);
    const j = await res.json();
    assert.equal(j.error, 'event not found');
  });

  it('returns 404 when event belongs to a different location (no cross-location leak)', async () => {
    const evId = seedEvent({ location: 'austin' });
    // Query with default location — should 404, not leak austin event data
    const res = await route.GET(makeReq(`?event_id=${evId}&location=default`));
    assert.equal(res.status, 404);
    const j = await res.json();
    assert.equal(j.error, 'event not found');
  });

  it('returns 200 with all-empty arrays for an event with zero line items', async () => {
    const evId = seedEvent();
    const res = await route.GET(makeReq(`?event_id=${evId}`));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.event_id, evId);
    assert.deepEqual(j.order_guide, []);
    assert.deepEqual(j.prep_demands, []);
    assert.deepEqual(j.unmapped, []);
  });

  it('returns 200 with bogus items in unmapped (deterministic with real recipe data)', async () => {
    const evId = seedEvent();
    seedLine({ event_id: evId, item_name: '__not_a_real_menu_item__', quantity: 5 });
    seedLine({ event_id: evId, item_name: '__also_fake_xyz_9999__', quantity: 2 });

    const res = await route.GET(makeReq(`?event_id=${evId}`));
    assert.equal(res.status, 200);
    const j = await res.json();

    assert.equal(j.event_id, evId);
    assert.ok(Array.isArray(j.order_guide), 'order_guide must be array');
    assert.ok(Array.isArray(j.prep_demands), 'prep_demands must be array');
    assert.ok(Array.isArray(j.unmapped), 'unmapped must be array');

    // Bogus items cannot be mapped, so they appear in unmapped
    assert.ok(j.unmapped.length >= 2, `expected >= 2 unmapped, got ${j.unmapped.length}`);
    const unmappedNames = j.unmapped.map((u) => u.menu_item);
    assert.ok(
      unmappedNames.includes('__not_a_real_menu_item__'),
      `expected __not_a_real_menu_item__ in unmapped: ${JSON.stringify(unmappedNames)}`,
    );
    assert.ok(
      unmappedNames.includes('__also_fake_xyz_9999__'),
      `expected __also_fake_xyz_9999__ in unmapped: ${JSON.stringify(unmappedNames)}`,
    );

    // Bogus items can't expand — order guide and prep demands should be empty
    assert.deepEqual(j.order_guide, []);
    assert.deepEqual(j.prep_demands, []);
  });

  it('uses the default location when location param is omitted', async () => {
    const evId = seedEvent({ location: 'default' });
    // No location param — should default to 'default' and find the event
    const res = await route.GET(makeReq(`?event_id=${evId}`));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.event_id, evId);
  });

  it('succeeds when location param matches the event location', async () => {
    const evId = seedEvent({ location: 'austin' });
    const res = await route.GET(makeReq(`?event_id=${evId}&location=austin`));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.event_id, evId);
  });

  it('response shape has correct keys on 200', async () => {
    const evId = seedEvent();
    const res = await route.GET(makeReq(`?event_id=${evId}`));
    const j = await res.json();
    assert.ok('event_id' in j, 'must have event_id');
    assert.ok('order_guide' in j, 'must have order_guide');
    assert.ok('prep_demands' in j, 'must have prep_demands');
    assert.ok('unmapped' in j, 'must have unmapped');
  });
});
