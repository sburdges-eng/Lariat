#!/usr/bin/env node
// Integration tests for the specials → menu promotion flow (roadmap 3.6):
// lib/specialsPromotion.ts + POST /api/specials/saved/[id]/promote.
//
// The key assertion: after promoting a costed special, menu engineering
// computes a NONZERO cost for the promoted dish from existing tables
// (dish_components + vendor_prices), with no changes to menuEngineering.
//
// Run: node --experimental-strip-types --test tests/js/test-specials-promotion.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-promotion-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const AUDIT_PATH = path.join(TMP_DIR, 'management-actions.jsonl');

process.env.LARIAT_AUDIT_PATH = AUDIT_PATH;
// PIN gate must be OFF for the happy-path tests; the rejection test
// flips it on explicitly.
delete process.env.LARIAT_PIN;

const dbMod = await import('../../lib/db.ts');
dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

const create = await import('../../app/api/specials/saved/route.js');
const promote = await import('../../app/api/specials/saved/[id]/promote/route.js');
const promotion = await import('../../lib/specialsPromotion.ts');
const menuEng = await import('../../lib/menuEngineering.ts');
const bridge = await import('../../lib/dishCostBridge.ts');

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  for (const t of ['specials', 'specials_promotions', 'dish_components', 'vendor_prices', 'sales_lines', 'audit_events']) {
    db.exec(`DELETE FROM ${t};`);
  }
  try { fs.unlinkSync(AUDIT_PATH); } catch { /* ignore */ }
});

function seedVendorPrice({ ingredient, pack_size = 1, pack_unit = 'lb', pack_price, unit_price, location_id = 'default' }) {
  db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id)
     VALUES (?, 'shamrock', 'SKU-1', ?, ?, ?, ?, 'protein', ?)`,
  ).run(ingredient, pack_size, pack_unit, pack_price, unit_price, location_id);
}

function jsonRequest(url, body, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// A costed special: two matched lines + one unmatched (no vendor row).
const costedBody = {
  name: 'Pork Belly Stack',
  pantry_text: '10 lbs pork belly',
  prompt_text: 'High-margin special',
  ai_answer: 'Sear belly. Stack over slaw.',
  ai_model: 'lari-the-kitchen-assistant',
  cost_breakdown: [
    { item: 'pork belly', req_qty: 4, req_unit: 'lb', match: 'PORK BELLY SKIN-ON', cost: 20 },
    { item: 'bbq sauce', req_qty: 8, req_unit: 'oz', match: 'BBQ SAUCE SWEET 1GAL', cost: 1.5 },
    { item: 'micro greens', req_qty: 1, req_unit: 'oz', cost: null, note: 'No vendor match' },
  ],
  cost_total: 21.5,
  scratch_notes: '',
  sources: [],
};

async function createSpecial(overrides = {}) {
  const res = await create.POST(jsonRequest('http://x/api/specials/saved', { ...costedBody, ...overrides }));
  assert.equal(res.status, 200);
  return (await res.json()).id;
}

function seedDefaultVendors(location_id = 'default') {
  // unit_price is per pack_unit: $5/lb belly, $0.10/oz sauce.
  seedVendorPrice({ ingredient: 'PORK BELLY SKIN-ON', pack_size: 10, pack_unit: 'lb', pack_price: 50, unit_price: 5, location_id });
  seedVendorPrice({ ingredient: 'BBQ SAUCE SWEET 1GAL', pack_size: 128, pack_unit: 'oz', pack_price: 12.8, unit_price: 0.1, location_id });
}

async function promoteSpecial(id, body, qs = '') {
  const url = `http://x/api/specials/saved/${id}/promote${qs}`;
  const req = body === undefined
    ? new Request(url, { method: 'POST' })
    : jsonRequest(url, body);
  return promote.POST(req, { params: { id } });
}

