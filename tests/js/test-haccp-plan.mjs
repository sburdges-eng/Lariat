#!/usr/bin/env node
// Integration tests for lib/haccpPlan.ts and /api/food-safety/haccp-plan.
//
// Pins the inspector-ready HACCP plan contract:
//   - CCP inventory + rule-module list carry FDA citations
//   - corrective actions cover the last 30 days only
//   - calibration records and probe status board
//   - cross-location rows never leak
//   - route GET serves the plan JSON and validates ?date=

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-haccp-plan-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const haccp = await import('../../lib/haccpPlan.ts');
const route = await import('../../app/api/food-safety/haccp-plan/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const TABLES = [
  'temp_log',
  'line_check_entries',
  'cooling_log',
  'thermometer_calibrations',
  'receiving_log',
  'date_marks',
  'tphc_entries',
  'sanitizer_checks',
  'cleaning_log',
  'sick_worker_reports',
  'pest_control_log',
  'sds_registry',
];

beforeEach(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t};`);
});

const TODAY = '2026-06-10';

function isoMinusDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function insertTempLog({
  shift_date,
  point_id = 'walk_in_cooler',
  reading_f = 38,
  corrective_action = null,
  cook_id = 'cook-1',
  location_id = 'default',
}) {
  db.prepare(
    `INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, corrective_action, cook_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ? || ' 12:00:00')`,
  ).run(shift_date, location_id, point_id, reading_f, corrective_action, cook_id, shift_date);
}

function insertLineCheckFail({ shift_date, note, location_id = 'default' }) {
  db.prepare(
    `INSERT INTO line_check_entries (shift_date, station_id, item, status, note, cook_id, location_id, created_at)
     VALUES (?, 'grill', 'Demi', 'fail', ?, 'cook-2', ?, ? || ' 15:00:00')`,
  ).run(shift_date, note, location_id, shift_date);
}

function insertCalibration({
  thermometer_id = 'probe-1',
  calibrated_at,
  passed = 1,
  method = 'ice_point',
  before_reading_f = 32,
  location_id = 'default',
}) {
  db.prepare(
    `INSERT INTO thermometer_calibrations
       (location_id, thermometer_id, method, before_reading_f, after_reading_f, passed, action_taken, cook_id, calibrated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'verified', 'cook-3', ?)`,
  ).run(location_id, thermometer_id, method, before_reading_f, before_reading_f, passed, calibrated_at);
}

describe('buildHaccpPlan()', () => {
  it('assembles the CCP inventory and rule modules with FDA citations', () => {
    const plan = haccp.buildHaccpPlan('default', TODAY);

    assert.equal(plan.location_id, 'default');
    assert.equal(plan.plan_date, TODAY);
    assert.equal(plan.window_days, 30);
    assert.equal(plan.window_start, isoMinusDays(TODAY, 30));

    // Every registered temp-point CCP appears with its citation.
    assert.ok(plan.ccps.length >= 10);
    for (const ccp of plan.ccps) {
      assert.match(ccp.citation, /FDA §/, `${ccp.point_id} needs an FDA citation`);
      assert.ok(ccp.ccp_id.startsWith('CCP-'));
    }
    const walkIn = plan.ccps.find((c) => c.point_id === 'walk_in_cooler');
    assert.ok(walkIn);
    assert.match(walkIn.citation, /3-501\.16/);
    assert.equal(walkIn.required_max_f, 41);

    // Cooling is the time-based CCP-8.
    assert.equal(plan.cooling.ccp_id, 'CCP-8');
    assert.match(plan.cooling.citation, /3-501\.14/);

    // Rule modules each carry a citation.
    const ids = plan.rule_modules.map((m) => m.id);
    for (const want of ['receiving', 'date_marking', 'tphc', 'sanitizer', 'cleaning', 'sick_worker', 'pest_control', 'sds']) {
      assert.ok(ids.includes(want), `rule module ${want} missing`);
    }
    for (const m of plan.rule_modules) {
      assert.match(m.citation, /FDA §|OSHA/, `${m.id} needs a citation`);
      assert.equal(m.active, m.records > 0);
    }

    // Corrective + calibration sections carry citations too.
    assert.match(plan.corrective_actions.citation, /8-405\.11/);
    assert.match(plan.calibrations.citation, /4-502\.11/);
  });

  it('counts monitoring evidence per CCP inside the window', () => {
    insertTempLog({ shift_date: isoMinusDays(TODAY, 1) });
    insertTempLog({ shift_date: isoMinusDays(TODAY, 5), corrective_action: 'Moved product, called tech' });
    insertTempLog({ shift_date: isoMinusDays(TODAY, 31) }); // outside window
    insertTempLog({ shift_date: isoMinusDays(TODAY, 2), point_id: 'hot_hold', reading_f: 150 });

    const plan = haccp.buildHaccpPlan('default', TODAY);
    const walkIn = plan.ccps.find((c) => c.point_id === 'walk_in_cooler');
    const hotHold = plan.ccps.find((c) => c.point_id === 'hot_hold');

    assert.equal(walkIn.logs_30d, 2);
    assert.equal(walkIn.corrective_30d, 1);
    assert.equal(hotHold.logs_30d, 1);
    assert.equal(hotHold.corrective_30d, 0);
  });

  it('includes last-30-days corrective actions and excludes a 31-day-old one', () => {
    insertTempLog({
      shift_date: isoMinusDays(TODAY, 10),
      corrective_action: 'Iced down, recheck in 1h',
    });
    insertLineCheckFail({ shift_date: isoMinusDays(TODAY, 5), note: 'Remade demi from frozen backup' });
    insertTempLog({
      shift_date: isoMinusDays(TODAY, 31),
      corrective_action: 'Ancient fix that must not appear',
    });

    const plan = haccp.buildHaccpPlan('default', TODAY);

    assert.equal(plan.corrective_actions.count, 2);
    const notes = plan.corrective_actions.entries.map((e) => e.note);
    assert.ok(notes.includes('Iced down, recheck in 1h'));
    assert.ok(notes.includes('Remade demi from frozen backup'));
    assert.ok(!notes.includes('Ancient fix that must not appear'));
    // 30-day-old boundary row IS included.
    insertTempLog({ shift_date: isoMinusDays(TODAY, 30), corrective_action: 'Boundary fix' });
    const plan2 = haccp.buildHaccpPlan('default', TODAY);
    assert.ok(plan2.corrective_actions.entries.some((e) => e.note === 'Boundary fix'));
  });

  it('surfaces calibration records and the probe status board', () => {
    insertCalibration({ calibrated_at: `${isoMinusDays(TODAY, 3)} 09:00:00`, passed: 1 });
    insertCalibration({
      thermometer_id: 'probe-2',
      calibrated_at: `${isoMinusDays(TODAY, 8)} 09:30:00`,
      passed: 0,
      before_reading_f: 36,
    });
    insertCalibration({ calibrated_at: `${isoMinusDays(TODAY, 40)} 09:00:00` }); // outside window

    const plan = haccp.buildHaccpPlan('default', TODAY);

    assert.equal(plan.calibrations.records.length, 2);
    const byProbe = new Map(plan.calibrations.records.map((r) => [r.thermometer_id, r]));
    assert.equal(byProbe.get('probe-1').passed, true);
    assert.equal(byProbe.get('probe-2').passed, false);

    const probeStatuses = new Map(plan.calibrations.probes.map((p) => [p.thermometer_id, p.status]));
    assert.equal(probeStatuses.get('probe-1'), 'ok');
    assert.equal(probeStatuses.get('probe-2'), 'failed');
  });

  it('summarizes cooling batches and breaches in the window', () => {
    db.prepare(
      `INSERT INTO cooling_log (shift_date, location_id, item, started_at, status, breach_reason)
       VALUES (?, 'default', 'Chili', ? || 'T10:00:00Z', 'breach', 'stage1_too_slow')`,
    ).run(isoMinusDays(TODAY, 2), isoMinusDays(TODAY, 2));
    db.prepare(
      `INSERT INTO cooling_log (shift_date, location_id, item, started_at, status)
       VALUES (?, 'default', 'Stock', ? || 'T10:00:00Z', 'ok')`,
    ).run(isoMinusDays(TODAY, 4), isoMinusDays(TODAY, 4));

    const plan = haccp.buildHaccpPlan('default', TODAY);
    assert.equal(plan.cooling.batches_30d, 2);
    assert.equal(plan.cooling.breaches_30d, 1);
  });

  it('never leaks cross-location rows', () => {
    const OTHER = 'kitchen-b';
    insertTempLog({ shift_date: isoMinusDays(TODAY, 1), corrective_action: 'Other-site fix', location_id: OTHER });
    insertLineCheckFail({ shift_date: isoMinusDays(TODAY, 1), note: 'Other-site note', location_id: OTHER });
    insertCalibration({ calibrated_at: `${isoMinusDays(TODAY, 1)} 09:00:00`, location_id: OTHER });
    db.prepare(
      `INSERT INTO cooling_log (shift_date, location_id, item, started_at, status)
       VALUES (?, ?, 'Soup', ? || 'T10:00:00Z', 'ok')`,
    ).run(isoMinusDays(TODAY, 1), OTHER, isoMinusDays(TODAY, 1));
    db.prepare(
      `INSERT INTO sds_registry (location_id, product_name, active) VALUES (?, 'Quat', 1)`,
    ).run(OTHER);

    const plan = haccp.buildHaccpPlan('default', TODAY);

    assert.equal(plan.corrective_actions.count, 0);
    assert.equal(plan.calibrations.records.length, 0);
    assert.equal(plan.calibrations.probes.length, 0);
    assert.equal(plan.cooling.batches_30d, 0);
    for (const ccp of plan.ccps) assert.equal(ccp.logs_30d, 0);
    const sds = plan.rule_modules.find((m) => m.id === 'sds');
    assert.equal(sds.records, 0);
    assert.equal(sds.active, false);

    // And the other location sees its own rows.
    const other = haccp.buildHaccpPlan(OTHER, TODAY);
    assert.equal(other.corrective_actions.count, 2);
    assert.equal(other.calibrations.records.length, 1);
    assert.equal(other.cooling.batches_30d, 1);
  });
});

describe('GET /api/food-safety/haccp-plan', () => {
  it('returns the plan JSON for a valid date param', async () => {
    insertTempLog({ shift_date: isoMinusDays(TODAY, 1), corrective_action: 'Reset breaker' });

    const res = await route.GET(
      new Request(`http://localhost/api/food-safety/haccp-plan?date=${TODAY}`),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.plan_date, TODAY);
    assert.equal(body.location_id, 'default');
    assert.equal(body.corrective_actions.count, 1);
    assert.ok(Array.isArray(body.ccps));
  });

  it('falls back to today on a malformed date param', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/food-safety/haccp-plan?date=not-a-date'),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.plan_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(body.plan_date, 'not-a-date');
  });

  it('scopes by ?location=', async () => {
    insertTempLog({ shift_date: isoMinusDays(TODAY, 1), corrective_action: 'A-side fix', location_id: 'kitchen-a' });

    const res = await route.GET(
      new Request(`http://localhost/api/food-safety/haccp-plan?date=${TODAY}&location=kitchen-a`),
    );
    const body = await res.json();
    assert.equal(body.location_id, 'kitchen-a');
    assert.equal(body.corrective_actions.count, 1);
  });
});

