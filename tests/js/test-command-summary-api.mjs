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
const { summarize, alertsFor } = await import('../../lib/commandCenter.ts');
const route = await import('../../app/api/command/summary/route.js');
const alertsRoute = await import('../../app/api/command/alerts/route.js');

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
  'temp_log', 'date_marks', 'cleaning_schedule',
  'preshift_notes', 'beo_events', 'reservations', 'prep_tasks',
  'dining_tables', 'inventory_updates', 'thermometer_calibrations',
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

describe('summarize() — cleaning schedule', () => {
  const ins = (loc, area, task, nextDue, active = 1, archivedAt = null) =>
    testDb.prepare(
      `INSERT INTO cleaning_schedule (location_id, area, task, frequency, next_due, active, archived_at)
       VALUES (?, ?, ?, 'daily', ?, ?, ?)`,
    ).run(loc, area, task, nextDue, active, archivedAt);

  it('counts overdue (past) and due-today rows', () => {
    const today = new Date(TODAY + 'T00:00:00Z');
    const minus1 = new Date(today); minus1.setUTCDate(minus1.getUTCDate() - 1);
    const minus5 = new Date(today); minus5.setUTCDate(minus5.getUTCDate() - 5);
    const plus2 = new Date(today); plus2.setUTCDate(plus2.getUTCDate() + 2);

    ins('default', 'Walk-in', 'Sanitize shelves', minus5.toISOString().slice(0, 10));
    ins('default', 'Hood', 'Filter swap', minus1.toISOString().slice(0, 10));
    ins('default', 'Floor', 'Mop drain', TODAY);
    ins('default', 'Reach-in', 'Wipe gaskets', plus2.toISOString().slice(0, 10));

    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.cleaning_overdue, 2);
    assert.strictEqual(s.food_safety.cleaning_due_today, 1);
  });

  it('ignores inactive and archived rows', () => {
    ins('default', 'Hood', 'Filter swap', TODAY, 0); // inactive
    ins('default', 'Floor', 'Mop drain', TODAY, 1, '2026-04-01'); // archived
    ins('default', 'Reach-in', 'Wipe gaskets', TODAY); // active, due today

    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.cleaning_due_today, 1);
    assert.strictEqual(s.food_safety.cleaning_overdue, 0);
  });

  it('rows with NULL next_due are not counted as overdue', () => {
    ins('default', 'Pantry', 'Deep clean', null);
    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.cleaning_overdue, 0);
    assert.strictEqual(s.food_safety.cleaning_due_today, 0);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', 'Walk-in', 'Sanitize', TODAY);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.food_safety.cleaning_due_today, 1);
    assert.strictEqual(b.food_safety.cleaning_due_today, 0);
  });
});

