#!/usr/bin/env node
// Financial ACID hardening regression tests.
//
// Pins the four hardening layers:
//   1. synchronous=FULL is active on the DB connection
//   2. BEO financial mutations produce audit_events rows inside the same txn
//   3. Gold-star, inventory, and 86 POST mutations produce audit_events rows
//   4. vendorPricesRepo upsert is atomic (SELECT→INSERT/UPDATE in txn)
//   5. dishComponentsRepo upsert is atomic (SELECT→INSERT/UPDATE in txn)
//
// Run: node --experimental-strip-types --test tests/js/test-financial-acid.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-financial-acid-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { todayISO } = db;
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;

// Import routes AFTER setDbPathForTest + getDb so handles point at test DB.
const beoRoute = await import('../../app/api/beo/route.js');
const goldStarsRoute = await import('../../app/api/gold-stars/route.ts');
const goldStarByIdRoute = await import('../../app/api/gold-stars/[id]/route.ts');
const inventoryRoute = await import('../../app/api/inventory/route.js');
const eightySixRoute = await import('../../app/api/eighty-six/route.js');

// Repo modules
const { upsertVendorPrice, validateVendorPriceRow } = await import('../../lib/vendorPricesRepo.ts');
const { upsertDishComponent, validateDishComponentRow } = await import('../../lib/dishComponentsRepo.ts');

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM beo_events;
    DELETE FROM beo_line_items;
    DELETE FROM beo_prep_tasks;
    DELETE FROM gold_stars;
    DELETE FROM inventory_updates;
    DELETE FROM eighty_six;
  `);
});

function postReq(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pinCookieHeader() {
  const value = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
  return `lariat_pin_ok=${value}`;
}

function deleteReq(url, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method: 'DELETE', headers });
}

function countRows(table, where = '') {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// ═════════════════════════════════════════════════════════════════
// 1. PRAGMA synchronous = FULL
// ═════════════════════════════════════════════════════════════════

describe('Durability — synchronous PRAGMA', () => {
  it('synchronous is set to FULL (2)', () => {
    const row = testDb.pragma('synchronous');
    // SQLite returns 2 for FULL
    assert.strictEqual(row[0].synchronous, 2, `expected synchronous=2 (FULL), got ${row[0].synchronous}`);
  });

  it('journal_mode is WAL', () => {
    const row = testDb.pragma('journal_mode');
    assert.strictEqual(row[0].journal_mode, 'wal');
  });

  it('foreign_keys are ON', () => {
    const row = testDb.pragma('foreign_keys');
    assert.strictEqual(row[0].foreign_keys, 1);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. BEO route — financial mutations produce audit rows
// ═════════════════════════════════════════════════════════════════

describe('BEO route — financial mutations + audit trail', () => {
  it('create event: inserts into beo_events AND audit_events atomically', async () => {
    const res = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'event',
      title: 'Wedding Reception',
      event_date: '2026-06-15',
      tax_rate: 0.0875,
      service_fee_pct: 22,
      guest_count: 150,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.id);
    assert.strictEqual(countRows('beo_events'), 1);
    assert.strictEqual(countAudit('beo_events'), 1);

    // Audit payload includes financial fields
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='beo_events'`).get();
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.tax_rate, 0.0875);
    assert.strictEqual(payload.service_fee_pct, 22);
  });

  it('create line item: inserts into beo_line_items AND audit_events atomically', async () => {
    // First create an event
    const evRes = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'event',
      title: 'Corp Dinner',
    }));
    const evBody = await evRes.json();
    testDb.exec('DELETE FROM audit_events');

    const res = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'line',
      event_id: evBody.id,
      item_name: 'Filet Mignon',
      unit_cost: 42.50,
      quantity: 75,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('beo_line_items'), 1);
    assert.strictEqual(countAudit('beo_line_items'), 1);

    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='beo_line_items'`).get();
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.unit_cost, 42.50);
    assert.strictEqual(payload.quantity, 75);
  });

  it('update event: produces update audit row', async () => {
    const evRes = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'event',
      title: 'Rehearsal Dinner',
    }));
    const evBody = await evRes.json();
    testDb.exec('DELETE FROM audit_events');

    const res = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'update_event',
      id: evBody.id,
      tax_rate: 0.095,
      service_fee_pct: 25,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countAudit('beo_events'), 1);
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='beo_events' AND action='update'`).get();
    assert.ok(audit);
  });

  it('delete event: cascades + audit in one transaction', async () => {
    const evRes = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'event',
      title: 'To Delete',
    }));
    const evBody = await evRes.json();
    // Add a prep task so we verify cascade
    await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'prep',
      event_id: evBody.id,
      task: 'Prep asparagus',
    }));
    testDb.exec('DELETE FROM audit_events');

    const res = await beoRoute.POST(postReq('http://localhost/api/beo', {
      action: 'delete_event',
      id: evBody.id,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('beo_events'), 0);
    assert.strictEqual(countRows('beo_prep_tasks'), 0);
    assert.strictEqual(countAudit('beo_events'), 1);
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='beo_events' AND action='delete'`).get();
    assert.ok(audit);
  });

  it('rollback: if audit_events table is broken, beo_events insert rolls back', async () => {
    testDb.exec('ALTER TABLE audit_events RENAME TO audit_events_stash');
    try {
      const before = countRows('beo_events');
      const res = await beoRoute.POST(postReq('http://localhost/api/beo', {
        action: 'event',
        title: 'Should Roll Back',
        tax_rate: 0.10,
      }));
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(countRows('beo_events'), before, 'beo_events must be rolled back');
    } finally {
      testDb.exec('ALTER TABLE audit_events_stash RENAME TO audit_events');
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Gold Stars — HR/personal data audit
// ═════════════════════════════════════════════════════════════════

describe('Gold Stars — HR data audit trail', () => {
  it('POST inserts gold_star AND audit_events atomically', async () => {
    const res = await goldStarsRoute.POST(postReq('http://localhost/api/gold-stars', {
      cook_name: 'Jenny',
      reason: 'Perfect mise en place all week',
      stars: 2,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('gold_stars'), 1);
    assert.strictEqual(countAudit('gold_stars'), 1);

    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='gold_stars'`).get();
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.cook_name, 'Jenny');
    assert.strictEqual(payload.stars, 2);
  });

  it('DELETE is rejected without a manager PIN cookie when PIN gating is configured', async () => {
    process.env.LARIAT_PIN = '4242';
    delete process.env.LARIAT_PIN_SECRET;

    const info = testDb
      .prepare('INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?,?,?,?)')
      .run('Jenny', 'Perfect mise en place all week', 2, 'default');
    testDb.exec('DELETE FROM audit_events');

    const res = await goldStarByIdRoute.DELETE(
      deleteReq(`http://localhost/api/gold-stars/${info.lastInsertRowid}`, null),
      { params: Promise.resolve({ id: String(info.lastInsertRowid) }) },
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(countRows('gold_stars'), 1);
    assert.strictEqual(countAudit('gold_stars'), 0);
  });

  it('DELETE soft-archives the row and writes a delete audit row atomically', async () => {
    process.env.LARIAT_PIN = '4242';
    delete process.env.LARIAT_PIN_SECRET;

    const info = testDb
      .prepare('INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?,?,?,?)')
      .run('Marco', 'Closed brunch cleanly', 3, 'default');
    const id = Number(info.lastInsertRowid);
    testDb.exec('DELETE FROM audit_events');

    const res = await goldStarByIdRoute.DELETE(
      deleteReq(`http://localhost/api/gold-stars/${id}`, await pinCookieHeader()),
      { params: Promise.resolve({ id: String(id) }) },
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('gold_stars'), 1, 'soft delete keeps the source row');

    const row = testDb.prepare('SELECT * FROM gold_stars WHERE id = ?').get(id);
    assert.ok(row.deleted_at, 'deleted_at must be stamped');
    assert.strictEqual(row.deleted_by, 'manager_pin');

    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='gold_stars' AND action='delete'`).get();
    assert.ok(audit, 'delete audit row must exist');
    assert.strictEqual(audit.entity_id, id);
    assert.strictEqual(audit.actor_source, 'manager_pin');
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.cook_name, 'Marco');
    assert.strictEqual(payload.reason, 'Closed brunch cleanly');
    assert.strictEqual(payload.stars, 3);

    const listRes = await goldStarsRoute.GET(new Request('http://localhost/api/gold-stars'));
    assert.strictEqual(listRes.status, 200);
    const visibleRows = await listRes.json();
    assert.deepStrictEqual(visibleRows, [], 'soft-deleted rows are hidden from the staff board');
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. Inventory — COGS-relevant audit
// ═════════════════════════════════════════════════════════════════

describe('Inventory — COGS audit trail', () => {
  it('POST inserts inventory_update AND audit_events atomically', async () => {
    const res = await inventoryRoute.POST(postReq('http://localhost/api/inventory', {
      item: 'chicken breast 40lb CS',
      delta: '-5 lb',
      direction: 'out',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('inventory_updates'), 1);
    assert.strictEqual(countAudit('inventory_updates'), 1);
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. 86 — menu availability audit
// ═════════════════════════════════════════════════════════════════

describe('86 — menu availability audit trail', () => {
  it('POST inserts eighty_six AND audit_events atomically', async () => {
    const res = await eightySixRoute.POST(postReq('http://localhost/api/eighty-six', {
      item: 'salmon',
      reason: 'supplier short',
      cook_id: 'bob',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('eighty_six'), 1);
    assert.strictEqual(countAudit('eighty_six'), 1);

    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='eighty_six'`).get();
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.item, 'salmon');
  });
});

