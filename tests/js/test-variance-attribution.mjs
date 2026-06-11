#!/usr/bin/env node
// Integration tests for lib/varianceAttribution.ts and
// /api/costing/variance-attribution.
//
// Covers the "the variance moved — what did we change?" contract:
//   - default window = two most recent accounting_variance periods
//   - explicit from/to override (and coherent ok:false when missing)
//   - in-window vs out-of-window evidence per section
//   - cross-location isolation
//   - empty DB → coherent empty payload
//   - route 200/no-store contract + 400 on malformed dates

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-variance-attr-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const attrMod = await import('../../lib/varianceAttribution.ts');
const route = await import('../../app/api/costing/variance-attribution/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const TABLES = [
  'accounting_variance',
  'vendor_prices_history',
  'dish_components',
  'audit_events',
  'inventory_counts',
  'inventory_count_lines',
  'sales_lines',
];

beforeEach(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t};`);
});

// Window under test: baseline period ends 2026-05-01, current ends
// 2026-05-15 → window is (2026-05-01, 2026-05-15].
const BASE_END = '2026-05-01';
const CUR_END = '2026-05-15';
const IN_WINDOW = '2026-05-10 12:00:00';
const BEFORE_WINDOW = '2026-04-20 12:00:00';

function insertVariance({
  period_start, period_end, theoretical = 1000, actual = 1030,
  amount = 30, pct = 3, location_id = 'default',
}) {
  db.prepare(
    `INSERT INTO accounting_variance
       (period_start, period_end, theoretical_cogs, actual_cogs,
        variance_amount, variance_pct, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(period_start, period_end, theoretical, actual, amount, pct, location_id);
}

function seedTwoPeriods(location_id = 'default') {
  insertVariance({
    period_start: '2026-04-18', period_end: BASE_END,
    amount: 20, pct: 2, location_id,
  });
  insertVariance({
    period_start: '2026-05-02', period_end: CUR_END,
    amount: 55, pct: 5.5, location_id,
  });
}

function insertSnapshot({ vendor, sku, ingredient, unit_price, snapshot_at, location_id = 'default' }) {
  db.prepare(
    `INSERT INTO vendor_prices_history
       (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, category, location_id, snapshot_at, snapshot_reason)
     VALUES (1, ?, ?, ?, 1, 'lb', ?, ?, 'produce', ?, ?, 'test')`,
  ).run(ingredient, vendor, sku, unit_price, unit_price, location_id, snapshot_at);
}