describe('summarize() — reservations', () => {
  const ins = (loc, status, atIso, partyName = 'Smith', size = 2) =>
    testDb.prepare(
      `INSERT INTO reservations (party_name, party_size, reservation_at, status, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(partyName, size, atIso, status, loc);

  it('groups today\'s book by status; cancelled excluded from total', () => {
    ins('default', 'booked',    `${TODAY} 18:30`, 'Garcia');
    ins('default', 'booked',    `${TODAY} 19:00`, 'Lee');
    ins('default', 'seated',    `${TODAY} 18:00`, 'Patel');
    ins('default', 'completed', `${TODAY} 17:30`, 'Kim');
    ins('default', 'no_show',   `${TODAY} 19:30`, 'Brown');
    ins('default', 'cancelled', `${TODAY} 20:00`, 'Stone');
    // Different day — should not be counted.
    ins('default', 'booked', '2026-04-30 18:00', 'Future');

    const s = summarize('default', TODAY);
    assert.strictEqual(s.reservations.booked, 2);
    assert.strictEqual(s.reservations.seated, 1);
    assert.strictEqual(s.reservations.completed, 1);
    assert.strictEqual(s.reservations.no_show, 1);
    assert.strictEqual(s.reservations.cancelled, 1);
    assert.strictEqual(s.reservations.total, 5);
  });

  it('returns zeros for empty book', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.reservations.total, 0);
    assert.strictEqual(s.reservations.booked, 0);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', 'booked', `${TODAY} 18:00`);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.reservations.booked, 1);
    assert.strictEqual(b.reservations.booked, 0);
  });
});

describe('summarize() — prep board', () => {
  const ins = (loc, status, priority, task = 'Brunoise onions') =>
    testDb.prepare(
      `INSERT INTO prep_tasks (shift_date, location_id, task, status, priority)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(TODAY, loc, task, status, priority);

  it('counts status buckets and rush (priority 1|2 + todo/in_progress)', () => {
    ins('default', 'todo',        1, 'Demi-glace');     // rush
    ins('default', 'todo',        3, 'Cut chiffonade'); // not rush
    ins('default', 'in_progress', 2, 'Roast bones');    // rush
    ins('default', 'in_progress', 1, 'Sear duck');      // rush
    ins('default', 'done',        1, 'Pickle daikon');  // priority high but DONE
    ins('default', 'skipped',     0, 'Drop fries');

    const s = summarize('default', TODAY);
    assert.strictEqual(s.prep.todo, 2);
    assert.strictEqual(s.prep.in_progress, 2);
    assert.strictEqual(s.prep.done, 1);
    assert.strictEqual(s.prep.skipped, 1);
    assert.strictEqual(s.prep.rush, 3);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', 'todo', 1);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.prep.todo, 1);
    assert.strictEqual(b.prep.todo, 0);
  });
});

describe('summarize() — price + margin moves (smoke)', () => {
  it('returns shape even when there is no vendor data', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.price_moves.total, 0);
    assert.strictEqual(s.price_moves.up, 0);
    assert.strictEqual(s.price_moves.down, 0);
    assert.strictEqual(s.margin_moves.total, 0);
  });
});

