#!/usr/bin/env node
// Integration tests for lib/morningDigest.ts and /api/morning.
//
// Covers the manager-open digest contract:
//   - active 86 list
//   - vendor price shocks
//   - certs due this week
//   - equipment maintenance due
//   - BEO prep status
//   - webhook-ready Slack text

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-morning-digest-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const morning = await import('../../lib/morningDigest.ts');
const route = await import('../../app/api/morning/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const TABLES = [
  'toast_sales_daily',
  'eighty_six',
  'staff_certifications',
  'equipment',
  'equipment_maintenance_schedule',
  'beo_events',
  'beo_prep_tasks',
  'vendor_prices_history',
  'vendor_prices',
];

beforeEach(() => {
  for (const t of TABLES) db.exec(`DELETE FROM ${t};`);
});

const TODAY = '2026-04-25';

function isoDaysAgoFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function insertSnapshot({ vendor, sku, ingredient, unit_price, snapshot_at, location_id = 'default' }) {
  db.prepare(
    `INSERT INTO vendor_prices_history
       (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, category, location_id, snapshot_at, snapshot_reason)
     VALUES (1, ?, ?, ?, 1, 'lb', ?, ?, 'produce', ?, ?, 'test')`,
  ).run(ingredient, vendor, sku, unit_price, unit_price, location_id, snapshot_at);
}

describe('buildMorningDigest()', () => {
  it('assembles the manager-open digest from existing tables', () => {
    db.prepare(
      `INSERT INTO eighty_six (shift_date, item, reason, location_id)
       VALUES (?, 'Avocado', 'vendor short', 'default')`,
    ).run(TODAY);
    db.prepare(
      `INSERT INTO eighty_six (shift_date, item, reason, location_id, resolved_at)
       VALUES (?, 'Lime', 'resolved', 'default', datetime('now'))`,
    ).run(TODAY);

    const plus3 = new Date(TODAY + 'T00:00:00Z');
    plus3.setUTCDate(plus3.getUTCDate() + 3);
    db.prepare(
      `INSERT INTO staff_certifications (cook_id, cert_type, cert_label, expires_on, active, location_id)
       VALUES ('cook-1', 'food_handler', 'Food Handler', ?, 1, 'default')`,
    ).run(plus3.toISOString().slice(0, 10));
    db.prepare(
      `INSERT INTO staff_certifications (cook_id, cert_type, cert_label, expires_on, active, location_id)
       VALUES ('cook-2', 'food_handler', 'Food Handler', '2026-05-20', 1, 'default')`,
    ).run();

    const equip = db.prepare(
      `INSERT INTO equipment (name, category, location_id)
       VALUES ('Walk-in cooler', 'cold', 'default')`,
    ).run();
    const equipmentId = Number(equip.lastInsertRowid);
    db.prepare(
      `INSERT INTO equipment_maintenance_schedule (equipment_id, task, frequency, next_due, location_id)
       VALUES (?, 'Filter clean', 'weekly', ?, 'default')`,
    ).run(equipmentId, TODAY);

    const event = db.prepare(
      `INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
       VALUES ('Wedding tasting', ?, '17:00', 80, 'planned', 'default')`,
    ).run(TODAY);
    const eventId = Number(event.lastInsertRowid);
    db.prepare(
      `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
       VALUES (?, 'Marinate chicken', ?, 0, 'default')`,
    ).run(eventId, TODAY);
    db.prepare(
      `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
       VALUES (?, 'Pack sauces', ?, 1, 'default')`,
    ).run(eventId, TODAY);

    insertSnapshot({
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unit_price: 20,
      snapshot_at: isoDaysAgoFromNow(6),
    });
    insertSnapshot({
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unit_price: 25,
      snapshot_at: isoDaysAgoFromNow(0),
    });

    const digest = morning.buildMorningDigest('default', TODAY);

    assert.equal(digest.location_id, 'default');
    assert.equal(digest.shift_date, TODAY);
    assert.equal(digest.eighty_six.count, 1);
    assert.equal(digest.eighty_six.items[0].item, 'Avocado');
    assert.equal(digest.price_shocks.count, 1);
    assert.equal(digest.price_shocks.items[0].sku, 'AVO-1');
    assert.equal(digest.certs_expiring_week.count, 1);
    assert.equal(digest.certs_expiring_week.items[0].cook_id, 'cook-1');
    assert.equal(digest.maintenance_due.count, 1);
    assert.equal(digest.maintenance_due.items[0].equipment_name, 'Walk-in cooler');
    assert.equal(digest.beo_prep.count, 1);
    assert.equal(digest.beo_prep.items[0].title, 'Wedding tasting');
    assert.equal(digest.beo_prep.items[0].open_tasks, 1);
    assert.match(digest.webhook.text, /Morning digest/);
    assert.match(digest.webhook.text, /86 board: 1 item/);
    assert.match(digest.webhook.text, /Price shocks: 1 item/);
  });

  it('scopes every section to the requested location', () => {
    db.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id)
       VALUES (?, 'A', 'kitchen-a'), (?, 'B', 'kitchen-b')`,
    ).run(TODAY, TODAY);

    const equip = db.prepare(
      `INSERT INTO equipment (name, category, location_id)
       VALUES ('Flat top', 'hot', 'kitchen-a')`,
    ).run();
    db.prepare(
      `INSERT INTO equipment_maintenance_schedule (equipment_id, task, frequency, next_due, location_id)
       VALUES (?, 'Scrape', 'daily', ?, 'kitchen-a')`,
    ).run(Number(equip.lastInsertRowid), TODAY);

    const a = morning.buildMorningDigest('kitchen-a', TODAY);
    const b = morning.buildMorningDigest('kitchen-b', TODAY);

    assert.equal(a.eighty_six.count, 1);
    assert.equal(a.maintenance_due.count, 1);
    assert.equal(b.eighty_six.count, 1);
    assert.equal(b.maintenance_due.count, 0);
  });
});

describe('GET /api/morning', () => {
  it('returns digest JSON with webhook text', async () => {
    db.prepare(
      `INSERT INTO eighty_six (shift_date, item, location_id)
       VALUES (?, 'Halibut', 'default')`,
    ).run(TODAY);

    const res = await route.GET(new Request(`http://localhost/api/morning?date=${TODAY}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.shift_date, TODAY);
    assert.equal(body.eighty_six.count, 1);
    assert.equal(typeof body.webhook.text, 'string');
    assert.match(body.webhook.text, /Halibut/);
  });
});
