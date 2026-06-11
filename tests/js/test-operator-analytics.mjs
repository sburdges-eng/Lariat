#!/usr/bin/env node
// Integration tests for lib/operatorAnalytics.ts and
// GET /api/analytics/operators (roadmap row 3.5).
//
// Pins:
//   - per-section aggregation (audit actors ranked, equipment failure
//     counts, gold stars by cook, corrective actions by operator)
//   - window edge semantics (row at exactly windowDays included,
//     one day older excluded)
//   - cross-location isolation for every SQL-backed section
//   - JSONL management-actions feed (LARIAT_AUDIT_PATH override)
//   - route ?window= allowlist (7/30/90, anything else → 400),
//     JSON contract, cache-control: no-store
//
// Run: node --experimental-strip-types --test tests/js/test-operator-analytics.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-operator-analytics-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const TMP_AUDIT_JSONL = path.join(TMP_DIR, 'management-actions.jsonl');

// lib/auditLog.mjs resolves this env var at call time; point the JSONL
// management-actions feed at our temp dir before any section reads it.
process.env.LARIAT_AUDIT_PATH = TMP_AUDIT_JSONL;

const dbMod = await import('../../lib/db.ts');
const analytics = await import('../../lib/operatorAnalytics.ts');
const route = await import('../../app/api/analytics/operators/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  delete process.env.LARIAT_AUDIT_PATH;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const TABLES = [
  'audit_events',
  'temp_log',
  'line_check_entries',
  'gold_stars',
  'equipment_maintenance',
  'equipment',
];

beforeEach(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t};`);
  try { fs.rmSync(TMP_AUDIT_JSONL, { force: true }); } catch { /* ignore */ }
});

const TODAY = '2026-05-20';
const LOC = 'default';

function insertAuditEvent({
  shift_date = TODAY,
  location_id = LOC,
  actor_cook_id = null,
  actor_source = 'system',
  entity = 'temp_log',
  action = 'insert',
} = {}) {
  db.prepare(
    `INSERT INTO audit_events (shift_date, location_id, actor_cook_id, actor_source, entity, action)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(shift_date, location_id, actor_cook_id, actor_source, entity, action);
}

function insertTempLogCorrective({
  shift_date = TODAY,
  location_id = LOC,
  point_id = 'walk_in_cooler',
  corrective_action = 'Moved product, called service',
  cook_id = null,
} = {}) {
  db.prepare(
    `INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, corrective_action, cook_id)
     VALUES (?, ?, ?, 50, ?, ?)`,
  ).run(shift_date, location_id, point_id, corrective_action, cook_id);
}