describe('summarize() — dining tables', () => {
  const ins = (loc, id, status, capacity = 4) =>
    testDb.prepare(
      `INSERT INTO dining_tables (id, name, capacity, status, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, id, capacity, status, loc);

  it('counts status buckets and totals seat occupancy', () => {
    ins('default', 'T1', 'open',   4);
    ins('default', 'T2', 'seated', 2);
    ins('default', 'T3', 'seated', 6);
    ins('default', 'T4', 'dirty',  4);
    ins('default', 'T5', 'closed', 2);

    const s = summarize('default', TODAY);
    assert.strictEqual(s.dining_tables.open, 1);
    assert.strictEqual(s.dining_tables.seated, 2);
    assert.strictEqual(s.dining_tables.dirty, 1);
    assert.strictEqual(s.dining_tables.closed, 1);
    assert.strictEqual(s.dining_tables.total, 5);
    assert.strictEqual(s.dining_tables.seats_total, 18);
    assert.strictEqual(s.dining_tables.seats_seated, 8);
  });

  it('returns zeros when there are no tables yet', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.dining_tables.total, 0);
    assert.strictEqual(s.dining_tables.seats_total, 0);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', 'T1', 'seated', 2);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.dining_tables.seated, 1);
    assert.strictEqual(b.dining_tables.seated, 0);
  });
});

describe('summarize() — waste log', () => {
  const ins = (loc, shiftDate, item, direction = 'waste') =>
    testDb.prepare(
      `INSERT INTO inventory_updates (shift_date, location_id, item, direction)
       VALUES (?, ?, ?, ?)`,
    ).run(shiftDate, loc, item, direction);

  it('counts today and last-7-days waste, ignoring non-waste directions', () => {
    const today = new Date(TODAY + 'T00:00:00Z');
    const minus3 = new Date(today); minus3.setUTCDate(minus3.getUTCDate() - 3);
    const minus10 = new Date(today); minus10.setUTCDate(minus10.getUTCDate() - 10);

    ins('default', TODAY, 'Pork chop');
    ins('default', TODAY, 'Aji verde');
    ins('default', minus3.toISOString().slice(0, 10), 'Cilantro');
    ins('default', minus10.toISOString().slice(0, 10), 'Tomato');     // outside 7-day window
    ins('default', TODAY, 'Mise',  'restock');                         // not waste

    const s = summarize('default', TODAY);
    assert.strictEqual(s.waste.today, 2);
    assert.strictEqual(s.waste.last_7d, 3);
  });

  it('returns zeros for empty log', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.waste.today, 0);
    assert.strictEqual(s.waste.last_7d, 0);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', TODAY, 'Item');
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.waste.today, 1);
    assert.strictEqual(b.waste.today, 0);
  });
});

describe('summarize() — probe calibrations', () => {
  // Insert one calibration row. days_ago counts BACK from TODAY.
  const ins = (loc, probeId, daysAgo, passed = 1, freq = null) => {
    const d = new Date(TODAY + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - daysAgo);
    const at = d.toISOString().slice(0, 10);
    testDb.prepare(
      `INSERT INTO thermometer_calibrations
         (location_id, thermometer_id, method, before_reading_f, passed,
          calibrated_at, frequency_days)
       VALUES (?, ?, 'ice_point', 32, ?, ?, ?)`,
    ).run(loc, probeId, passed, at, freq);
  };

  it('classifies probes as overdue / failed / due_soon', () => {
    // P1: passed 5 days ago, default 30d → ok (well within window)
    ins('default', 'P1', 5, 1);
    // P2: passed 25 days ago, default 30d → due_soon (within 7d of expiry)
    ins('default', 'P2', 25, 1);
    // P3: passed 40 days ago, default 30d → overdue
    ins('default', 'P3', 40, 1);
    // P4: most recent reading was a fail → failed (regardless of when)
    ins('default', 'P4', 2, 0);
    // P5: per-probe override 7d, last passed 10 days ago → overdue
    ins('default', 'P5', 10, 1, 7);

    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.probes_due_soon, 1);
    assert.strictEqual(s.food_safety.probes_overdue, 2);
    assert.strictEqual(s.food_safety.probes_failed, 1);
  });

  it('returns zeros when there are no calibration rows', () => {
    const s = summarize('default', TODAY);
    assert.strictEqual(s.food_safety.probes_overdue, 0);
    assert.strictEqual(s.food_safety.probes_failed, 0);
    assert.strictEqual(s.food_safety.probes_due_soon, 0);
  });

  it('does not leak across locations', () => {
    ins('kitchen-a', 'P1', 40, 1);
    const a = summarize('kitchen-a', TODAY);
    const b = summarize('kitchen-b', TODAY);
    assert.strictEqual(a.food_safety.probes_overdue, 1);
    assert.strictEqual(b.food_safety.probes_overdue, 0);
  });

  it('alertsFor surfaces probes-failed and probes-overdue as red, due-soon as amber', () => {
    ins('default', 'PA', 40, 1);  // overdue
    ins('default', 'PB', 2, 0);   // failed
    ins('default', 'PC', 25, 1);  // due_soon
    const s = summarize('default', TODAY);
    const a = alertsFor(s);
    assert.ok(a.some((x) => x.severity === 'red' && x.source === 'probes-overdue'));
    assert.ok(a.some((x) => x.severity === 'red' && x.source === 'probes-failed'));
    assert.ok(a.some((x) => x.severity === 'amber' && x.source === 'probes-due-soon'));
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

describe('alertsFor()', () => {
  it('emits no alerts on a clean summary', () => {
    const s = summarize('default', TODAY);
    const alerts = alertsFor(s);
    assert.strictEqual(alerts.length, 0);
  });

  it('orders red alerts before amber', () => {
    // Plant one red signal and one amber signal.
    testDb.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id) VALUES (?, ?, 'default')`,
    ).run(TODAY, 'aji-verde');
    testDb.prepare(
      `INSERT INTO inventory_par (ingredient, par_qty, par_unit, location_id) VALUES (?, ?, ?, ?)`,
    ).run('TOMATO', 30, 'lb', 'default');
    const cId = Number(testDb.prepare(
      `INSERT INTO inventory_counts (count_date, location_id) VALUES (?, 'default')`,
    ).run(TODAY).lastInsertRowid);
    testDb.prepare(
      `INSERT INTO inventory_count_lines (count_id, ingredient, on_hand_qty, location_id, counted_at)
       VALUES (?, 'TOMATO', 5, 'default', datetime('now'))`,
    ).run(cId);

    const s = summarize('default', TODAY);
    const alerts = alertsFor(s);
    assert.ok(alerts.length >= 2, 'expected at least 2 alerts');
    assert.strictEqual(alerts[0].severity, 'red');
    assert.strictEqual(alerts[0].source, 'eighty-six');
    assert.ok(alerts.some((a) => a.severity === 'amber' && a.source === 'inventory-low-par'));
    // Verify all reds precede all ambers.
    const firstAmber = alerts.findIndex((a) => a.severity === 'amber');
    const lastRed = alerts.map((a) => a.severity).lastIndexOf('red');
    assert.ok(firstAmber === -1 || firstAmber > lastRed);
  });

  it('only fires reservation no-show alert at threshold (3+)', () => {
    // 2 no-shows: NO red alert
    for (let i = 0; i < 2; i += 1) {
      testDb.prepare(
        `INSERT INTO reservations (party_name, party_size, reservation_at, status, location_id)
         VALUES (?, 2, ?, 'no_show', 'default')`,
      ).run(`Party-${i}`, `${TODAY} 18:00`);
    }
    const s2 = summarize('default', TODAY);
    const a2 = alertsFor(s2);
    assert.ok(!a2.some((a) => a.source === 'reservation-no-shows'));

    // Add a third → red alert appears.
    testDb.prepare(
      `INSERT INTO reservations (party_name, party_size, reservation_at, status, location_id)
       VALUES (?, 2, ?, 'no_show', 'default')`,
    ).run('Party-3', `${TODAY} 18:00`);
    const s3 = summarize('default', TODAY);
    const a3 = alertsFor(s3);
    assert.ok(a3.some((a) => a.severity === 'red' && a.source === 'reservation-no-shows'));
  });

  it('fires sales-down only when delta below -15%', () => {
    // Yesterday $500 vs $1000 7-day avg → -50%
    testDb.prepare(
      `INSERT INTO toast_sales_daily (shift_date, net_sales, orders, guests, comparison_group, location_id)
       VALUES (?, 500, 5, 10, 1, 'default')`,
    ).run(YESTERDAY);
    for (let i = 1; i <= 6; i += 1) {
      const d = new Date(YESTERDAY + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      testDb.prepare(
        `INSERT INTO toast_sales_daily (shift_date, net_sales, orders, guests, comparison_group, location_id)
         VALUES (?, 1083.33, 10, 20, 1, 'default')`,
      ).run(d.toISOString().slice(0, 10));
    }
    const s = summarize('default', TODAY);
    const a = alertsFor(s);
    assert.ok(a.some((x) => x.severity === 'amber' && x.source === 'sales-down'));
  });
});

describe('GET /api/command/alerts', () => {
  it('returns red/amber counts + alerts list', async () => {
    testDb.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id) VALUES (?, ?, 'default')`,
    ).run(TODAY, 'duck-confit');
    const res = await alertsRoute.GET(new Request(`http://localhost/api/command/alerts?date=${TODAY}`));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.shift_date, TODAY);
    assert.ok(j.red >= 1);
    assert.ok(Array.isArray(j.alerts));
    assert.ok(j.alerts.some((a) => a.source === 'eighty-six'));
  });

  it('clean state returns red=0 amber=0 empty alerts', async () => {
    const res = await alertsRoute.GET(new Request(`http://localhost/api/command/alerts?date=${TODAY}`));
    const j = await res.json();
    assert.strictEqual(j.red, 0);
    assert.strictEqual(j.amber, 0);
    assert.strictEqual(j.alerts.length, 0);
  });
});