// ═════════════════════════════════════════════════════════════════
// 6. vendorPricesRepo — TOCTOU atomicity
// ═════════════════════════════════════════════════════════════════

describe('vendorPricesRepo — atomic upsert', () => {
  it('insert: creates a new row', () => {
    const result = upsertVendorPrice(testDb, {
      location_id: 'default',
      vendor: 'Shamrock',
      sku: 'SKU-001',
      ingredient: 'Heavy Cream',
      pack_size: 6,
      pack_unit: 'qt',
      pack_price: 18.50,
      unit_price: 3.083,
      category: 'dairy',
    });
    assert.strictEqual(result.outcome, 'inserted');
    assert.ok(result.row.id);
  });

  it('skip: identical row is skipped', () => {
    const row = {
      location_id: 'default',
      vendor: 'Shamrock',
      sku: 'SKU-002',
      ingredient: 'Butter',
      pack_size: 36,
      pack_unit: 'lb',
      pack_price: 120.00,
      unit_price: 3.333,
      category: 'dairy',
    };
    upsertVendorPrice(testDb, row);
    const result = upsertVendorPrice(testDb, row);
    assert.strictEqual(result.outcome, 'skipped');
  });

  it('update: changed price updates existing row', () => {
    const row = {
      location_id: 'default',
      vendor: 'Shamrock',
      sku: 'SKU-003',
      ingredient: 'Olive Oil',
      pack_size: 6,
      pack_unit: 'qt',
      pack_price: 42.00,
      unit_price: 7.00,
      category: 'oil',
    };
    const first = upsertVendorPrice(testDb, row);
    assert.strictEqual(first.outcome, 'inserted');
    const second = upsertVendorPrice(testDb, { ...row, pack_price: 45.00, unit_price: 7.50 });
    assert.strictEqual(second.outcome, 'updated');
    assert.strictEqual(second.row.id, first.row.id, 'same row updated, not a new insert');
  });
});