describe('POST /api/specials/saved/[id]/promote — happy path', () => {
  it('writes dish_components + promotion record + audit row, returns the contract', async () => {
    seedDefaultVendors();
    const id = await createSpecial();

    const res = await promoteSpecial(id, { menu_item_name: 'Lariat Belly Stack', servings: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();

    assert.equal(data.ok, true);
    assert.equal(data.repromoted, false);
    assert.equal(data.promotion.special_id, id);
    assert.equal(data.promotion.menu_item_name, 'Lariat Belly Stack');
    assert.equal(data.promotion.servings, 2);
    assert.ok(Number.isFinite(data.promotion.promoted_at));
    assert.equal(data.components.length, 2);
    assert.deepEqual(data.skipped, [{ item: 'micro greens', reason: 'unmatched' }]);

    // dish_components: per-serving quantities (breakdown qty / servings).
    const rows = db.prepare(
      `SELECT * FROM dish_components WHERE dish_name = 'Lariat Belly Stack' ORDER BY vendor_ingredient`,
    ).all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].component_type, 'vendor_item');
    assert.equal(rows[0].vendor_ingredient, 'BBQ SAUCE SWEET 1GAL');
    assert.equal(rows[0].qty_per_serving, 4);   // 8 oz / 2 servings
    assert.equal(rows[0].unit, 'oz');
    assert.equal(rows[1].vendor_ingredient, 'PORK BELLY SKIN-ON');
    assert.equal(rows[1].qty_per_serving, 2);   // 4 lb / 2 servings
    assert.equal(rows[1].unit, 'lb');
    assert.equal(rows[1].location_id, 'default');

    // Promotion record.
    const promo = db.prepare('SELECT * FROM specials_promotions WHERE special_id = ?').get(id);
    assert.ok(promo);
    assert.equal(promo.menu_item_name, 'Lariat Belly Stack');
    assert.equal(promo.servings, 2);
    assert.equal(JSON.parse(promo.components_json).length, 2);

    // Transactional audit_events row.
    const audit = db.prepare(
      `SELECT * FROM audit_events WHERE entity = 'specials_promotion' ORDER BY id DESC`,
    ).all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'insert');
    const payload = JSON.parse(audit[0].payload_json);
    assert.equal(payload.special_id, id);
    assert.equal(payload.menu_item_name, 'Lariat Belly Stack');
    assert.equal(payload.component_count, 2);

    // File-audit line, mirroring sibling saved-specials mutations.
    const fileAudit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').pop());
    assert.equal(fileAudit.action, 'specials.promote');
    assert.equal(fileAudit.special_id, id);
  });

  it('defaults to the special name and 1 serving on an empty POST', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    const res = await promoteSpecial(id);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.promotion.menu_item_name, 'Pork Belly Stack');
    assert.equal(data.promotion.servings, 1);
    const row = db.prepare(
      `SELECT qty_per_serving FROM dish_components WHERE dish_name = 'Pork Belly Stack' AND vendor_ingredient = 'PORK BELLY SKIN-ON'`,
    ).get();
    assert.equal(row.qty_per_serving, 4);
  });
});

describe('promotion pulls cost data through to menu engineering', () => {
  it('computeMenuEngineering shows the promoted dish with a nonzero cost', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    const res = await promoteSpecial(id, { menu_item_name: 'Lariat Belly Stack', servings: 2 });
    assert.equal(res.status, 200);

    // The dish sells (Toast ingest writes sales_lines) — menu engineering
    // must pick the cost up from the rows promotion wrote, untouched.
    db.prepare(
      `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('Lariat Belly Stack', 10, 240, 'toast', 'default')`,
    ).run();

    const result = menuEng.computeMenuEngineering('default', db);
    const row = result.rows.find((r) => r.item_name === 'Lariat Belly Stack');
    assert.ok(row, 'promoted dish missing from menu engineering');
    assert.equal(row.link_state, 'fully_linked');
    // 2 lb × $5/lb + 4 oz × $0.10/oz = $10.40 per serving.
    assert.ok(Math.abs(row.cost_per_unit - 10.4) < 1e-9);
    assert.ok(row.cost_per_unit > 0);
    // avg price $24, cost $10.40 → margin ≈ 56.67%.
    assert.ok(row.margin_pct > 56 && row.margin_pct < 57);
    assert.equal(result.coverage.fully_linked, 1);
  });

  it('computeDishCost resolves the promoted dish even before any sales', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    await promoteSpecial(id, { menu_item_name: 'Lariat Belly Stack', servings: 2 });

    const cost = bridge.computeDishCost('Lariat Belly Stack', 'default', undefined, undefined, db);
    assert.equal(cost.link_state, 'fully_linked');
    assert.ok(Math.abs(cost.total_cost - 10.4) < 1e-9);
  });
});

describe('componentsFromBreakdown', () => {
  it('merges duplicate vendor matches when the units are convertible', () => {
    const result = promotion.componentsFromBreakdown([
      { item: 'pork belly roast', req_qty: 4, req_unit: 'lb', match: 'PORK BELLY SKIN-ON' },
      { item: 'pork belly trim', req_qty: 8, req_unit: 'oz', match: 'PORK BELLY SKIN-ON' },
    ], 1);

    assert.deepEqual(result.skipped, []);
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].vendor_ingredient, 'PORK BELLY SKIN-ON');
    assert.equal(result.components[0].unit, 'lb');
    assert.ok(Math.abs(result.components[0].qty_per_serving - 4.5) < 1e-9);
  });
});

