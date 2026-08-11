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
