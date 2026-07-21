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

function seedInventoryCount({ location = 'default', count_date = '2026-06-01', label = null } = {}) {
  const r = conn
    .prepare(
      `INSERT INTO inventory_counts (count_date, label, location_id) VALUES (?, ?, ?)`,
    )
    .run(count_date, label, location);
  return Number(r.lastInsertRowid);
}

function seedInventoryLine({ count_id, ingredient, unit = '', on_hand_qty, location = 'default' }) {
  conn
    .prepare(
      `INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(count_id, ingredient, unit, on_hand_qty, location);
}

async function cascade(evId, qs = '') {
  const res = await route.GET(makeReq(`?event_id=${evId}${qs}`));
  return res.json();
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
    assert.ok('manifest_warnings' in j, 'must have manifest_warnings');
    assert.ok('warnings' in j, 'must have warnings (graceful-degradation channel)');
    assert.equal(j.schemaVersion, 'beo_cascade_v1', 'envelope must carry schemaVersion');
  });

  it('error path returns the same envelope shape (warnings + manifest_warnings + schemaVersion)', async () => {
    // Force a CascadeError by pointing the engine root at a path with no CLI,
    // then assert the catch path still returns the full envelope — not a
    // truncated one that drops manifest_warnings/warnings and 500s the UI reads.
    const evId = seedEvent();
    seedLine({ event_id: evId, item_name: 'Battered Fish Taco', quantity: 40 });
    const prevRoot = process.env.LARIAT_ROOT;
    process.env.LARIAT_ROOT = '/nonexistent-cascade-root-xyz-9999';
    try {
      const res = await route.GET(makeReq(`?event_id=${evId}`));
      assert.equal(res.status, 200, 'engine/data conditions return 200 with an error banner');
      const j = await res.json();
      assert.ok(j.error, 'error banner must be present');
      assert.deepEqual(j.order_guide, [], 'order_guide empty on error');
      assert.deepEqual(j.prep_demands, [], 'prep_demands empty on error');
      assert.deepEqual(j.unmapped, [], 'unmapped empty on error');
      assert.ok('manifest_warnings' in j, 'error envelope must still carry manifest_warnings');
      assert.deepEqual(j.manifest_warnings, [], 'manifest_warnings empty on error');
      assert.ok('warnings' in j, 'error envelope must still carry warnings');
      assert.deepEqual(j.warnings, [], 'warnings empty on error');
      assert.equal(j.schemaVersion, 'beo_cascade_v1', 'error envelope must carry schemaVersion');
    } finally {
      if (prevRoot === undefined) delete process.env.LARIAT_ROOT;
      else process.env.LARIAT_ROOT = prevRoot;
    }
  });

  it('surfaces manifest_warnings for recipes that declare an unreferenced sub-recipe', async () => {
    // Synthetic fixture root, NOT live data. This test originally asserted
    // that the real recipe corpus still contained orphan sub-recipe
    // declarations ("birria, beer_batter") — but those were data bugs, and
    // #423/#563 fixed them, which correctly drove live warnings to zero and
    // broke the assertion. The warning CHANNEL is what this test pins, so it
    // builds a minimal root with a deliberate orphan: ghost_parent declares
    // sub_recipes=ghost_mix while no BOM row references it. `scripts` is
    // symlinked to the real repo's (the CLI import path uses
    // Path(__file__).resolve(), so imports work through the symlink; all
    // DATA reads come from the synthetic root).
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const synthRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cascade-orphan-'));
    fs.mkdirSync(path.join(synthRoot, 'recipes', 'normalized'), { recursive: true });
    fs.mkdirSync(path.join(synthRoot, 'menus'), { recursive: true });
    fs.writeFileSync(
      path.join(synthRoot, 'recipes', 'recipe_index.csv'),
      'recipe_id,recipe_name,yield,yield_unit,sub_recipes,pack_size\n'
        + 'ghost_parent,Ghost Parent,10,portion,ghost_mix,\n'
        + 'ghost_mix,Ghost Mix,1,qt,,\n',
    );
    // ghost_parent's BOM never references ghost_mix -> orphan declaration.
    fs.writeFileSync(
      path.join(synthRoot, 'recipes', 'normalized', 'ghost_parent.csv'),
      'ingredient,qty,unit,portions_per_batch,notes\nflour,2,lb,10,\n',
    );
    fs.writeFileSync(
      path.join(synthRoot, 'recipes', 'normalized', 'ghost_mix.csv'),
      'ingredient,qty,unit,portions_per_batch,notes\nwater,1,qt,1,\n',
    );
    fs.writeFileSync(
      path.join(synthRoot, 'menus', 'beo_recipe_map.csv'),
      'beo_item,recipe_id,per_count\nSynthetic Battered Taco,Ghost Parent,\n',
    );
    fs.symlinkSync(
      path.join(process.cwd(), 'scripts'),
      path.join(synthRoot, 'scripts'),
      'dir',
    );

    const evId = seedEvent();
    seedLine({ event_id: evId, item_name: 'Synthetic Battered Taco', quantity: 40 });
    const prevRoot = process.env.LARIAT_ROOT;
    try {
      process.env.LARIAT_ROOT = synthRoot;
      const res = await route.GET(makeReq(`?event_id=${evId}`));
      const j = await res.json();
      assert.ok(Array.isArray(j.manifest_warnings), 'manifest_warnings must be an array');
      assert.ok(
        j.manifest_warnings.length >= 1,
        `expected >= 1 manifest warning from the synthetic orphan: ${JSON.stringify(j)}`,
      );
      const orphan = j.manifest_warnings.find((w) => w.recipe === 'ghost_parent');
      assert.ok(orphan, `ghost_parent warning missing: ${JSON.stringify(j.manifest_warnings)}`);
      assert.ok(
        typeof orphan.issue === 'string' && orphan.issue.includes('ghost_mix'),
        `issue should name the orphaned sub-recipe: ${orphan.issue}`,
      );
      for (const w of j.manifest_warnings) {
        assert.ok(typeof w.recipe === 'string' && w.recipe, 'warning has a recipe');
        assert.ok(typeof w.issue === 'string' && w.issue, 'warning has an issue');
      }
    } finally {
      if (prevRoot === undefined) delete process.env.LARIAT_ROOT;
      else process.env.LARIAT_ROOT = prevRoot;
      fs.rmSync(synthRoot, { recursive: true, force: true });
    }
  });

  it('subtracts on-hand from the order guide (latest inventory count for the location)', async () => {
    const evId = seedEvent({ location: 'default' });
    seedLine({ event_id: evId, item_name: 'Battered Fish Taco', quantity: 40 });

    // Baseline: no inventory counted -> every leaf orders its full need.
    const before = await cascade(evId);
    assert.ok(before.order_guide.length >= 1, 'expected the item to cascade to >= 1 leaf');
    const leaf = before.order_guide[0];
    assert.equal(leaf.on_hand, 0, 'baseline on_hand must be 0');
    assert.equal(leaf.to_order, leaf.total_needed, 'baseline to_order must equal total_needed');

    // Count some of that leaf on hand, then re-run.
    const onHand = 2;
    const countId = seedInventoryCount({ location: 'default' });
    seedInventoryLine({ count_id: countId, ingredient: leaf.ingredient, unit: leaf.unit, on_hand_qty: onHand });

    const after = await cascade(evId);
    const leafAfter = after.order_guide.find(
      (r) => r.ingredient === leaf.ingredient && r.unit === leaf.unit,
    );
    assert.ok(leafAfter, 'leaf still present after seeding inventory');
    assert.equal(leafAfter.on_hand, onHand, 'on_hand must reflect the counted stock');
    assert.equal(
      leafAfter.to_order,
      Math.max(0, leaf.total_needed - onHand),
      'to_order must subtract on_hand',
    );
  });

  it('applies only the latest count and does not apply another location\'s inventory', async () => {
    const evId = seedEvent({ location: 'default' });
    seedLine({ event_id: evId, item_name: 'Battered Fish Taco', quantity: 40 });

    const before = await cascade(evId);
    const leaf = before.order_guide[0];

    // A stale earlier count for this location — must be superseded by the later one.
    const staleCount = seedInventoryCount({ location: 'default', count_date: '2026-05-01' });
    seedInventoryLine({ count_id: staleCount, ingredient: leaf.ingredient, unit: leaf.unit, on_hand_qty: 999 });
    // The current count for this location has no line for the leaf.
    seedInventoryCount({ location: 'default', count_date: '2026-06-01' });
    // A different location holds stock of the same leaf — must not leak in.
    const austinCount = seedInventoryCount({ location: 'austin', count_date: '2026-06-02' });
    seedInventoryLine({ count_id: austinCount, ingredient: leaf.ingredient, unit: leaf.unit, on_hand_qty: 500, location: 'austin' });

    const after = await cascade(evId);
    const leafAfter = after.order_guide.find(
      (r) => r.ingredient === leaf.ingredient && r.unit === leaf.unit,
    );
    assert.equal(leafAfter.on_hand, 0, 'stale + other-location stock must not apply');
    assert.equal(leafAfter.to_order, leaf.total_needed, 'to_order must equal total_needed');
  });
});