describe('idempotent re-promote', () => {
  it('re-promoting with the same args refreshes rather than duplicates', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    await promoteSpecial(id, { menu_item_name: 'Lariat Belly Stack', servings: 2 });
    const res = await promoteSpecial(id, { menu_item_name: 'Lariat Belly Stack', servings: 2 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.repromoted, true);

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM specials_promotions').get().c, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS c FROM dish_components WHERE dish_name = 'Lariat Belly Stack'`).get().c,
      2,
    );
    const audit = db.prepare(
      `SELECT action FROM audit_events WHERE entity = 'specials_promotion' ORDER BY id`,
    ).all();
    assert.deepEqual(audit.map((a) => a.action), ['insert', 'update']);
  });

  it('re-promoting under a new menu item name moves the cost rows', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    await promoteSpecial(id, { menu_item_name: 'Old Name', servings: 2 });
    const res = await promoteSpecial(id, { menu_item_name: 'New Name', servings: 4 });
    assert.equal(res.status, 200);

    assert.equal(
      db.prepare(`SELECT COUNT(*) AS c FROM dish_components WHERE dish_name = 'Old Name'`).get().c,
      0,
    );
    const rows = db.prepare(
      `SELECT * FROM dish_components WHERE dish_name = 'New Name' ORDER BY vendor_ingredient`,
    ).all();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].qty_per_serving, 1); // 4 lb / 4 servings

    const promo = db.prepare('SELECT * FROM specials_promotions WHERE special_id = ?').get(id);
    assert.equal(promo.menu_item_name, 'New Name');
    assert.equal(promo.servings, 4);
  });
});

describe('location scoping', () => {
  it('writes promotion rows under the special location and 404s cross-location', async () => {
    seedDefaultVendors('loc-a');
    const id = await createSpecial({ location_id: 'loc-a' });

    // Promoting from the wrong location: not found.
    const wrong = await promoteSpecial(id, { servings: 1 }, '?location=loc-b');
    assert.equal(wrong.status, 404);

    const res = await promoteSpecial(id, { menu_item_name: 'Belly A', servings: 1 }, '?location=loc-a');
    assert.equal(res.status, 200);

    const rows = db.prepare(`SELECT DISTINCT location_id FROM dish_components`).all();
    assert.deepEqual(rows.map((r) => r.location_id), ['loc-a']);
    assert.equal(
      db.prepare(`SELECT location_id FROM specials_promotions WHERE special_id = ?`).get(id).location_id,
      'loc-a',
    );

    // The other location's menu engineering sees nothing.
    db.prepare(
      `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('Belly A', 5, 100, 'toast', 'loc-b')`,
    ).run();
    const other = menuEng.computeMenuEngineering('loc-b', db);
    const row = other.rows.find((r) => r.item_name === 'Belly A');
    assert.equal(row.link_state, 'unlinked');
    assert.equal(row.cost_per_unit, null);
  });
});

describe('gating and failure modes', () => {
  it('rejects with 401 when the PIN gate is configured and no PIN cookie is present', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    process.env.LARIAT_PIN = '1234';
    try {
      const res = await promoteSpecial(id, { servings: 1 });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'unauthorized');
    } finally {
      delete process.env.LARIAT_PIN;
    }
    // Nothing written.
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM specials_promotions').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dish_components').get().c, 0);
  });

  it('404s on an unknown special id', async () => {
    const res = await promoteSpecial('no-such-id', { servings: 1 });
    assert.equal(res.status, 404);
  });

  it('410s on an archived special', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    db.prepare('UPDATE specials SET archived_at = ? WHERE id = ?').run(Date.now(), id);
    const res = await promoteSpecial(id, { servings: 1 });
    assert.equal(res.status, 410);
  });

  it('400s when no cost_breakdown line has a vendor match', async () => {
    const id = await createSpecial({
      cost_breakdown: [{ item: 'micro greens', req_qty: 1, req_unit: 'oz', cost: null, note: 'No vendor match' }],
    });
    const res = await promoteSpecial(id, { servings: 1 });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /no costed ingredients/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM specials_promotions').get().c, 0);
  });

  it('400s on invalid servings and menu_item_name', async () => {
    seedDefaultVendors();
    const id = await createSpecial();
    const badServings = await promoteSpecial(id, { servings: -2 });
    assert.equal(badServings.status, 400);
    const badName = await promoteSpecial(id, { menu_item_name: '   ' });
    assert.equal(badName.status, 400);
  });
});