// ═════════════════════════════════════════════════════════════════
// 7. dishComponentsRepo — TOCTOU atomicity
// ═════════════════════════════════════════════════════════════════

describe('dishComponentsRepo — atomic upsert', () => {
  it('insert recipe component', () => {
    const result = upsertDishComponent(testDb, {
      location_id: 'default',
      dish_name: 'filet mignon',
      component_type: 'recipe',
      recipe_slug: 'mashed-potatoes',
      vendor_ingredient: null,
      qty_per_serving: 6,
      unit: 'oz',
      notes: null,
    });
    assert.strictEqual(result.outcome, 'inserted');
  });

  it('skip: identical component is skipped', () => {
    const row = {
      location_id: 'default',
      dish_name: 'grilled salmon',
      component_type: 'vendor_item',
      recipe_slug: null,
      vendor_ingredient: 'Atlantic Salmon Fillet',
      qty_per_serving: 8,
      unit: 'oz',
      notes: null,
    };
    upsertDishComponent(testDb, row);
    const result = upsertDishComponent(testDb, row);
    assert.strictEqual(result.outcome, 'skipped');
  });

  it('update: changed qty updates existing component', () => {
    const row = {
      location_id: 'default',
      dish_name: 'caesar salad',
      component_type: 'recipe',
      recipe_slug: 'caesar-dressing',
      vendor_ingredient: null,
      qty_per_serving: 2,
      unit: 'oz',
      notes: null,
    };
    const first = upsertDishComponent(testDb, row);
    assert.strictEqual(first.outcome, 'inserted');
    const second = upsertDishComponent(testDb, { ...row, qty_per_serving: 3 });
    assert.strictEqual(second.outcome, 'updated');
    assert.strictEqual(second.row.id, first.row.id, 'same row updated, not a new insert');
  });
});
