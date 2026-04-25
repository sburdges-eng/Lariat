#!/usr/bin/env node
// Integration tests for /api/command/summary and lib/commandCenter.summarize().
//
// Seeds a freshly-initialized DB with one row per signal source, then
// asserts the summary aggregations match. Locks the SQL queries against
// future schema drift.

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cmd-summary-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const { summarize } = await import('../../lib/commandCenter.ts');
const route = await import('../../app/api/command/summary/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const TABLES = [
  'toast_sales_daily', 'eighty_six',
  'inventory_par', 'inventory_count_lines', 'inventory_counts',
  'shift_breaks', 'staff_certifications',
  'temp_log', 'date_marks', 'preshift_notes', 'beo_events',
];

beforeEach(() => {
  for (const t of TABLES) testDb.exec(`DELETE FROM ${t};`);
});

const TODAY = '2026-04-25';
const YESTERDAY = '2026-04-24';

function seedSales(loc, date, group, net, orders = 10, guests = 25) {
  testDb
    .prepare(
      `INSERT INTO toast_sales_daily (shift_date, net_sales, orders, guests, comparison_group, location_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(date, net, orders, guests, group, loc);
}

describe('summarize() — sales', () => {
  it('returns yesterday + 7-day average + delta', () => {
    // The avg7 window is `shift_date < today LIMIT 7`, so it INCLUDES
    // yesterday alongside the six days before it.
    seedSales('default', YESTERDAY, 1, 1000);
    for (let i = 1; i <= 6; i += 1) {
      const d = new Date(YESTERDAY + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      seedSales('default', d.toISOString().slice(0, 10), 1, 800);
    }
    const s = summarize('default', TODAY);
    assert.strictEqual(s.sales.yesterday_net, 1000);
    const expectedAvg = (1000 + 6 * 800) / 7;
    assert.ok(Math.abs(s.sales.avg7_net - expectedAvg) < 0.0001);
    const expectedDelta = (1000 - expectedAvg) / expectedAvg;
    assert.ok(Math.abs(s.sales.delta_pct - expectedDelta) < 0.0001);
  });

  it('zero sales yesterday returns zeros without throwing', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.sales.yesterday_net, 0);
    assert.strictEqual(s.sales.delta_pct, 0);
  });
});

describe('summarize() — inventory low-par join', () => {
  it('counts ingredients where latest count < par', () => {
    testDb.prepare(`INSERT INTO inventory_par (ingredient, sku, par_qty, par_unit, location_id) VALUES (?, ?, ?, ?, ?)`)
      .run('TOMATO', 'TOM01', 30, 'lb', 'default');
    testDb.prepare(`INSERT INTO inventory_par (ingredient, sku, par_qty, par_unit, location_id) VALUES (?, ?, ?, ?, ?)`)
      .run('AVOCADO', 'AVO', 12, 'ea', 'default');
    testDb.prepare(`INSERT INTO inventory_par (ingredient, sku, par_qty, par_unit, location_id) VALUES (?, ?, ?, ?, ?)`)
      .run('PARSLEY', '', 4, 'bunch', 'default');

    const cInfo = testDb
      .prepare(`INSERT INTO inventory_counts (count_date, label, location_id) VALUES (?, ?, ?)`)
      .run(TODAY, 'walk-in', 'default');
    const cId = Number(cInfo.lastInsertRowid);

    // tomato is below par
    testDb.prepare(
      `INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, unit, location_id, counted_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(cId, 'TOMATO', 'TOM01', 12, 'lb', 'default');
    // avocado is above par
    testDb.prepare(
      `INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, unit, location_id, counted_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(cId, 'AVOCADO', 'AVO', 20, 'ea', 'default');
    // parsley not counted

    const s = summarize('default', TODAY);
    assert.strictEqual(s.inventory.low_par, 1);
    assert.strictEqual(s.inventory.par_total, 3);
  });

  it('counts open count sessions', () => {
    testDb.prepare(`INSERT INTO inventory_counts (count_date, label, location_id, closed_at) VALUES (?, ?, ?, NULL)`)
      .run(TODAY, 'open-1', 'default');
    testDb.prepare(`INSERT INTO inventory_counts (count_date, label, location_id, closed_at) VALUES (?, ?, ?, datetime('now'))`)
      .run(TODAY, 'closed-1', 'default');
    const s = summarize('default', TODAY);
    assert.strictEqual(s.inventory.open_counts, 1);
  });
});

describe('summarize() — labor', () => {
  it('counts open (unended, non-waived) breaks today', () => {
    testDb.prepare(
      `INSERT INTO shift_breaks (shift_date, location_id, cook_id, kind, started_at, ended_at, waived)
       VALUES (?, 'default', 'a', 'meal', datetime('now'), NULL, 0)`,
    ).run(TODAY);
    testDb.prepare(
      `INSERT INTO shift_breaks (shift_date, location_id, cook_id, kind, started_at, ended_at, waived)
       VALUES (?, 'default', 'b', 'meal', datetime('now'), datetime('now'), 0)`,
    ).run(TODAY);
    testDb.prepare(
      `INSERT INTO shift_breaks (shift_date, location_id, cook_id, kind, started_at, ended_at, waived)
       VALUES (?, 'default', 'c', 'meal', datetime('now'), NULL, 1)`,
    ).run(TODAY);
    const s = summarize('default', TODAY);
    assert.strictEqual(s.labor.open_breaks, 1);
  });

  it('classifies cert expiry as expired vs expiring-30d', () => {
    const today = new Date(TODAY + 'T00:00:00Z');
    const minus3 = new Date(today); minus3.setUTCDate(minus3.getUTCDate() - 3);
    const plus15 = new Date(today); plus15.setUTCDate(plus15.getUTCDate() + 15);
    const plus60 = new Date(today); plus60.setUTCDate(plus60.getUTCDate() + 60);
    const ins = (cookId, expIso) =>
      testDb.prepare(
        `INSERT INTO staff_certifications (cook_id, cert_type, cert_label, expires_on, active, location_id)
         VALUES (?, 'food_handler', 'FH', ?, 1, 'default')`,
      ).run(cookId, expIso);
    ins('a', minus3.toISOString().slice(0, 10));
    ins('b', plus15.toISOString().slice(0, 10));
    ins('c', plus60.toISOString().slice(0, 10));
    const s = summarize('default', TODAY);
    assert.strictEqual(s.labor.cert_expired, 1);
    assert.strictEqual(s.labor.cert_expiring_30d, 1);
  });
});

describe('summarize() — date marks', () => {
  it('counts expired and due-today active date marks', () => {
    const today = new Date(TODAY + 'T00:00:00Z');
    const minus2 = new Date(today); minus2.setUTCDate(minus2.getUTCDate() - 2);
    const plus3 = new Date(today); plus3.setUTCDate(plus3.getUTCDate() + 3);
    const ins = (item, discard, prepared, discardedAt = null) => testDb.prepare(
      `INSERT INTO date_marks (location_id, item, prepared_on, discard_on, discarded_at)
       VALUES ('default', ?, ?, ?, ?)`,
    ).run(item, prepared, discard, discardedAt);

    // expired (past due)
    ins('aji-verde', minus2.toISOString().slice(0, 10), minus2.toISOString().slice(0, 10));
    // due today
    ins('shrimp-stock', TODAY, TODAY);
    // ok (future)
    ins('chimichurri', plus3.toISOString().slice(0, 10), TODAY);
    // already discarded — should be excluded entirely
    ins('compost-base', minus2.toISOString().slice(0, 10), minus2.toISOString().slice(0, 10), 'datetime("now")');

    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.date_marks_expired, 1);
    assert.strictEqual(s.food_safety.date_marks_due_today, 1);
  });

  it('does not leak date marks across locations', () => {
    testDb.prepare(
      `INSERT INTO date_marks (location_id, item, prepared_on, discard_on)
       VALUES ('kitchen-a', 'aioli', ?, ?)`,
    ).run(TODAY, TODAY);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.food_safety.date_marks_due_today, 1);
    assert.strictEqual(b.food_safety.date_marks_due_today, 0);
  });
});

describe('summarize() — events + 86 + preshift', () => {
  it('counts active 86 (resolved_at NULL) and totals event guests', () => {
    testDb.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id, resolved_at) VALUES (?, ?, 'default', NULL)`,
    ).run(TODAY, 'aji-verde');
    testDb.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id, resolved_at) VALUES (?, ?, 'default', datetime('now'))`,
    ).run(TODAY, 'pork-chop');

    testDb.prepare(
      `INSERT INTO beo_events (title, event_date, guest_count, status, location_id)
       VALUES ('Smith wedding', ?, 80, 'planned', 'default')`,
    ).run(TODAY);
    testDb.prepare(
      `INSERT INTO beo_events (title, event_date, guest_count, status, location_id)
       VALUES ('Garcia retirement', ?, 25, 'cancelled', 'default')`,
    ).run(TODAY);

    testDb.prepare(
      `INSERT INTO preshift_notes (location_id, shift_date, service_label, body)
       VALUES ('default', ?, 'dinner', 'Push the cassoulet')`,
    ).run(TODAY);

    const s = summarize('default', TODAY);
    assert.strictEqual(s.eighty_six, 1);
    assert.strictEqual(s.events_today, 1);
    assert.strictEqual(s.events_guests, 80);
    assert.strictEqual(s.preshift_notes, 1);
  });
});

describe('summarize() — location scoping', () => {
  it('does not leak signals across locations', () => {
    seedSales('kitchen-a', YESTERDAY, 1, 500);
    seedSales('kitchen-b', YESTERDAY, 1, 9999);
    const a = summarize('kitchen-a', TODAY);
    assert.strictEqual(a.sales.yesterday_net, 500);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(b.sales.yesterday_net, 9999);
  });
});

describe('GET /api/command/summary', () => {
  it('returns 200 + summary JSON', async () => {
    seedSales('default', YESTERDAY, 1, 700);
    const res = await route.GET(new Request(`http://localhost/api/command/summary?date=${TODAY}`));
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.shift_date, TODAY);
    assert.strictEqual(json.sales.yesterday_net, 700);
  });

  it('rejects bad date param by falling back to todayISO', async () => {
    const res = await route.GET(new Request('http://localhost/api/command/summary?date=not-a-date'));
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    // Whatever today is, it should match the YYYY-MM-DD shape.
    assert.match(json.shift_date, /^\d{4}-\d{2}-\d{2}$/);
  });
});
