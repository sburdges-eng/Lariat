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
const { ensureOpsRunForShift, insertManualOpsStep, localNowMinutes } = await import('../../lib/opsRunRepo.ts');

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

describe('localNowMinutes reads the venue clock', () => {
  // The server runs UTC in production. getHours() read the host clock while
  // serviceDate() partitions the shift in America/Denver, so every late count
  // moved by the offset — at 20:00 Denver the host said 02:00, which lands at
  // the very start of the service day and made nothing read late all evening.
  it('gives Denver wall minutes, not the host clock', () => {
    // 02:00Z = 20:00 MDT the previous evening — mid dinner service.
    assert.equal(localNowMinutes(new Date('2026-08-07T02:00:00Z')), 20 * 60);
    // 07:00Z = 01:00 MDT — after midnight, still the same shift.
    assert.equal(localNowMinutes(new Date('2026-08-07T07:00:00Z')), 60);
  });

  it('tracks the daylight-saving offset rather than a fixed one', () => {
    // January: Denver is MST (UTC-7). 02:00Z = 19:00 MST the previous evening.
    assert.equal(localNowMinutes(new Date('2026-01-07T02:00:00Z')), 19 * 60);
  });

  it('reports midnight as 0, not 1440', () => {
    // 06:00Z in August = 00:00 MDT.
    assert.equal(localNowMinutes(new Date('2026-08-07T06:00:00Z')), 0);
  });
});

describe('dynamic steps track their source board', () => {
  // A dynamic step mirrors live open work: an open prep task, an unsigned line
  // check. When the cook closes that work on its own board the record drops out
  // of the open-only query the materializer runs — but the ops_run_steps row it
  // already created stayed `todo`, went late, and made the cook tick the same
  // job off a second time here. Reconcile against what this pass actually
  // emitted so the mirror disappears with its source.
  it('drops an open dynamic step once its source work closes', () => {
    const shift = '2026-07-04';
    const prep = testDb
      .prepare(
        `INSERT INTO prep_tasks (shift_date, station_id, task, status, location_id)
         VALUES (?, 'saute', 'Brine chicken', 'todo', 'default')`,
      )
      .run(shift);

    let steps = ensureOpsRunForShift('default', shift, testDb);
    const mirrored = steps.filter((r) => r.source === 'prep');
    assert.ok(mirrored.length > 0, 'the open prep task should mirror onto the plan');

    // The cook finishes it on the prep board, not on the day plan.
    testDb.prepare(`UPDATE prep_tasks SET status = 'done' WHERE id = ?`)
      .run(prep.lastInsertRowid);

    steps = ensureOpsRunForShift('default', shift, testDb);
    assert.equal(
      steps.filter((r) => r.source === 'prep').length,
      0,
      'the mirror must clear when its source closes, not sit here going late',
    );
  });

  it('never reconciles away a step a cook acted on, or one they added', () => {
    const shift = '2026-07-05';
    const prep = testDb
      .prepare(
        `INSERT INTO prep_tasks (shift_date, station_id, task, status, location_id)
         VALUES (?, 'grill', 'Portion steaks', 'todo', 'default')`,
      )
      .run(shift);
    ensureOpsRunForShift('default', shift, testDb);

    // Cook marks the mirrored step done here, then closes the source task too.
    const mirror = ensureOpsRunForShift('default', shift, testDb)
      .find((r) => r.source === 'prep');
    assert.ok(mirror, 'precondition: a prep mirror exists');
    testDb.prepare(`UPDATE ops_run_steps SET status = 'done' WHERE id = ?`).run(mirror.id);
    testDb.prepare(`UPDATE prep_tasks SET status = 'done' WHERE id = ?`)
      .run(prep.lastInsertRowid);

    const manual = insertManualOpsStep(
      { location_id: 'default', shift_date: shift, daypart: 'side_work',
        title: 'Walk the walk-in' },
      testDb,
    );

    const steps = ensureOpsRunForShift('default', shift, testDb);
    assert.ok(
      steps.some((r) => r.id === mirror.id && r.status === 'done'),
      'a step the cook signed off is a record, not a mirror — it stays',
    );
    assert.ok(
      steps.some((r) => r.id === manual.id),
      'a step the cook added by hand is never reconciled away',
    );
    assert.ok(
      steps.some((r) => r.source === 'template'),
      'house template steps are never reconciled away',
    );
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