function insertDishComponent({
  dish_name, vendor_ingredient = null, recipe_slug = null,
  created_at, updated_at, location_id = 'default',
}) {
  const component_type = recipe_slug ? 'recipe' : 'vendor_item';
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 'ea', ?, ?)`,
  ).run(location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
    created_at, updated_at);
}

function insertAudit({
  entity, entity_id = 1, action = 'update', payload = null,
  created_at, location_id = 'default', actor_cook_id = 'cook-1',
}) {
  db.prepare(
    `INSERT INTO audit_events
       (shift_date, location_id, actor_cook_id, actor_source, entity,
        entity_id, action, payload_json, created_at)
     VALUES (?, ?, ?, 'api', ?, ?, ?, ?, ?)`,
  ).run(created_at.slice(0, 10), location_id, actor_cook_id, entity, entity_id,
    action, payload ? JSON.stringify(payload) : null, created_at);
}

function insertClosedCount({ label, count_date, closed_at, location_id = 'default', lines = 0 }) {
  const res = db.prepare(
    `INSERT INTO inventory_counts (count_date, label, closed_at, location_id)
     VALUES (?, ?, ?, ?)`,
  ).run(count_date, label, closed_at, location_id);
  const countId = Number(res.lastInsertRowid);
  for (let i = 0; i < lines; i += 1) {
    db.prepare(
      `INSERT INTO inventory_count_lines
         (count_id, vendor, ingredient, sku, on_hand_qty, unit, location_id)
       VALUES (?, 'sysco', ?, '', 1, 'lb', ?)`,
    ).run(countId, `ing-${i}`, location_id);
  }
  return countId;
}

function insertSalesLine({ item_name, period_label, qty = 2, net = 20, location_id = 'default' }) {
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(period_label, item_name, qty, net, location_id);
}

describe('buildVarianceAttribution() window selection', () => {
  it('defaults to the two most recent periods for the location', () => {
    insertVariance({ period_start: '2026-04-04', period_end: '2026-04-17', pct: 1, amount: 10 });
    seedTwoPeriods();

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.ok, true);
    assert.deepEqual(attr.window, { from: BASE_END, to: CUR_END });
    assert.equal(attr.variance.baseline.period_end, BASE_END);
    assert.equal(attr.variance.current.period_end, CUR_END);
    assert.equal(attr.variance.delta_pct, 3.5);
    assert.equal(attr.variance.delta_amount, 35);
    assert.equal(attr.variance.baseline.threshold_color, 'yellow');
    assert.equal(attr.variance.current.threshold_color, 'red');
    assert.equal(typeof attr.caveat, 'string');
  });

  it('honors explicit from/to period_end overrides', () => {
    insertVariance({ period_start: '2026-04-04', period_end: '2026-04-17', pct: 1, amount: 10 });
    seedTwoPeriods();

    const attr = attrMod.buildVarianceAttribution('default', {
      from: '2026-04-17', to: BASE_END,
    });

    assert.equal(attr.ok, true);
    assert.deepEqual(attr.window, { from: '2026-04-17', to: BASE_END });
    assert.equal(attr.variance.baseline.period_end, '2026-04-17');
    assert.equal(attr.variance.current.period_end, BASE_END);
  });

  it('returns a coherent ok:false payload when an explicit period is missing', () => {
    seedTwoPeriods();

    const attr = attrMod.buildVarianceAttribution('default', {
      from: '2026-01-01', to: CUR_END,
    });

    assert.equal(attr.ok, false);
    assert.match(attr.reason, /2026-01-01/);
    assert.equal(attr.variance.baseline, null);
    assert.equal(attr.price_moves.count, 0);
    assert.deepEqual(attr.price_moves.items, []);
    assert.equal(attr.unresolved_depletions.count, 0);
    assert.equal(attr.unattributed, true);
  });

  it('returns a coherent ok:false payload on an empty DB', () => {
    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.ok, false);
    assert.match(attr.reason, /two variance periods/);
    assert.deepEqual(attr.window, { from: null, to: null });
    assert.equal(attr.composition_changes.count, 0);
    assert.equal(attr.count_corrections.count, 0);
    assert.equal(typeof attr.caveat, 'string');
  });
});

describe('price_moves section', () => {
  it('reports first→last unit price inside the window and flags menu-linked items', () => {
    seedTwoPeriods();

    // In-window move: 10 → 12 (+20%), linked to a dish via vendor_item.
    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 10, snapshot_at: '2026-05-03 08:00:00' });
    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 12, snapshot_at: IN_WINDOW });
    insertDishComponent({
      dish_name: 'Guac Bowl', vendor_ingredient: 'Avocado',
      created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    });

    // In-window but flat — not a move.
    insertSnapshot({ vendor: 'sysco', sku: 'LIM-1', ingredient: 'Lime', unit_price: 5, snapshot_at: '2026-05-03 08:00:00' });
    insertSnapshot({ vendor: 'sysco', sku: 'LIM-1', ingredient: 'Lime', unit_price: 5, snapshot_at: IN_WINDOW });

    // Out-of-window move — excluded.
    insertSnapshot({ vendor: 'sysco', sku: 'TOM-1', ingredient: 'Tomato', unit_price: 3, snapshot_at: '2026-04-10 08:00:00' });
    insertSnapshot({ vendor: 'sysco', sku: 'TOM-1', ingredient: 'Tomato', unit_price: 9, snapshot_at: BEFORE_WINDOW });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.price_moves.count, 1);
    const move = attr.price_moves.items[0];
    assert.equal(move.ingredient, 'Avocado');
    assert.equal(move.first_price, 10);
    assert.equal(move.last_price, 12);
    assert.equal(move.pct_move, 20);
    assert.equal(move.snapshots, 2);
    assert.equal(move.linked_to_menu, true);
    assert.equal(attr.unattributed, false);
  });
});

describe('composition_changes section', () => {
  it('includes rows created or updated in-window and excludes older edits', () => {
    seedTwoPeriods();

    insertDishComponent({
      dish_name: 'New Dish', vendor_ingredient: 'Halibut',
      created_at: IN_WINDOW, updated_at: IN_WINDOW,
    });
    insertDishComponent({
      dish_name: 'Edited Dish', recipe_slug: 'salsa-verde',
      created_at: '2026-01-01 00:00:00', updated_at: IN_WINDOW,
    });
    insertDishComponent({
      dish_name: 'Old Dish', vendor_ingredient: 'Flour',
      created_at: BEFORE_WINDOW, updated_at: BEFORE_WINDOW,
    });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.composition_changes.count, 2);
    const byDish = new Map(attr.composition_changes.items.map((c) => [c.dish_name, c]));
    assert.equal(byDish.get('New Dish').change_kind, 'created');
    assert.equal(byDish.get('Edited Dish').change_kind, 'updated');
    assert.match(byDish.get('Edited Dish').component, /salsa-verde/);
    assert.equal(byDish.has('Old Dish'), false);
  });
});

describe('count_corrections section', () => {
  it('includes in-window count lifecycle audits and closed counts, excludes older ones', () => {
    seedTwoPeriods();

    // The PATCH route writes close/reopen as entity 'inventory_counts',
    // action 'update', payload {transition} — mirror that exactly.
    insertAudit({
      entity: 'inventory_counts', action: 'update',
      payload: { transition: 'reopen' }, created_at: IN_WINDOW,
    });
    insertAudit({
      entity: 'inventory_count_lines', action: 'update',
      created_at: IN_WINDOW, actor_cook_id: 'cook-2',
    });
    insertAudit({
      entity: 'inventory_counts', action: 'update',
      payload: { transition: 'close' }, created_at: BEFORE_WINDOW,
    });
    // Unrelated entity — never a count correction.
    insertAudit({ entity: 'eighty_six', action: 'update', created_at: IN_WINDOW });

    insertClosedCount({
      label: 'Weekly walk-in', count_date: '2026-05-09',
      closed_at: IN_WINDOW, lines: 3,
    });
    insertClosedCount({
      label: 'Old count', count_date: '2026-04-19',
      closed_at: BEFORE_WINDOW, lines: 1,
    });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.count_corrections.count, 3);
    const kinds = attr.count_corrections.items.map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['audit', 'audit', 'count_closed']);
    const closed = attr.count_corrections.items.find((r) => r.kind === 'count_closed');
    assert.equal(closed.label, 'Weekly walk-in');
    assert.equal(closed.lines, 3);
    const reopen = attr.count_corrections.items.find((r) => r.transition === 'reopen');
    assert.equal(reopen.entity, 'inventory_counts');
  });
});

describe('unresolved_depletions section', () => {
  it('windows on date-like period_labels and excludes resolved items', () => {
    seedTwoPeriods();

    insertSalesLine({ item_name: 'Mystery Burger', period_label: '2026-05-08', qty: 4, net: 60 });
    insertSalesLine({ item_name: 'Mystery Burger', period_label: '2026-04-15', qty: 9, net: 135 });
    insertSalesLine({ item_name: 'Guac Bowl', period_label: '2026-05-08', qty: 2, net: 24 });
    insertDishComponent({
      dish_name: 'Guac Bowl', vendor_ingredient: 'Avocado',
      created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.unresolved_depletions.count, 1);
    const item = attr.unresolved_depletions.items[0];
    assert.equal(item.item_name, 'Mystery Burger');
    assert.equal(item.period_label, '2026-05-08');
    assert.equal(item.qty_sold, 4);
    assert.equal(item.net_sales, 60);
    assert.equal(attr.unresolved_depletions.note, null);
  });

  it('treats punctuation and casing variants as resolved dish links', () => {
    seedTwoPeriods();

    insertSalesLine({ item_name: 'GUAC---BOWL!!!', period_label: '2026-05-08', qty: 2, net: 24 });
    insertDishComponent({
      dish_name: 'Guac Bowl', vendor_ingredient: 'Avocado',
      created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.unresolved_depletions.count, 0);
    assert.deepEqual(attr.unresolved_depletions.items, []);
  });

  it('falls back to all-time with an honest note when period_labels are not date-like', () => {
    seedTwoPeriods();

    insertSalesLine({ item_name: 'Legacy Item', period_label: 'Lunch FY26', qty: 7, net: 70 });

    const attr = attrMod.buildVarianceAttribution('default');

    assert.equal(attr.unresolved_depletions.count, 1);
    assert.equal(attr.unresolved_depletions.items[0].item_name, 'Legacy Item');
    assert.match(attr.unresolved_depletions.note, /not date-like/);
  });
});

describe('cross-location isolation', () => {
  it('scopes every section (and the window itself) to the requested location', () => {
    seedTwoPeriods('kitchen-a');
    insertVariance({ period_start: '2026-05-02', period_end: '2026-05-20', pct: 9, amount: 90, location_id: 'kitchen-b' });
    insertVariance({ period_start: '2026-04-18', period_end: BASE_END, pct: 1, amount: 10, location_id: 'kitchen-b' });

    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 10, snapshot_at: '2026-05-03 08:00:00', location_id: 'kitchen-a' });
    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 12, snapshot_at: IN_WINDOW, location_id: 'kitchen-a' });
    insertSnapshot({ vendor: 'sysco', sku: 'LIM-1', ingredient: 'Lime', unit_price: 4, snapshot_at: '2026-05-03 08:00:00', location_id: 'kitchen-b' });
    insertSnapshot({ vendor: 'sysco', sku: 'LIM-1', ingredient: 'Lime', unit_price: 8, snapshot_at: IN_WINDOW, location_id: 'kitchen-b' });

    insertDishComponent({ dish_name: 'A Dish', vendor_ingredient: 'Avocado', created_at: IN_WINDOW, updated_at: IN_WINDOW, location_id: 'kitchen-a' });
    insertDishComponent({ dish_name: 'B Dish', vendor_ingredient: 'Lime', created_at: IN_WINDOW, updated_at: IN_WINDOW, location_id: 'kitchen-b' });

    insertAudit({ entity: 'inventory_counts', action: 'update', payload: { transition: 'close' }, created_at: IN_WINDOW, location_id: 'kitchen-a' });
    insertAudit({ entity: 'inventory_counts', action: 'update', payload: { transition: 'close' }, created_at: IN_WINDOW, location_id: 'kitchen-b' });
    insertClosedCount({ label: 'A close', count_date: '2026-05-09', closed_at: IN_WINDOW, location_id: 'kitchen-a' });

    insertSalesLine({ item_name: 'A Burger', period_label: '2026-05-08', location_id: 'kitchen-a' });
    insertSalesLine({ item_name: 'B Burger', period_label: '2026-05-08', location_id: 'kitchen-b' });

    const a = attrMod.buildVarianceAttribution('kitchen-a');

    assert.equal(a.ok, true);
    assert.deepEqual(a.window, { from: BASE_END, to: CUR_END });
    assert.equal(a.price_moves.count, 1);
    assert.equal(a.price_moves.items[0].ingredient, 'Avocado');
    assert.equal(a.composition_changes.count, 1);
    assert.equal(a.composition_changes.items[0].dish_name, 'A Dish');
    assert.equal(a.count_corrections.count, 2); // 1 audit + 1 closed count
    // A Dish links 'A Burger'? No — dish_name 'A Dish' ≠ 'A Burger', so A Burger stays unresolved.
    assert.equal(a.unresolved_depletions.count, 1);
    assert.equal(a.unresolved_depletions.items[0].item_name, 'A Burger');

    const b = attrMod.buildVarianceAttribution('kitchen-b');
    assert.equal(b.ok, true);
    assert.deepEqual(b.window, { from: BASE_END, to: '2026-05-20' });
    assert.equal(b.price_moves.items[0].ingredient, 'Lime');
    assert.equal(b.composition_changes.items[0].dish_name, 'B Dish');
    assert.equal(b.count_corrections.count, 1); // audit only
    assert.equal(b.unresolved_depletions.items[0].item_name, 'B Burger');
  });
});

describe('GET /api/costing/variance-attribution', () => {
  it('returns the attribution payload with no-store caching', async () => {
    seedTwoPeriods();
    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 10, snapshot_at: '2026-05-03 08:00:00' });
    insertSnapshot({ vendor: 'sysco', sku: 'AVO-1', ingredient: 'Avocado', unit_price: 12, snapshot_at: IN_WINDOW });

    const res = await route.GET(new Request('http://localhost/api/costing/variance-attribution'));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.window, { from: BASE_END, to: CUR_END });
    assert.equal(body.price_moves.count, 1);
    assert.equal(typeof body.caveat, 'string');
  });

  it('passes explicit from/to through to the builder', async () => {
    insertVariance({ period_start: '2026-04-04', period_end: '2026-04-17', pct: 1, amount: 10 });
    seedTwoPeriods();

    const res = await route.GET(new Request(
      `http://localhost/api/costing/variance-attribution?from=2026-04-17&to=${BASE_END}`,
    ));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.window, { from: '2026-04-17', to: BASE_END });
  });

  it('400s on malformed from/to', async () => {
    seedTwoPeriods();

    const bad1 = await route.GET(new Request('http://localhost/api/costing/variance-attribution?from=05-01-2026'));
    assert.equal(bad1.status, 400);
    const bad2 = await route.GET(new Request('http://localhost/api/costing/variance-attribution?to=not-a-date'));
    assert.equal(bad2.status, 400);
    assert.equal(bad2.headers.get('Cache-Control'), 'no-store');
  });
});