describe('haccp plan — the corrective-action section reads every source', () => {
  // The document contradicted itself: the CCP table printed
  // `plan.cooling.breaches_30d` breaches, and two sections below it the
  // corrective-action section printed "No corrective actions recorded in
  // the window." Both were rendered from the same plan object, for the
  // same inspector, on the same sheet.

  function insertCoolingBreach({ shift_date, item, corrective_action, location_id = 'default' }) {
    db.prepare(
      `INSERT INTO cooling_log
         (shift_date, location_id, item, station_id, started_at, start_reading_f,
          stage1_at, stage1_reading_f, stage2_at, stage2_reading_f,
          status, breach_reason, corrective_action, cook_id, created_at)
       VALUES (?, ?, ?, 'saute', ?, 135, NULL, NULL, ?, 48, 'breach',
               'stage 2 over 4h', ?, 'cook-1', ?)`,
    ).run(shift_date, location_id, item, `${shift_date}T08:00:00Z`,
          `${shift_date}T15:00:00Z`, corrective_action, `${shift_date}T08:00:00Z`);
  }

  function insertSanitizerFail({ shift_date, point_label, corrective_action, location_id = 'default' }) {
    db.prepare(
      `INSERT INTO sanitizer_checks
         (shift_date, location_id, station_id, point_label, chemistry,
          concentration_ppm, required_min_ppm, required_max_ppm, water_temp_f,
          status, corrective_action, cook_id, created_at)
       VALUES (?, ?, 'dish', ?, 'quat', 150, 200, 400, 75, 'low', ?, 'cook-2', ?)`,
    ).run(shift_date, location_id, point_label, corrective_action, `${shift_date}T12:00:00Z`);
  }

  it('prints the cooling breach it already counted two sections above', () => {
    const day = isoMinusDays(TODAY, 3);
    insertCoolingBreach({ shift_date: day, item: 'pork green chile', corrective_action: 'split into hotel pans' });

    const plan = haccp.buildHaccpPlan('default', TODAY);
    assert.ok(plan.cooling.breaches_30d >= 1, 'sanity: the breach is counted');
    const cooling = plan.corrective_actions.entries.filter((e) => e.source === 'cooling');
    assert.equal(cooling.length, 1, 'the breach the plan counted must appear as a corrective action');
    assert.equal(cooling[0].subject, 'pork green chile');
    assert.equal(cooling[0].note, 'split into hotel pans');
    assert.notEqual(plan.corrective_actions.count, 0);
  });

  it('prints a sanitizer fix', () => {
    const day = isoMinusDays(TODAY, 2);
    insertSanitizerFail({ shift_date: day, point_label: 'dish machine final rinse', corrective_action: 'remade at 300ppm' });

    const plan = haccp.buildHaccpPlan('default', TODAY);
    const sanitizer = plan.corrective_actions.entries.filter((e) => e.source === 'sanitizer');
    assert.equal(sanitizer.length, 1);
    assert.equal(sanitizer[0].note, 'remade at 300ppm');
  });

  it('keeps the 30-day window and the location scope on the new sources', () => {
    insertCoolingBreach({ shift_date: isoMinusDays(TODAY, 31), item: 'old stock', corrective_action: 'too old to print' });
    insertCoolingBreach({ shift_date: isoMinusDays(TODAY, 2), item: 'other venue', corrective_action: 'not ours', location_id: 'second' });
    insertSanitizerFail({ shift_date: isoMinusDays(TODAY, 40), point_label: 'stale', corrective_action: 'too old' });

    const plan = haccp.buildHaccpPlan('default', TODAY);
    const notes = plan.corrective_actions.entries.map((e) => e.note);
    assert.ok(!notes.includes('too old to print'), '31-day-old row must fall outside the window');
    assert.ok(!notes.includes('not ours'), 'another location must never leak into this plan');
    assert.ok(!notes.includes('too old'), 'sanitizer window must match');
  });
});
