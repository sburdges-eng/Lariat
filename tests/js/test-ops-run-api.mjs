#!/usr/bin/env node
// Integration tests for /api/ops-run (day-plan spine).
//
// Run: npx -y node@24 --experimental-strip-types --test tests/js/test-ops-run-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ops-run-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const opsRoute = await import('../../app/api/ops-run/route.js');
const opsIdRoute = await import('../../app/api/ops-run/[id]/route.js');
const { summarize, alertsFor } = await import('../../lib/commandCenter.ts');
const { serviceDate } = await import('../../lib/serviceDate.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM ops_run_steps;
    DELETE FROM ops_run_template_steps;
    DELETE FROM ops_run_templates;
    DELETE FROM equipment_maintenance_schedule;
    DELETE FROM equipment_maintenance;
    DELETE FROM equipment;
    DELETE FROM cleaning_schedule;
    DELETE FROM cleaning_log;
    DELETE FROM beo_prep_tasks;
    DELETE FROM beo_events;
    DELETE FROM prep_tasks;
    DELETE FROM line_check_entries;
    DELETE FROM station_signoffs;
    DELETE FROM toast_sales_dow;
    DELETE FROM reservations;
    DELETE FROM audit_events;
    DELETE FROM idempotency_keys;
    DELETE FROM performance_reviews;
  `);
});

function req(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET /api/ops-run', () => {
  it('materializes the house day plan once', async () => {
    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.shift_date, '2099-06-15');
    assert.ok(json.rows.length >= 10);
    assert.ok(json.rows.some((r) => r.daypart === 'open'));
    assert.ok(json.rows.some((r) => r.daypart === 'side_work'));
    assert.ok(json.rows.some((r) => r.link_href === '/prep'));
    assert.equal(json.rollup.todo, json.rows.length);

    const again = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const j2 = await again.json();
    assert.equal(j2.rows.length, json.rows.length);
  });

  it('attaches due maintenance as gear steps', async () => {
    const eqId = Number(
      testDb
        .prepare(
          `INSERT INTO equipment (name, category, location_id) VALUES ('Walk-in cooler', 'cold', 'default')`,
        )
        .run().lastInsertRowid,
    );
    testDb
      .prepare(
        `INSERT INTO equipment_maintenance_schedule
           (equipment_id, task, frequency, next_due, location_id)
         VALUES (?, 'Clean coils', 'monthly', '2099-06-10', 'default')`,
      )
      .run(eqId);

    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    assert.ok(
      json.rows.some(
        (r) =>
          r.daypart === 'maintenance' &&
          r.source === 'maintenance' &&
          /Walk-in cooler/.test(r.title),
      ),
    );
  });

  it('pulls banquet BEO prep + order guide step', async () => {
    const evId = Number(
      testDb
        .prepare(
          `INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
           VALUES ('Hillside buyout', '2099-06-15', '18:00', 120, 'confirmed', 'default')`,
        )
        .run().lastInsertRowid,
    );
    testDb
      .prepare(
        `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id)
         VALUES (?, 'Brine 40 chicken', '2099-06-14', 0, 1, 'default')`,
      )
      .run(evId);
    testDb
      .prepare(
        `INSERT INTO beo_prep_tasks (event_id, task, done, sort_order, location_id)
         VALUES (?, 'Already done mise', 1, 2, 'default')`,
      )
      .run(evId);

    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    assert.ok(json.rows.some((r) => r.source === 'beo' && /Hillside buyout/.test(r.title)));
    assert.ok(json.rows.some((r) => r.source === 'beo' && /Brine 40 chicken/.test(r.title)));
    assert.ok(!json.rows.some((r) => /Already done mise/.test(r.title)));
    assert.ok(
      json.rows.some(
        (r) => r.step_key.startsWith('beo-order-pull-') && r.link_href === '/purchasing',
      ),
    );
  });

  it('pulls open prep list tasks', async () => {
    testDb
      .prepare(
        `INSERT INTO prep_tasks (shift_date, station_id, task, qty, priority, status, location_id)
         VALUES ('2099-06-15', 'grill', 'Demi 2qt', '2 qt', 2, 'todo', 'default')`,
      )
      .run();

    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    assert.ok(json.rows.some((r) => r.source === 'prep' && /Prep list/.test(r.title)));
    assert.ok(json.rows.some((r) => r.source === 'prep' && /Demi 2qt/.test(r.title)));
  });

  it('pulls cleaning schedule due/overdue', async () => {
    testDb
      .prepare(
        `INSERT INTO cleaning_schedule (location_id, area, task, frequency, next_due, active)
         VALUES ('default', 'Hood', 'Filter change', 'weekly', '2099-06-10', 1)`,
      )
      .run();

    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    assert.ok(
      json.rows.some(
        (r) =>
          r.source === 'cleaning' &&
          /Hood/.test(r.title) &&
          /Late since/.test(r.detail || ''),
      ),
    );
  });

  it('flags historically busy days from Toast DOW + banquet', async () => {
    // 2099-06-15 is a Monday — make Mon the busiest DOW.
    for (const [dow, guests] of [
      ['Sun', 50],
      ['Mon', 220],
      ['Tue', 60],
      ['Wed', 70],
      ['Thu', 80],
      ['Fri', 100],
      ['Sat', 180],
    ]) {
      testDb
        .prepare(
          `INSERT INTO toast_sales_dow
             (day_of_week, net_sales, orders, guests, comparison_group, location_id)
           VALUES (?, 1000, 40, ?, 1, 'default')`,
        )
        .run(dow, guests);
    }
    testDb
      .prepare(
        `INSERT INTO beo_events (title, event_date, guest_count, status, location_id)
         VALUES ('Farm dinner', '2099-06-15', 110, 'confirmed', 'default')`,
      )
      .run();

    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    const busy = json.rows.find((r) => r.source === 'busy');
    assert.ok(busy, 'expected busy-day step');
    assert.match(busy.detail || '', /usually busy|Banquet today/);
  });

  it('includes unsigned line-check stations from the house map', async () => {
    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2099-06-15&location=default'),
    );
    const json = await res.json();
    // stations.json has line-check stations; none signed off on this blank date.
    assert.ok(
      json.rows.some((r) => r.source === 'line_check'),
      'expected line_check steps from station map',
    );
  });

  it('loads August daily + weekly checklist on Wed Aug 12', async () => {
    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2026-08-12&location=default'),
    );
    const json = await res.json();
    assert.ok(json.rows.some((r) => r.source === 'checklist-daily'));
    assert.ok(json.rows.some((r) => r.source === 'checklist-weekly' && /Wed/.test(r.title)));
  });

  it('loads August monthly checklist on Sun Aug 16', async () => {
    const res = await opsRoute.GET(
      new Request('http://localhost/api/ops-run?date=2026-08-16&location=default'),
    );
    const json = await res.json();
    assert.ok(json.rows.some((r) => r.source === 'checklist-monthly'));
  });
});

describe('POST /api/ops-run + PATCH', () => {
  it('adds a manual step and marks it done with audit', async () => {
    const post = await opsRoute.POST(
      req('http://localhost/api/ops-run', 'POST', {
        shift_date: '2099-06-15',
        location_id: 'default',
        daypart: 'side_work',
        title: 'Rag buckets out',
        cook_id: 'maria',
      }),
    );
    assert.equal(post.status, 200);
    const created = await post.json();
    assert.equal(created.ok, true);
    assert.equal(created.step.title, 'Rag buckets out');
    assert.equal(created.step.status, 'todo');

    const auditInsert = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity = 'ops_run_steps' AND action = 'insert'`,
      )
      .get().c;
    assert.equal(auditInsert, 1);

    const patch = await opsIdRoute.PATCH(
      req(`http://localhost/api/ops-run/${created.step.id}`, 'PATCH', {
        status: 'done',
        location_id: 'default',
        cook_id: 'maria',
      }),
      { params: Promise.resolve({ id: String(created.step.id) }) },
    );
    assert.equal(patch.status, 200);
    const updated = await patch.json();
    assert.equal(updated.step.status, 'done');
    assert.equal(updated.step.done_by, 'maria');

    const auditUpdate = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity = 'ops_run_steps' AND action = 'update'`,
      )
      .get().c;
    assert.equal(auditUpdate, 1);
  });

  it('rejects blank title', async () => {
    const res = await opsRoute.POST(
      req('http://localhost/api/ops-run', 'POST', { title: '  ', daypart: 'prep' }),
    );
    assert.equal(res.status, 400);
  });
});

describe('command alerts for day plan', () => {
  it('does not invent alerts before the plan is materialized', () => {
    // Seed one review so performance-reviews-none stays quiet — isolate day-plan.
    const today = db.todayISO();
    testDb
      .prepare(
        `INSERT INTO performance_reviews
           (cook_name, review_date, reviewer_name, notes, location_id)
         VALUES ('Kai', ?, 'Maria', 'ok', 'default')`,
      )
      .run(today);

    const s = summarize('default', today);
    assert.equal(s.ops_run.todo, 0);
    assert.equal(s.ops_run.late, 0);
    const alerts = alertsFor(s);
    assert.ok(!alerts.some((a) => a.source === 'day-plan-late'));
    assert.ok(!alerts.some((a) => a.source === 'day-plan-open'));
  });

  // The Command tile links straight to /day-plan, so its counts have to come
  // from the same partition the board renders. The board defaults to
  // serviceDate(); if this tile followed the caller's `today` instead, then
  // between 18:00 and 02:00 Mountain a manager would read "0 late" here and
  // click through to a board full of late steps.
  it('counts the service date, not whatever date the caller passed', async () => {
    const svc = serviceDate();
    await opsRoute.GET(new Request(`http://localhost/api/ops-run?date=${svc}&location=default`));

    // A date with no steps of its own. ops_run must ignore it.
    const s = summarize('default', '2020-01-01');
    assert.ok(
      s.ops_run.todo > 0,
      'ops_run counts must follow serviceDate(), not the passed date',
    );
  });

  it('surfaces day-plan-open after materialize', async () => {
    const today = db.todayISO();
    testDb
      .prepare(
        `INSERT INTO performance_reviews
           (cook_name, review_date, reviewer_name, notes, location_id)
         VALUES ('Kai', ?, 'Maria', 'ok', 'default')`,
      )
      .run(today);

    await opsRoute.GET(new Request(`http://localhost/api/ops-run?date=${today}&location=default`));
    const s = summarize('default', today);
    assert.ok(s.ops_run.todo > 0);
    const alerts = alertsFor(s);
    // Either late or open — depending on wall clock vs due_times.
    assert.ok(
      alerts.some((a) => a.source === 'day-plan-late' || a.source === 'day-plan-open'),
      `expected day-plan alert, got ${alerts.map((a) => a.source).join(',')}`,
    );
  });
});
