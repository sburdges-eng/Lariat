#!/usr/bin/env node
// Tests for lib/dbQueryTool + lib/dbQueryRegistry.
//
// Three families of behavior we pin down:
//   1. SAFETY  — unknown queries, manager-tier without PIN, SQL-injection
//                attempts via params, location-spoofing attempts, row caps.
//   2. SHAPE   — coerce + validate params (missing/required/min/max), iso_date
//                regex, audit-event emission with proper redaction.
//   3. CATALOG — every registered query SQL compiles against the real schema
//                via lib/db.ts::initSchema; renderQueryCatalog tier filtering.
//
// Run: node --experimental-strip-types --test tests/js/test-db-query-tool.mjs

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-db-query-tool-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
let defaultBeoEventId = 0;
let otherBeoEventId = 0;

const db = await import('../../lib/db.ts');
const tool = await import('../../lib/dbQueryTool.ts');
const registryMod = await import('../../lib/dbQueryRegistry.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Fixture seeding ───────────────────────────────────────────────────

before(() => {
  // temp_log — three rows in the last hour, one outside the window
  const insTemp = testDb.prepare(
    `INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, required_min_f, required_max_f, cook_id, created_at)
     VALUES (date('now'), ?, ?, ?, ?, ?, ?, ?)`,
  );
  testDb.transaction(() => {
    insTemp.run('default', 'walk_in_cooler', 38, 33, 41, 'alice', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    insTemp.run('default', 'walk_in_cooler', 39, 33, 41, 'alice', new Date(Date.now() - 30 * 60 * 1000).toISOString());
    insTemp.run('default', 'freezer', -2, -10, 0, 'bob',           new Date(Date.now() - 10 * 60 * 1000).toISOString());
    insTemp.run('default', 'freezer', -1, -10, 0, 'bob',           new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString());
    insTemp.run('other-loc', 'walk_in_cooler', 38, 33, 41, 'eve',  new Date(Date.now() - 5 * 60 * 1000).toISOString());
  })();

  // sds_registry — global (not location-scoped)
  testDb.transaction(() => {
    testDb.prepare(
      `INSERT INTO sds_registry (product_name, manufacturer, hazard_class, storage_location, pdf_path, url, last_reviewed, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run('Quat Sanitizer 256', 'Ecolab', 'Class III B', 'dish_pit_shelf', '/docs/sds/quat.pdf', null, '2026-03-01', 'Use at 200 ppm');
    testDb.prepare(
      `INSERT INTO sds_registry (product_name, manufacturer, hazard_class, storage_location, pdf_path, url, last_reviewed, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run('Old Bleach Brand', 'Generic', 'Class III B', 'storage_closet', null, null, '2024-01-01', 'Discontinued 2025');
  })();

  // sales_lines — manager-tier query target
  testDb.transaction(() => {
    const ins = testDb.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES (?, ?, ?, ?, 'toast', ?)`,
    );
    ins.run('2026-05-14', 'Brisket Sandwich', 18, 252.00, 'default');
    ins.run('2026-05-14', 'Caesar Salad',     11,  88.00, 'default');
    ins.run('2026-05-15', 'Brisket Sandwich', 24, 336.00, 'default');
    ins.run('2026-05-15', 'Caesar Salad',     14, 112.00, 'default');
    ins.run('2026-05-15', 'Brisket Sandwich',  3,  42.00, 'other-loc'); // cross-location filter check
  })();

  // dish_components — coverage bridge for sales_depletion_unresolved
  testDb.transaction(() => {
    testDb.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, recipe_slug, qty_per_serving, unit, notes)
       VALUES ('default', 'Brisket Sandwich', 'recipe', 'brisket-sandwich', 1, 'ea', 'mapped menu item')`,
    ).run();
    testDb.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, recipe_slug, qty_per_serving, unit, notes)
       VALUES ('other-loc', 'Caesar Salad', 'recipe', 'caesar-salad', 1, 'ea', 'other venue mapping')`,
    ).run();
  })();

  // recipe_costs + bom_lines + vendor_prices — recipe_with_bom target
  testDb.transaction(() => {
    const insCost = testDb.prepare(
      `INSERT INTO recipe_costs
         (recipe_id, recipe_name, category, yield, yield_unit, batch_cost,
          cost_per_yield_unit, costed_lines, total_lines, interpretations, location_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insCost.run('brisket-sandwich', 'Brisket Sandwich', 'Entree', 12, 'servings', 96, 8, 2, 2, 0, 'default');
    insCost.run('brisket-sandwich', 'Other Venue Brisket', 'Entree', 8, 'servings', 72, 9, 1, 1, 0, 'other-loc');

    const insBom = testDb.prepare(
      `INSERT INTO bom_lines
         (recipe_id, ingredient, qty, unit, vendor_ingredient, map_status,
          vendor, pack_price, pack_size, location_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insBom.run('brisket-sandwich', 'Smoked brisket', 6, 'lb', 'Brisket Flat', 'mapped', 'sysco', 120, 20, 'default');
    insBom.run('brisket-sandwich', 'Brioche bun', 12, 'ea', 'Brioche Bun', 'mapped', 'shamrock', 18, 12, 'default');
    insBom.run('brisket-sandwich', 'Other venue brisket', 5, 'lb', 'Other Brisket', 'mapped', 'sysco', 90, 15, 'other-loc');

    const insPrice = testDb.prepare(
      `INSERT INTO vendor_prices
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insPrice.run('Brisket Flat', 'sysco', 'BRISK-20', 20, 'lb', 120, 6, 'meat', 'default');
    insPrice.run('Brioche Bun', 'shamrock', 'BUN-12', 12, 'ea', 18, 1.5, 'bread', 'default');
    insPrice.run('Other Brisket', 'sysco', 'BRISK-15', 15, 'lb', 90, 6, 'meat', 'other-loc');
  })();

  // BEO events + prep tasks — beo_prep_status target
  testDb.transaction(() => {
    const defaultInfo = testDb.prepare(
      `INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
       VALUES ('Navratil Rehearsal Dinner', '2026-06-15', '5 PM', 42, 'planned', 'default')`,
    ).run();
    defaultBeoEventId = Number(defaultInfo.lastInsertRowid);
    const otherInfo = testDb.prepare(
      `INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
       VALUES ('Other Venue Wedding', '2026-06-16', '6 PM', 80, 'planned', 'other-loc')`,
    ).run();
    otherBeoEventId = Number(otherInfo.lastInsertRowid);

    const insTask = testDb.prepare(
      `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insTask.run(defaultBeoEventId, 'Smoke brisket', '2026-06-14', 0, 1, 'default');
    insTask.run(defaultBeoEventId, 'Pack chafers', '2026-06-15', 1, 2, 'default');
    insTask.run(otherBeoEventId, 'Other venue prep', '2026-06-16', 0, 1, 'other-loc');
    // Deliberately inconsistent row: if the query only checks the task's
    // location_id, it can leak the other venue's event metadata.
    insTask.run(otherBeoEventId, 'Do not leak private wedding', '2026-06-16', 0, 99, 'default');
  })();
});

// ── 1. SAFETY: registry / tier / injection / location forcing ────────

describe('runDbQuery — safety boundaries', () => {
  it('rejects unknown query name with code unknown_query', () => {
    const r = tool.runDbQuery({
      name: 'definitely_not_a_query',
      params: {},
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, 'unknown_query');
      assert.match(r.error, /unknown query/i);
    }
  });

  it('blocks manager-tier query when hasPin=false (tier_blocked)', () => {
    const r = tool.runDbQuery({
      name: 'sales_by_dish',
      params: {},
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, 'tier_blocked');
      assert.match(r.error, /manager.?only|PIN/i);
    }
  });

  it('permits manager-tier query when hasPin=true', () => {
    const r = tool.runDbQuery({
      name: 'sales_by_dish',
      params: {},
      hasPin: true,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      // Cross-location row ('other-loc') must NOT appear: location is forced from request.
      const items = r.rows.map((x) => x.item_name);
      assert.ok(items.includes('Brisket Sandwich'), 'expected Brisket Sandwich row');
      assert.ok(items.includes('Caesar Salad'), 'expected Caesar Salad row');
      // The cross-location row had qty=3, net_sales=42 — confirm the totals come ONLY from default loc.
      const brisket = r.rows.find((x) => x.item_name === 'Brisket Sandwich');
      assert.strictEqual(brisket.qty, 42, 'qty must sum default-loc rows only (18+24=42, not 45)');
    }
  });

  it('LLM cannot spoof location_id via params (location is forced from request)', () => {
    // Even if the LLM jams location_id into params, the runner binds the
    // request's location_id to `:location_id`. The bound spoof attempt must
    // not surface other-location rows.
    const r = tool.runDbQuery({
      name: 'sales_by_dish',
      params: { location_id: 'other-loc' }, // hostile param — must be ignored
      hasPin: true,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      const brisket = r.rows.find((x) => x.item_name === 'Brisket Sandwich');
      assert.strictEqual(brisket.qty, 42, 'spoofed location must not bleed through');
    }
  });

  it('SQL-injection-style strings in params are bound, not concatenated', () => {
    // The runner uses parameterized binding, so an "injection" string is
    // just a literal in the LIKE pattern — no rows match, no SQL parse error.
    const r = tool.runDbQuery({
      name: 'sds_lookup',
      params: { search: "'; DROP TABLE sds_registry; --" },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.strictEqual(r.rowCount, 0, 'no rows should match the injection string');
    }
    // sds_registry must still exist with its rows after the "injection".
    const after = testDb.prepare('SELECT COUNT(*) AS c FROM sds_registry').get();
    assert.strictEqual(after.c >= 2, true, 'sds_registry must still hold its seeded rows');
  });

  it('row cap is enforced even if SQL would return more', () => {
    // Seed enough rows to exceed the recent_temp_log cap (40) under the
    // default 1-hour window.
    testDb.transaction(() => {
      const ins = testDb.prepare(
        `INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, cook_id, created_at)
         VALUES (date('now'), 'default', 'walk_in_cooler', 39, 'alice', ?)`,
      );
      for (let i = 0; i < 60; i++) {
        ins.run(new Date(Date.now() - (i + 1) * 30 * 1000).toISOString());
      }
    })();
    const r = tool.runDbQuery({
      name: 'recent_temp_log',
      params: { hours: 1 },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.strictEqual(r.rowCount, 40, 'recent_temp_log cap is 40');
      assert.strictEqual(r.truncated, true, 'truncated flag must surface');
    }
  });
});

describe('roadmap db_query entries', () => {
  it('recipe_with_bom is manager-tier, location-scoped, and returns deterministic BOM rows', () => {
    const blocked = tool.runDbQuery({
      name: 'recipe_with_bom',
      params: { recipe_id: 'brisket-sandwich' },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(blocked.ok, false);
    if (!blocked.ok) assert.strictEqual(blocked.code, 'tier_blocked');

    const r = tool.runDbQuery({
      name: 'recipe_with_bom',
      params: { recipe_id: 'brisket-sandwich' },
      hasPin: true,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.deepStrictEqual(
        r.rows.map((row) => row.ingredient),
        ['Smoked brisket', 'Brioche bun'],
        'BOM rows must stay request-location scoped and ordered by bom_lines.id',
      );
      assert.ok(r.rows.every((row) => row.recipe_name === 'Brisket Sandwich'));
      assert.ok(r.rows.every((row) => row.unit_price !== null));
    }
  });

  it('sales_depletion_unresolved returns sold items that are unmapped in the request location only', () => {
    const r = tool.runDbQuery({
      name: 'sales_depletion_unresolved',
      params: { period_label: '2026-05-15' },
      hasPin: true,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.deepStrictEqual(r.rows.map((row) => row.item_name), ['Caesar Salad']);
      assert.strictEqual(r.rows[0].qty_sold, 14);
      assert.strictEqual(r.rows[0].net_sales, 112);
    }
  });

  it('beo_prep_status returns event prep tasks and does not leak cross-location event metadata', () => {
    const normal = tool.runDbQuery({
      name: 'beo_prep_status',
      params: { event_id: defaultBeoEventId },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(normal.ok, true);
    if (normal.ok) {
      assert.deepStrictEqual(normal.rows.map((row) => row.task), ['Smoke brisket', 'Pack chafers']);
      assert.ok(normal.rows.every((row) => row.event_title === 'Navratil Rehearsal Dinner'));
    }

    const crossLocation = tool.runDbQuery({
      name: 'beo_prep_status',
      params: { event_id: otherBeoEventId },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(crossLocation.ok, true);
    if (crossLocation.ok) {
      assert.strictEqual(crossLocation.rowCount, 0);
    }
  });
});

// ── 2. SHAPE: param coercion, audit emission ─────────────────────────

describe('runDbQuery — param validation', () => {
  it('rejects missing required param with missing_param', () => {
    const r = tool.runDbQuery({
      name: 'recent_temp_log',
      params: {}, // hours required
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, 'missing_param');
      assert.match(r.error, /hours/);
    }
  });

  it('rejects out-of-range integer param', () => {
    const r = tool.runDbQuery({
      name: 'recent_temp_log',
      params: { hours: 999 }, // max 168
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, 'invalid_param');
      assert.match(r.error, /<= 168/);
    }
  });

  it('rejects non-finite numeric coercion (string-with-units)', () => {
    const r = tool.runDbQuery({
      name: 'recent_temp_log',
      params: { hours: '5 hr' }, // Number("5 hr") = NaN
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, 'invalid_param');
  });

  it('rejects malformed iso_date', () => {
    const r = tool.runDbQuery({
      name: 'vendor_price_history',
      params: { ingredient: 'beef' },
      hasPin: true,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true, 'no iso_date param here, should still pass');
    // Now seed a query that has an iso_date param. We use a synthetic
    // registry to keep this test independent of registry churn.
    tool._setRegistryForTest([
      {
        name: 'synthetic_with_date',
        tier: 'cook',
        description: 'test',
        locationScoped: true,
        rowCap: 10,
        params: [{ name: 'day', type: 'iso_date', required: true, description: 'a date' }],
        sql: `SELECT :day AS d, :location_id AS loc`,
      },
    ]);
    const bad = tool.runDbQuery({
      name: 'synthetic_with_date',
      params: { day: 'May 15' },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(bad.ok, false);
    if (!bad.ok) {
      assert.strictEqual(bad.code, 'invalid_param');
      assert.match(bad.error, /YYYY-MM-DD/);
    }
    const good = tool.runDbQuery({
      name: 'synthetic_with_date',
      params: { day: '2026-05-15' },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(good.ok, true);
    if (good.ok) assert.strictEqual(good.rows[0].d, '2026-05-15');
    tool._setRegistryForTest(null);
  });

  it('emits an audit_events row with action=view and proper payload', () => {
    const before = testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?').get('db_query').c;
    const r = tool.runDbQuery({
      name: 'recent_temp_log',
      params: { hours: 2, point_id: 'freezer' },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    const after = testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?').get('db_query').c;
    assert.strictEqual(after, before + 1, 'exactly one audit row added');
    const row = testDb.prepare(
      `SELECT action, actor_source, payload_json, note FROM audit_events
       WHERE entity = 'db_query' ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.strictEqual(row.action, 'view', 'must use CHECK-allowed action');
    assert.strictEqual(row.actor_source, 'kitchen_assistant');
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.query, 'recent_temp_log');
    assert.strictEqual(payload.tier, 'cook');
    assert.deepStrictEqual(payload.paramKeys.sort(), ['hours', 'point_id']);
    assert.strictEqual(payload.paramsRedacted.hours, 2);
    assert.strictEqual(payload.paramsRedacted.point_id, 'freezer');
    assert.ok(typeof payload.rowCount === 'number');
  });

  it('redacts auditOmitValues from audit payload', () => {
    const r = tool.runDbQuery({
      name: 'sds_lookup',
      params: { search: 'quat' },
      hasPin: false,
      requestLocationId: 'default',
    });
    assert.strictEqual(r.ok, true);
    const row = testDb.prepare(
      `SELECT payload_json FROM audit_events WHERE entity='db_query' AND payload_json LIKE '%sds_lookup%' ORDER BY id DESC LIMIT 1`,
    ).get();
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.paramsRedacted.search, '[redacted]', 'free-text searches must be redacted');
    // Keys are preserved so a manager auditing the trail can see WHICH params were used.
    assert.ok(payload.paramKeys.includes('search'));
  });
});

// ── 3. CATALOG: tier filtering, render, schema sanity ────────────────

describe('catalog + rendering', () => {
  it('listQueriesForTier(cook) returns only cook queries', () => {
    const cooks = tool.listQueriesForTier('cook');
    assert.ok(cooks.length > 0);
    assert.ok(cooks.every((q) => q.tier === 'cook'));
  });

  it('listQueriesForTier(manager) returns ALL queries (manager is superset)', () => {
    const all = tool.listQueriesForTier('manager');
    const cook = tool.listQueriesForTier('cook');
    assert.ok(all.length >= cook.length);
    assert.ok(all.some((q) => q.tier === 'manager'), 'must include at least one manager-tier query');
  });

  it('renderQueryCatalog produces a non-empty action-instructions blob with the LLM-facing format', () => {
    const blob = tool.renderQueryCatalog('cook');
    assert.match(blob, /AVAILABLE DB QUERIES/);
    assert.match(blob, /db_query/);
    assert.match(blob, /recent_temp_log/);
    // Manager-only queries must NOT appear in the cook catalog.
    assert.doesNotMatch(blob, /sales_by_dish/);
  });

  it('every registered SQL compiles via db.prepare against the real schema', () => {
    // A registry entry whose SQL references a missing column or table will
    // throw at .prepare() time. Catching this in CI prevents the runner
    // failure mode where a query is shipped but only fails when actually
    // invoked by a user.
    for (const spec of registryMod.DB_QUERIES) {
      let stmt;
      try {
        stmt = testDb.prepare(spec.sql);
      } catch (e) {
        assert.fail(`registry SQL for "${spec.name}" failed to prepare: ${e.message}`);
      }
      assert.ok(stmt, `expected prepared statement for ${spec.name}`);
    }
  });

  it('formatQueryResultForPrompt renders a table or no-rows sentinel', () => {
    const empty = tool.formatQueryResultForPrompt({
      ok: true,
      rows: [],
      rowCount: 0,
      rowCap: 10,
      truncated: false,
      query: { name: 'x', description: 'y', tier: 'cook' },
    });
    assert.match(empty, /no rows/);
    const populated = tool.formatQueryResultForPrompt({
      ok: true,
      rows: [{ a: 1, b: 'x|y' }, { a: 2, b: null }],
      rowCount: 2,
      rowCap: 10,
      truncated: false,
      query: { name: 'q', description: 'd', tier: 'cook' },
    });
    assert.match(populated, /a \| b/);
    // Pipe-safety: cell value 'x|y' must NOT leak a raw '|' into the row.
    assert.doesNotMatch(populated, /x\|y/);
  });
});
