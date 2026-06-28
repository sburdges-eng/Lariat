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
     DELETE FROM beo_events;
     DELETE FROM inventory_count_lines;
     DELETE FROM inventory_counts;`,
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

function seedCount({ location = 'default', count_date = '2026-06-01' } = {}) {
  const r = conn
    .prepare(
      `INSERT INTO inventory_counts (count_date, location_id) VALUES (?, ?)`,
    )
    .run(count_date, location);
  return Number(r.lastInsertRowid);
}

function seedCountLine({ count_id, ingredient, unit = 'case', on_hand_qty = 0, location = 'default' }) {
  conn
    .prepare(
      `INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(count_id, ingredient, unit, on_hand_qty, location);
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

  // T5: on-hand inventory subtraction + on_hand_unapplied + manifest_warnings
  it('subtracts on-hand from total_needed and surfaces unapplied count lines', async () => {
    // "Churros" → recipe churros → single leaf: ingredient="churros (sysco)", unit="case"
    const evId = seedEvent({ location: 'default' });
    seedLine({ event_id: evId, item_name: 'Churros', quantity: 5 });

    // Seed a latest inventory count for the same location
    const countId = seedCount({ location: 'default', count_date: '2026-06-01' });

    // A count line whose ingredient/unit exactly match the leaf (lowercased match)
    const ON_HAND = 2;
    seedCountLine({ count_id: countId, ingredient: 'churros (sysco)', unit: 'case', on_hand_qty: ON_HAND });

    // A junk count line that will not match any leaf
    seedCountLine({ count_id: countId, ingredient: 'definitely not real widget', unit: 'kg', on_hand_qty: 7 });

    const res = await route.GET(makeReq(`?event_id=${evId}`));
    assert.equal(res.status, 200);
    const j = await res.json();

    // order_guide should have the leaf with reduced to_order
    const leafRow = j.order_guide.find(
      (r) => r.ingredient === 'churros (sysco)' && r.unit === 'case',
    );
    assert.ok(leafRow, `expected churros (sysco)/case in order_guide; got ${JSON.stringify(j.order_guide)}`);
    assert.equal(leafRow.total_needed, 5, 'total_needed must be 5 (1 per item × 5 qty, qty_in_yield_units)');
    assert.equal(leafRow.on_hand, ON_HAND, `on_hand must be ${ON_HAND}`);
    assert.equal(leafRow.to_order, 5 - ON_HAND, `to_order must be ${5 - ON_HAND}`);

    // The junk count line must appear in on_hand_unapplied
    assert.ok(Array.isArray(j.on_hand_unapplied), 'on_hand_unapplied must be an array');
    const unappliedKeys = j.on_hand_unapplied.map((u) => `${u.ingredient}|${u.unit}`);
    assert.ok(
      unappliedKeys.includes('definitely not real widget|kg'),
      `expected junk line in on_hand_unapplied; got ${JSON.stringify(j.on_hand_unapplied)}`,
    );
    // The matched leaf must NOT be in on_hand_unapplied
    assert.ok(
      !unappliedKeys.includes('churros (sysco)|case'),
      'matched leaf must not appear in on_hand_unapplied',
    );

    // manifest_warnings must be present (array) — populated by beer_batter/beer_flour warning
    assert.ok(Array.isArray(j.manifest_warnings), 'manifest_warnings must be an array');
  });

  it('surfaces empty-unit count lines as on_hand_unapplied, never passes them to engine', async () => {
    // An inventory count line with NULL/empty unit must be in on_hand_unapplied,
    // never fed to the unit-agnostic fallback.
    const evId = seedEvent({ location: 'default' });
    seedLine({ event_id: evId, item_name: 'Churros', quantity: 2 });

    const countId = seedCount({ location: 'default', count_date: '2026-06-01' });
    // Empty-unit line for the same ingredient name
    seedCountLine({ count_id: countId, ingredient: 'churros (sysco)', unit: '', on_hand_qty: 10 });

    const res = await route.GET(makeReq(`?event_id=${evId}`));
    assert.equal(res.status, 200);
    const j = await res.json();

    // The empty-unit line must NOT subtract from to_order (full total_needed remains)
    const leafRow = j.order_guide.find(
      (r) => r.ingredient === 'churros (sysco)' && r.unit === 'case',
    );
    assert.ok(leafRow, 'churros (sysco)/case must be in order_guide');
    assert.equal(leafRow.on_hand, 0, 'on_hand must be 0: empty-unit line must not have been applied');
    assert.equal(leafRow.to_order, leafRow.total_needed, 'to_order must equal total_needed when empty-unit blocked');

    // The empty-unit line must appear in on_hand_unapplied
    assert.ok(Array.isArray(j.on_hand_unapplied), 'on_hand_unapplied must be array');
    const unapplied = j.on_hand_unapplied.find(
      (u) => u.ingredient === 'churros (sysco)' && u.unit === '',
    );
    assert.ok(unapplied, `expected empty-unit line in on_hand_unapplied; got ${JSON.stringify(j.on_hand_unapplied)}`);
  });
});