function insertLineCheckFail({
  shift_date = TODAY,
  location_id = LOC,
  station_id = 'grill',
  item = 'Brisket',
  note = 'Re-fired and re-checked',
  cook_id = null,
  status = 'fail',
} = {}) {
  db.prepare(
    `INSERT INTO line_check_entries (shift_date, station_id, item, status, note, cook_id, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(shift_date, station_id, item, status, note, cook_id, location_id);
}

function insertGoldStar({
  cook_name,
  stars = 1,
  awarded_date = TODAY,
  location_id = LOC,
  deleted_at = null,
} = {}) {
  db.prepare(
    `INSERT INTO gold_stars (cook_name, reason, stars, awarded_date, location_id, deleted_at)
     VALUES (?, 'test', ?, ?, ?, ?)`,
  ).run(cook_name, stars, awarded_date, location_id, deleted_at);
}

function insertEquipment(name, location_id = LOC) {
  const r = db.prepare(
    `INSERT INTO equipment (name, category, location_id) VALUES (?, 'kitchen', ?)`,
  ).run(name, location_id);
  return Number(r.lastInsertRowid);
}

function insertMaintenance(equipment_id, { type, service_date = TODAY, location_id = LOC } = {}) {
  db.prepare(
    `INSERT INTO equipment_maintenance (equipment_id, service_date, type, location_id)
     VALUES (?, ?, ?, ?)`,
  ).run(equipment_id, service_date, type, location_id);
}

function writeAuditJsonl(entries) {
  fs.writeFileSync(TMP_AUDIT_JSONL, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('buildOperatorAnalytics()', () => {
  it('exports the 7/30/90 window allowlist with a 30-day default', () => {
    assert.deepEqual([...analytics.OPERATOR_ANALYTICS_WINDOWS], [7, 30, 90]);
    assert.equal(analytics.DEFAULT_OPERATOR_ANALYTICS_WINDOW, 30);
    assert.equal(analytics.isAllowedWindow(7), true);
    assert.equal(analytics.isAllowedWindow(30), true);
    assert.equal(analytics.isAllowedWindow(90), true);
    assert.equal(analytics.isAllowedWindow(14), false);
    assert.equal(analytics.isAllowedWindow(0), false);

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);
    assert.equal(out.window_days, 30);
    assert.equal(out.window_start, '2026-04-20');
    assert.equal(out.window_end, TODAY);
    assert.equal(out.location_id, LOC);
  });

  it('ranks audit actors by event volume, falling back to actor_source when unattributed', () => {
    for (let i = 0; i < 3; i += 1) insertAuditEvent({ actor_cook_id: 'cook-busy' });
    for (let i = 0; i < 2; i += 1) insertAuditEvent({ actor_cook_id: 'cook-quiet' });
    insertAuditEvent({ actor_cook_id: null, actor_source: 'kds' });
    insertAuditEvent({ actor_cook_id: '   ', actor_source: 'kds' }); // blank cook id → source

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.audit_actors.count, 3);
    assert.deepEqual(out.audit_actors.items, [
      { actor: 'cook-busy', events: 3 },
      { actor: 'cook-quiet', events: 2 },
      { actor: 'kds', events: 2 },
    ]);
  });

  it('reports the audit-volume trend per shift_date in ascending order, uncapped', () => {
    insertAuditEvent({ shift_date: '2026-05-19' });
    insertAuditEvent({ shift_date: '2026-05-19' });
    insertAuditEvent({ shift_date: '2026-05-18' });
    insertAuditEvent({ shift_date: TODAY });

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.audit_trend.count, 3);
    assert.deepEqual(out.audit_trend.items, [
      { shift_date: '2026-05-18', events: 1 },
      { shift_date: '2026-05-19', events: 2 },
      { shift_date: TODAY, events: 1 },
    ]);
  });

  it('aggregates corrective actions by operator with temp_log/line_check split', () => {
    insertTempLogCorrective({ cook_id: 'cook-1' });
    insertTempLogCorrective({ cook_id: 'cook-1', point_id: 'reach_in' });
    insertLineCheckFail({ cook_id: 'cook-1' });
    insertLineCheckFail({ cook_id: 'cook-2', item: 'Sauce' });
    insertTempLogCorrective({ cook_id: null }); // → '(unattributed)'
    // Non-corrective rows must not count:
    insertLineCheckFail({ cook_id: 'cook-2', status: 'pass', note: 'all good' });
    db.prepare(
      `INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, corrective_action, cook_id)
       VALUES (?, ?, 'walk_in_cooler', 36, NULL, 'cook-2')`,
    ).run(TODAY, LOC);

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.corrective_by_operator.count, 3);
    assert.deepEqual(out.corrective_by_operator.items[0], {
      cook_id: 'cook-1',
      total: 3,
      temp_log: 2,
      line_check: 1,
    });
    const rest = out.corrective_by_operator.items.slice(1);
    assert.deepEqual(rest.map((r) => [r.cook_id, r.total]).sort(), [
      ['(unattributed)', 1],
      ['cook-2', 1],
    ]);
  });

  it('aggregates corrective actions by subject with source labels', () => {
    insertTempLogCorrective({ point_id: 'walk_in_cooler' });
    insertTempLogCorrective({ point_id: 'walk_in_cooler' });
    insertLineCheckFail({ station_id: 'grill', item: 'Brisket' });

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.corrective_by_subject.count, 2);
    assert.deepEqual(out.corrective_by_subject.items, [
      { subject: 'walk_in_cooler', source: 'temp_log', total: 2 },
      { subject: 'grill: Brisket', source: 'line_check', total: 1 },
    ]);
  });

  it('ranks gold-star leaders by stars, treats NULL stars as 1, and skips soft-deleted awards', () => {
    insertGoldStar({ cook_name: 'Ana', stars: 3, awarded_date: '2026-05-01' });
    insertGoldStar({ cook_name: 'Ana', stars: 2, awarded_date: '2026-05-10' });
    insertGoldStar({ cook_name: 'Ben', stars: null, awarded_date: '2026-05-05' }); // NULL → 1 star
    insertGoldStar({ cook_name: 'Ben', stars: 1, awarded_date: '2026-05-06' });
    insertGoldStar({ cook_name: 'Cal', stars: 5, deleted_at: '2026-05-11T00:00:00Z' }); // soft-deleted

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.gold_star_leaders.count, 2);
    assert.deepEqual(out.gold_star_leaders.items, [
      { cook_name: 'Ana', awards: 2, stars: 5, last_awarded: '2026-05-10' },
      { cook_name: 'Ben', awards: 2, stars: 2, last_awarded: '2026-05-06' },
    ]);
  });

  it('counts Repair/Damage as equipment failures (case-insensitive) and omits failure-free units', () => {
    const fridge = insertEquipment('Walk-in cooler');
    insertMaintenance(fridge, { type: 'Repair' });
    insertMaintenance(fridge, { type: 'damage', service_date: '2026-05-10' });
    insertMaintenance(fridge, { type: 'Routine', service_date: '2026-05-01' });
    const oven = insertEquipment('Combi oven');
    insertMaintenance(oven, { type: 'repair', service_date: '2026-05-12' });
    const mixer = insertEquipment('Mixer');
    insertMaintenance(mixer, { type: 'Routine' }); // PM only → omitted

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.equipment_failures.count, 2);
    assert.deepEqual(out.equipment_failures.items, [
      {
        equipment_id: fridge,
        equipment_name: 'Walk-in cooler',
        failures: 2,
        services: 3,
        last_service_date: TODAY,
      },
      {
        equipment_id: oven,
        equipment_name: 'Combi oven',
        failures: 1,
        services: 1,
        last_service_date: '2026-05-12',
      },
    ]);
  });

  it('includes rows dated exactly windowDays back and excludes anything older', () => {
    // window 7 ending 2026-05-20 → window_start 2026-05-13 (inclusive).
    insertAuditEvent({ shift_date: '2026-05-13', actor_cook_id: 'edge' });
    insertAuditEvent({ shift_date: '2026-05-12', actor_cook_id: 'too-old' });
    insertTempLogCorrective({ shift_date: '2026-05-13', cook_id: 'edge' });
    insertTempLogCorrective({ shift_date: '2026-05-12', cook_id: 'too-old' });
    insertLineCheckFail({ shift_date: '2026-05-13', cook_id: 'edge' });
    insertLineCheckFail({ shift_date: '2026-05-12', cook_id: 'too-old' });
    insertGoldStar({ cook_name: 'edge', awarded_date: '2026-05-13' });
    insertGoldStar({ cook_name: 'too-old', awarded_date: '2026-05-12' });
    const eq = insertEquipment('Edge fryer');
    insertMaintenance(eq, { type: 'repair', service_date: '2026-05-13' });
    const eqOld = insertEquipment('Old fryer');
    insertMaintenance(eqOld, { type: 'repair', service_date: '2026-05-12' });

    const out = analytics.buildOperatorAnalytics(LOC, TODAY, 7);

    assert.equal(out.window_start, '2026-05-13');
    assert.deepEqual(out.audit_actors.items.map((r) => r.actor), ['edge']);
    assert.deepEqual(out.audit_trend.items.map((r) => r.shift_date), ['2026-05-13']);
    assert.deepEqual(out.corrective_by_operator.items.map((r) => r.cook_id), ['edge']);
    assert.deepEqual(out.gold_star_leaders.items.map((r) => r.cook_name), ['edge']);
    assert.deepEqual(out.equipment_failures.items.map((r) => r.equipment_name), ['Edge fryer']);
  });

  it('isolates every SQL-backed section to the requested location', () => {
    insertAuditEvent({ location_id: 'loc-a', actor_cook_id: 'a-cook' });
    insertAuditEvent({ location_id: 'loc-b', actor_cook_id: 'b-cook' });
    insertTempLogCorrective({ location_id: 'loc-a', cook_id: 'a-cook' });
    insertTempLogCorrective({ location_id: 'loc-b', cook_id: 'b-cook' });
    insertLineCheckFail({ location_id: 'loc-a', cook_id: 'a-cook' });
    insertLineCheckFail({ location_id: 'loc-b', cook_id: 'b-cook' });
    insertGoldStar({ cook_name: 'a-cook', location_id: 'loc-a' });
    insertGoldStar({ cook_name: 'b-cook', location_id: 'loc-b' });
    const eqA = insertEquipment('A fryer', 'loc-a');
    insertMaintenance(eqA, { type: 'repair', location_id: 'loc-a' });
    const eqB = insertEquipment('B fryer', 'loc-b');
    insertMaintenance(eqB, { type: 'repair', location_id: 'loc-b' });

    const a = analytics.buildOperatorAnalytics('loc-a', TODAY);

    assert.deepEqual(a.audit_actors.items.map((r) => r.actor), ['a-cook']);
    assert.equal(a.audit_trend.items.reduce((n, r) => n + r.events, 0), 1);
    assert.deepEqual(a.corrective_by_operator.items.map((r) => r.cook_id), ['a-cook']);
    assert.equal(a.corrective_by_operator.items[0].total, 2);
    assert.deepEqual(a.gold_star_leaders.items.map((r) => r.cook_name), ['a-cook']);
    assert.deepEqual(a.equipment_failures.items.map((r) => r.equipment_name), ['A fryer']);

    const b = analytics.buildOperatorAnalytics('loc-b', TODAY);
    assert.deepEqual(b.audit_actors.items.map((r) => r.actor), ['b-cook']);
    assert.deepEqual(b.equipment_failures.items.map((r) => r.equipment_name), ['B fryer']);
  });

  it('caps ranked section items at 10 while count reports the full total', () => {
    for (let i = 0; i < 12; i += 1) {
      insertAuditEvent({ actor_cook_id: `cook-${String(i).padStart(2, '0')}` });
    }

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.audit_actors.count, 12);
    assert.equal(out.audit_actors.items.length, 10);
  });

  it('counts management actions from the JSONL feed, filtering by location when entries carry one', () => {
    writeAuditJsonl([
      { action: 'recipe_edit', timestamp: '2026-05-15T10:00:00.000Z' }, // no location → included
      { action: 'recipe_edit', timestamp: '2026-05-16T10:00:00.000Z', location_id: LOC },
      { action: 'cost_update', timestamp: '2026-05-16T11:00:00.000Z', location_id: LOC },
      { action: 'recipe_edit', timestamp: '2026-05-16T12:00:00.000Z', location_id: 'loc-b' }, // other loc
      { action: '  ', timestamp: '2026-05-17T10:00:00.000Z' }, // blank → (unlabeled)
      { action: 'recipe_edit', timestamp: '2026-01-01T10:00:00.000Z' }, // outside window
    ]);

    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    assert.equal(out.management_actions.count, 3);
    assert.deepEqual(out.management_actions.items, [
      { action: 'recipe_edit', events: 2 },
      { action: '(unlabeled)', events: 1 },
      { action: 'cost_update', events: 1 },
    ]);
  });

  it('returns empty sections when no data exists', () => {
    const out = analytics.buildOperatorAnalytics(LOC, TODAY);

    for (const key of [
      'audit_actors',
      'audit_trend',
      'corrective_by_operator',
      'corrective_by_subject',
      'gold_star_leaders',
      'equipment_failures',
      'management_actions',
    ]) {
      assert.deepEqual(out[key], { count: 0, items: [] }, `${key} should be empty`);
    }
  });
});

describe('GET /api/analytics/operators', () => {
  it('returns the analytics JSON contract with cache-control: no-store', async () => {
    insertAuditEvent({ actor_cook_id: 'cook-1' });
    insertGoldStar({ cook_name: 'Ana', stars: 2 });

    const res = await route.GET(
      new Request(`http://localhost/api/analytics/operators?date=${TODAY}`),
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.location_id, 'default');
    assert.equal(body.window_days, 30);
    assert.equal(body.window_start, '2026-04-20');
    assert.equal(body.window_end, TODAY);
    assert.equal(typeof body.generated_at, 'string');
    assert.equal(body.audit_actors.count, 1);
    assert.deepEqual(body.audit_actors.items, [{ actor: 'cook-1', events: 1 }]);
    assert.equal(body.gold_star_leaders.items[0].cook_name, 'Ana');
    for (const key of [
      'audit_trend',
      'corrective_by_operator',
      'corrective_by_subject',
      'equipment_failures',
      'management_actions',
    ]) {
      assert.equal(typeof body[key].count, 'number', `${key}.count`);
      assert.equal(Array.isArray(body[key].items), true, `${key}.items`);
    }
  });

  it('accepts each allowlisted window value', async () => {
    for (const w of [7, 30, 90]) {
      const res = await route.GET(
        new Request(`http://localhost/api/analytics/operators?date=${TODAY}&window=${w}`),
      );
      assert.equal(res.status, 200, `window=${w}`);
      const body = await res.json();
      assert.equal(body.window_days, w);
    }
  });

  it('rejects any window outside the allowlist with a 400 and no-store header', async () => {
    for (const bad of ['14', '0', '-7', '7.5', 'abc', '']) {
      const res = await route.GET(
        new Request(
          `http://localhost/api/analytics/operators?date=${TODAY}&window=${encodeURIComponent(bad)}`,
        ),
      );
      assert.equal(res.status, 400, `window=${JSON.stringify(bad)} should 400`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const body = await res.json();
      assert.equal(body.error, 'window must be one of 7, 30, 90');
    }
  });

  it('scopes results via ?location= and falls back malformed dates to today', async () => {
    insertAuditEvent({ location_id: 'loc-a', actor_cook_id: 'a-cook' });
    insertAuditEvent({ location_id: 'loc-b', actor_cook_id: 'b-cook' });

    const res = await route.GET(
      new Request(`http://localhost/api/analytics/operators?date=${TODAY}&location=loc-a`),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.location_id, 'loc-a');
    assert.deepEqual(body.audit_actors.items.map((r) => r.actor), ['a-cook']);

    // Malformed ?date= falls back to today's real date (route contract:
    // never 400s on date, only on window).
    const fallback = await route.GET(
      new Request('http://localhost/api/analytics/operators?date=not-a-date'),
    );
    assert.equal(fallback.status, 200);
    const fb = await fallback.json();
    assert.equal(fb.window_end, dbMod.todayISO());
  });
});
