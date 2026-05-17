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
