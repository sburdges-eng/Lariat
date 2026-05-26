#!/usr/bin/env node
// Integration tests for /api/receiving.
//
// Mirrors test-temp-log-api.mjs: spin up a temp SQLite DB, import the
// route in-process, assert on the Response objects. Covers the audit
// row emission, 422 behavior, and the GET summary shape.
//
// Run: node --test tests/js/test-receiving-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-receiving-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/receiving/route.js');
const matchListRoute = await import('../../app/api/receiving/matches/route.js');
const matchDetailRoute = await import('../../app/api/receiving/matches/[id]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { GET: GET_MATCHES } = matchListRoute;
const { PATCH: PATCH_MATCH } = matchDetailRoute;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Order matters: inventory_updates.receiving_log_id is a FK into
  // receiving_log; clearing the parent first would trip the constraint.
  testDb.exec(
    'DELETE FROM inventory_updates; DELETE FROM receiving_log; DELETE FROM audit_events; DELETE FROM vendor_prices; DELETE FROM ingredient_masters;',
  );
});

function postReq(body) {
  return new Request('http://localhost/api/receiving', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/receiving${qs}`);
}

function getMatchesReq(qs = '') {
  return new Request(`http://localhost/api/receiving/matches${qs}`);
}

function patchMatchReq(id, body, qs = '') {
  return [
    new Request(`http://localhost/api/receiving/matches/${id}${qs}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(id) } },
  ];
}

function countReceiving() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM receiving_log').get().c;
}

function countInventoryUpdates() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM inventory_updates').get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

function seedMaster(masterId, canonicalName) {
  testDb
    .prepare(
      `INSERT INTO ingredient_masters
         (master_id, canonical_name, category, preferred_vendor, last_reviewed)
       VALUES (?, ?, 'protein', 'Shamrock', datetime('now'))`,
    )
    .run(masterId, canonicalName);
}

function seedVendorPrice({
  master_id,
  ingredient = 'chicken breast 40lb CS',
  vendor = 'Shamrock',
  sku = 'CHK-40',
  location_id = 'default',
}) {
  testDb
    .prepare(
      `INSERT INTO vendor_prices
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
          category, location_id, master_id)
       VALUES (?, ?, ?, 40, 'lb', 120, 3, 'protein', ?, ?)`,
    )
    .run(ingredient, vendor, sku, location_id, master_id);
}

// ── POST — happy path ────────────────────────────────────────────

describe('POST /api/receiving — happy path', () => {
  it('accepts an in-spec refrigerated delivery', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      vendor: 'Shamrock',
      invoice_ref: 'INV-1001',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.decision.status, 'ok');
    assert.strictEqual(body.entry.status, 'accepted');
    assert.strictEqual(body.entry.reading_f, 38);
    assert.strictEqual(body.entry.package_ok, 1);
    assert.strictEqual(countReceiving(), 1);
  });

  it('accepts a dry-goods delivery with no reading', async () => {
    const res = await POST(postReq({
      vendor: 'Sysco',
      category: 'dry_goods',
      item: 'canned tomatoes #10',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
  });

  it('persists expiration_date and invoice_ref', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      invoice_ref: 'INV-2002',
      category: 'shell_eggs',
      item: '15dz flat',
      reading_f: 42,
      expiration_date: '2099-05-15',
    }));
    const row = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(row.invoice_ref, 'INV-2002');
    assert.strictEqual(row.expiration_date, '2099-05-15');
  });

  it('accepts invoice_no as alias for invoice_ref', async () => {
    const res = await POST(postReq({
      vendor: 'sysco',
      category: 'refrigerated',
      item: 'Milk 2%',
      reading_f: 40,
      package_ok: true,
      invoice_no: 'INV-9999',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT invoice_ref FROM receiving_log ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.invoice_ref, 'INV-9999');
  });
});

// ── POST — validation / 400 path ─────────────────────────────────

describe('POST /api/receiving — validation', () => {
  it('400 when vendor is missing', async () => {
    const res = await POST(postReq({
      category: 'refrigerated',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReceiving(), 0);
  });

  it('400 when category is unknown', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'specialty_bakery',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unknown category/);
    assert.ok(Array.isArray(body.categories));
  });

  it('400 on malformed expiration_date (not YYYY-MM-DD)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 38,
      expiration_date: '05/15/2026',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on non-numeric reading_f', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 'cold',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on over-long corrective_action', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 38,
      corrective_action: 'x'.repeat(600),
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ── POST — 422 (needs corrective note) ───────────────────────────

describe('POST /api/receiving — 422 without corrective_action', () => {
  it('refrigerated @ 43°F without note → 422; no row, no audit', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 43,
      package_ok: true,
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    // Drift-band path keeps the legacy `needs_corrective_action: true`
    // contract — this is the "add a fix note to accept" case.
    assert.strictEqual(body.needs_corrective_action, true);
    // Drift-band path must NOT carry the rejection-note flag — those
    // are wire-distinct codes (see needs_rejection_note tests below).
    assert.notStrictEqual(body.needs_rejection_note, true);
    assert.strictEqual(body.status, 'accept_with_note');
    assert.match(body.citation, /§/);
    assert.strictEqual(countReceiving(), 0);
    assert.strictEqual(countAudit('receiving_log'), 0);
  });

  it('refrigerated @ 43°F WITH a note is accepted_with_note (saved + audited)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 43,
      package_ok: true,
      corrective_action: 'moved to reach-in, re-checked at 39°F',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countAudit('receiving_log'), 1);
    const row = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(row.status, 'accepted_with_note');
    assert.match(row.rejection_reason, /reach-in/);
  });

  it('refrigerated @ 50°F without note → 422 (rejected, not acceptable without a note)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 50,
      package_ok: true,
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.status, 'rejected');
    // Rejection-without-note must surface `needs_rejection_note: true`
    // — the semantic is "document why you refused this delivery", not
    // "add a fix note to accept it". Wire-distinct from drift-band.
    assert.strictEqual(body.needs_rejection_note, true);
    assert.notStrictEqual(body.needs_corrective_action, true);
    assert.match(body.citation, /§/);
    assert.strictEqual(countReceiving(), 0);
    assert.strictEqual(countAudit('receiving_log'), 0);
  });

  it('refrigerated @ 50°F WITH a rejection reason is saved as rejected (+ audit)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 50,
      package_ok: true,
      corrective_action: 'driver confirmed reefer alarm; full invoice credit',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(row.status, 'rejected');
    assert.strictEqual(countAudit('receiving_log'), 1);
  });

  it('package_ok=false without a note → 422; with a note → rejected', async () => {
    const resA = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 38,
      package_ok: false,
    }));
    assert.strictEqual(resA.status, 422);
    const bodyA = await resA.json();
    // Package integrity rejection is a refusal, not a drift fix —
    // surfaces needs_rejection_note, NOT needs_corrective_action.
    assert.strictEqual(bodyA.status, 'rejected');
    assert.strictEqual(bodyA.needs_rejection_note, true);
    assert.notStrictEqual(bodyA.needs_corrective_action, true);
    assert.strictEqual(countReceiving(), 0);

    const resB = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 38,
      package_ok: false,
      corrective_action: 'pallet leak, vendor callback SHAMROCK-CB-771',
    }));
    assert.strictEqual(resB.status, 200);
    const row = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(row.status, 'rejected');
    assert.strictEqual(row.package_ok, 0);
  });
});

// ── POST — audit trail ───────────────────────────────────────────

describe('POST /api/receiving — audit rows', () => {
  it('one audit row per accepted delivery', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 38,
      cook_id: 'alice',
    }));
    assert.strictEqual(countAudit('receiving_log'), 1);
    const audit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=?')
      .get('receiving_log');
    assert.strictEqual(audit.entity, 'receiving_log');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
    assert.strictEqual(audit.actor_source, 'cook_ui');
    assert.strictEqual(audit.note, null); // ok status → null note
    assert.ok(audit.payload_json);
  });

  it('audit note carries "<status>:<category>" for non-ok decisions', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 43,
      package_ok: true,
      corrective_action: 'moved to reach-in',
    }));
    const audit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=?')
      .get('receiving_log');
    assert.strictEqual(audit.note, 'accept_with_note:refrigerated');
  });

  it('no audit row is written when POST is rejected', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 43,
      package_ok: true,
    }));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(countAudit('receiving_log'), 0);
  });
});

// ── GET — summary + vendor grouping ──────────────────────────────

describe('GET /api/receiving', () => {
  it('empty day returns a full gray summary', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.summary));
    assert.ok(body.summary.length >= 6);
    for (const s of body.summary) {
      assert.strictEqual(s.status, 'gray');
    }
    assert.strictEqual(body.totals.accepted, 0);
    assert.strictEqual(body.totals.rejected, 0);
    assert.strictEqual(body.totals.accepted_with_note, 0);
  });

  it('groups entries by vendor with per-vendor counts', async () => {
    await POST(postReq({ vendor: 'Shamrock', category: 'refrigerated', reading_f: 38 }));
    await POST(postReq({ vendor: 'Shamrock', category: 'frozen', reading_f: -10 }));
    await POST(postReq({ vendor: 'Sysco', category: 'dry_goods', item: 'canned tomatoes' }));
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.vendors.length, 2);
    const shamrock = body.vendors.find((v) => v.vendor === 'Shamrock');
    const sysco = body.vendors.find((v) => v.vendor === 'Sysco');
    assert.strictEqual(shamrock.entries.length, 2);
    assert.strictEqual(shamrock.counts.accepted, 2);
    assert.strictEqual(sysco.entries.length, 1);
  });

  it('summary turns a category yellow after an accept-with-note write', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 43,
      package_ok: true,
      corrective_action: 'pulled down in reach-in',
    }));
    const res = await GET(getReq());
    const body = await res.json();
    const t = body.summary.find((x) => x.category === 'refrigerated');
    assert.strictEqual(t.status, 'yellow');
    assert.strictEqual(t.accepted_with_note, 1);
  });

  it('summary turns a category red after a rejected write', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      reading_f: 50,
      package_ok: true,
      corrective_action: 'full credit issued',
    }));
    const res = await GET(getReq());
    const body = await res.json();
    const t = body.summary.find((x) => x.category === 'refrigerated');
    assert.strictEqual(t.status, 'red');
    assert.strictEqual(t.rejected, 1);
  });

  it('?summary=0 drops the summary payload but keeps entries + vendors', async () => {
    await POST(postReq({ vendor: 'Shamrock', category: 'refrigerated', reading_f: 38 }));
    const res = await GET(getReq('?summary=0'));
    const body = await res.json();
    assert.strictEqual(body.summary, null);
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.vendors.length, 1);
  });

  it('honors location_id filter', async () => {
    await POST(postReq({ vendor: 'Shamrock', category: 'refrigerated', reading_f: 38, location_id: 'downtown' }));
    await POST(postReq({ vendor: 'Shamrock', category: 'refrigerated', reading_f: 38 }));
    const res = await GET(getReq('?location=downtown'));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].location_id, 'downtown');
  });
});

// ── POST — closed-loop inventory receiving ───────────────────────
//
// Phase 3 closed-loop receiving: an accepted delivery with received_qty
// + received_unit credits inventory in the same transaction as the
// receiving_log INSERT. Rejected deliveries don't credit; missing
// qty/unit gracefully skips the credit; transactional rollback
// guarantees we never leave a delivery row without its companion
// inventory row when the credit was due.

describe('POST /api/receiving — closed-loop inventory crediting', () => {
  it('exact vendor+SKU match credits inventory with a stable master_id', async () => {
    seedMaster('mst_chicken_breast', 'Chicken breast');
    seedVendorPrice({ master_id: 'mst_chicken_breast' });

    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'CHK-40',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      received_qty: 40,
      received_unit: 'lb',
      cook_id: 'alice',
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 1);

    const recvRow = testDb
      .prepare('SELECT vendor_sku, master_id, match_status, match_reason FROM receiving_log')
      .get();
    assert.deepStrictEqual(recvRow, {
      vendor_sku: 'CHK-40',
      master_id: 'mst_chicken_breast',
      match_status: 'matched',
      match_reason: 'exact_vendor_sku',
    });

    const invRow = testDb
      .prepare('SELECT item, delta, direction, master_id FROM inventory_updates')
      .get();
    assert.deepStrictEqual(invRow, {
      item: 'chicken breast 40lb CS',
      delta: '40 lb',
      direction: 'in',
      master_id: 'mst_chicken_breast',
    });
  });

  it('exact vendor+item fallback credits inventory when SKU is blank', async () => {
    seedMaster('mst_tomatoes', 'Canned tomatoes');
    seedVendorPrice({
      master_id: 'mst_tomatoes',
      ingredient: 'canned tomatoes #10',
      vendor: 'Sysco',
      sku: 'TOM-10',
    });

    const res = await POST(postReq({
      vendor: 'Sysco',
      category: 'dry_goods',
      item: ' canned   tomatoes #10 ',
      received_qty: 3,
      received_unit: 'case',
    }));

    assert.strictEqual(res.status, 200);
    const recvRow = testDb
      .prepare('SELECT master_id, match_status, match_reason FROM receiving_log')
      .get();
    assert.deepStrictEqual(recvRow, {
      master_id: 'mst_tomatoes',
      match_status: 'matched',
      match_reason: 'exact_vendor_item',
    });
    const invRow = testDb.prepare('SELECT master_id FROM inventory_updates').get();
    assert.strictEqual(invRow.master_id, 'mst_tomatoes');
  });

  it('unmatched accepted delivery queues the receiving row and does not credit inventory', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'NO-MATCH',
      category: 'refrigerated',
      item: 'mystery case',
      reading_f: 38,
      package_ok: true,
      received_qty: 2,
      received_unit: 'case',
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 0);
    const recvRow = testDb
      .prepare('SELECT master_id, match_status, match_reason FROM receiving_log')
      .get();
    assert.deepStrictEqual(recvRow, {
      master_id: null,
      match_status: 'unmatched',
      match_reason: 'no_vendor_price_match',
    });
  });

  it('ambiguous vendor+SKU match queues the receiving row and does not credit inventory', async () => {
    seedMaster('mst_a', 'A');
    seedMaster('mst_b', 'B');
    seedVendorPrice({ master_id: 'mst_a', ingredient: 'case a', sku: 'DUP-1' });
    seedVendorPrice({ master_id: 'mst_b', ingredient: 'case b', sku: 'DUP-1' });

    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'DUP-1',
      category: 'refrigerated',
      item: 'duplicate sku case',
      reading_f: 38,
      package_ok: true,
      received_qty: 1,
      received_unit: 'case',
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(countInventoryUpdates(), 0);
    const recvRow = testDb
      .prepare('SELECT master_id, match_status, match_reason FROM receiving_log')
      .get();
    assert.deepStrictEqual(recvRow, {
      master_id: null,
      match_status: 'ambiguous',
      match_reason: 'multiple_vendor_sku_matches',
    });
  });

  it('happy path: accepted + qty + unit writes BOTH rows + 2 audits', async () => {
    seedMaster('mst_chicken_breast', 'Chicken breast');
    seedVendorPrice({ master_id: 'mst_chicken_breast' });

    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'CHK-40',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      received_qty: 40,
      received_unit: 'lb',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);

    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 1);
    assert.strictEqual(countAudit('receiving_log'), 1);
    assert.strictEqual(countAudit('inventory_updates'), 1);

    const recvRow = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(recvRow.received_qty, 40);
    assert.strictEqual(recvRow.received_unit, 'lb');

    const invRow = testDb.prepare('SELECT * FROM inventory_updates').get();
    assert.strictEqual(invRow.item, 'chicken breast 40lb CS');
    assert.strictEqual(invRow.master_id, 'mst_chicken_breast');
    assert.strictEqual(invRow.delta, '40 lb');
    assert.strictEqual(invRow.direction, 'in');
    assert.strictEqual(invRow.cook_id, 'alice');
    assert.match(invRow.note, /closed-loop receiving from receiving_log #\d+/);
    assert.strictEqual(invRow.receiving_log_id, recvRow.id);

    const invAudit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=?')
      .get('inventory_updates');
    assert.strictEqual(invAudit.action, 'insert');
    assert.strictEqual(invAudit.actor_source, 'receiving_closed_loop');
    assert.strictEqual(invAudit.actor_cook_id, 'alice');
    assert.match(invAudit.note, /receiving_log:\d+/);
    assert.ok(invAudit.payload_json);
  });

  it('accepted_with_note + qty + unit also credits inventory', async () => {
    seedMaster('mst_milk', 'Milk');
    seedVendorPrice({
      master_id: 'mst_milk',
      ingredient: 'milk 2% gal',
      sku: 'MILK-2',
    });

    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'MILK-2',
      category: 'refrigerated',
      item: 'milk 2% gal',
      reading_f: 43,
      package_ok: true,
      corrective_action: 'pulled down in reach-in, verified 39°F 20min later',
      received_qty: 6,
      received_unit: 'gal',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 1);
    const invRow = testDb.prepare('SELECT * FROM inventory_updates').get();
    assert.strictEqual(invRow.master_id, 'mst_milk');
    assert.strictEqual(invRow.delta, '6 gal');
  });

  it('rejected delivery with qty + unit does NOT credit inventory', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'milk 2%',
      reading_f: 50,
      package_ok: true,
      corrective_action: 'reefer alarm — full credit issued',
      received_qty: 6,
      received_unit: 'gal',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    const recvRow = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(recvRow.status, 'rejected');
    // Even though qty+unit were captured, rejected goods don't move on-hand.
    assert.strictEqual(countInventoryUpdates(), 0);
    assert.strictEqual(countAudit('inventory_updates'), 0);
    // The receiving_log audit row is still emitted as usual.
    assert.strictEqual(countAudit('receiving_log'), 1);
  });

  it('accepted without qty/unit: graceful skip — receiving lands, no inventory write', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      // no received_qty, no received_unit
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 0);
    assert.strictEqual(countAudit('inventory_updates'), 0);
  });

  it('accepted with qty but no unit: 400 (both required when one is provided)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'chicken breast',
      reading_f: 38,
      package_ok: true,
      received_qty: 40,
      // received_unit deliberately missing
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReceiving(), 0);
    assert.strictEqual(countInventoryUpdates(), 0);
  });

  it('accepted with item missing: graceful skip (no item key to debit later)', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'dry_goods',
      // item omitted — closed loop has no debit target
      received_qty: 10,
      received_unit: 'case',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countReceiving(), 1);
    assert.strictEqual(countInventoryUpdates(), 0);
  });

  it('validator rejects negative qty as 400', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'chicken breast',
      reading_f: 38,
      package_ok: true,
      received_qty: -5,
      received_unit: 'lb',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /received_qty/);
    assert.strictEqual(countReceiving(), 0);
    assert.strictEqual(countInventoryUpdates(), 0);
  });

  it('validator rejects zero qty as 400', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'chicken breast',
      reading_f: 38,
      package_ok: true,
      received_qty: 0,
      received_unit: 'lb',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReceiving(), 0);
    assert.strictEqual(countInventoryUpdates(), 0);
  });

  it('transactional rollback: forced inventory_updates failure rolls back receiving + audit', async () => {
    seedMaster('mst_chicken_breast', 'Chicken breast');
    seedVendorPrice({ master_id: 'mst_chicken_breast' });

    // Drop the inventory_updates table mid-test to force the closed-loop
    // INSERT to fail. The route must then roll back the receiving_log
    // INSERT + its audit row — we should see ZERO new rows of any kind.
    testDb.exec('DROP TABLE inventory_updates');
    try {
      const res = await POST(postReq({
        vendor: 'Shamrock',
        vendor_sku: 'CHK-40',
        category: 'refrigerated',
        item: 'chicken breast',
        reading_f: 38,
        package_ok: true,
        received_qty: 40,
        received_unit: 'lb',
      }));
      assert.strictEqual(res.status, 500);
      assert.strictEqual(countReceiving(), 0);
      assert.strictEqual(countAudit('receiving_log'), 0);
      assert.strictEqual(countAudit('inventory_updates'), 0);
    } finally {
      // Re-create the table so afterEach DELETE doesn't blow up and
      // subsequent tests in this run still have a clean fixture.
      testDb.exec(`
        CREATE TABLE IF NOT EXISTS inventory_updates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_date TEXT NOT NULL,
          station_id TEXT,
          item TEXT NOT NULL,
          master_id TEXT,
          delta TEXT,
          direction TEXT,
          note TEXT,
          cook_id TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          location_id TEXT DEFAULT 'default',
          receiving_log_id INTEGER REFERENCES receiving_log(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_updates_receiving_log_id
          ON inventory_updates(receiving_log_id)
          WHERE receiving_log_id IS NOT NULL;
      `);
    }
  });

  it('HACCP rejection priority: a rejected delivery 422s even with a malformed received_qty', async () => {
    // The cook's first concern is "are the goods coming inside or
    // not?". A malformed qty travels with the row but doesn't change
    // the rejection — 400ing on qty would mask the real failure
    // reason, and the cook would fix the qty, retry, and still get
    // 422. Reject (without note) wins; cook records the corrective
    // note and the qty stays whatever they typed.
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'milk 2%',
      reading_f: 38,
      package_ok: false,         // forces HACCP reject per §3-202.15
      received_qty: -5,          // also a malformed closed-loop value
      received_unit: 'gal',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.status, 'rejected');
    assert.match(body.citation, /§3-202\.15/);
    // Rejection priority over malformed qty surfaces a refusal, not a
    // drift fix — needs_rejection_note, not needs_corrective_action.
    assert.strictEqual(body.needs_rejection_note, true);
    assert.notStrictEqual(body.needs_corrective_action, true);
    assert.strictEqual(countReceiving(), 0);
  });

  it('HACCP rejection priority: temp-rejected delivery with bad qty also 422s', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'milk 2%',
      reading_f: 50,             // past drift band → reject
      package_ok: true,
      received_qty: 0,           // also a malformed closed-loop value
      received_unit: 'gal',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.status, 'rejected');
    assert.strictEqual(countReceiving(), 0);
  });

  it('accept_with_note + bad qty still 400s (drift-band path lands a row, so qty must be valid)', async () => {
    // Accept-with-note actually writes to receiving_log AND credits
    // inventory if qty/unit are present, so a malformed qty on this
    // path has to block — it'd otherwise either persist a bad row or
    // silently drop the credit. The 400 keeps that contract intact.
    const res = await POST(postReq({
      vendor: 'Shamrock',
      category: 'refrigerated',
      item: 'milk 2%',
      reading_f: 43,             // drift band → accept_with_note
      package_ok: true,
      corrective_action: 'pulled down in reach-in',
      received_qty: -2,          // malformed
      received_unit: 'gal',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReceiving(), 0);
  });

  it('partial UNIQUE index prevents double-credit on the same receiving_log row', async () => {
    seedMaster('mst_chicken_breast', 'Chicken breast');
    seedVendorPrice({ master_id: 'mst_chicken_breast' });

    // Document the at-most-once invariant. Each /api/receiving POST
    // creates a NEW receiving_log row with a NEW id, so true client
    // double-tap is a UI/network concern (see route.js) — the DB
    // constraint here protects the in-process invariant: ONE inventory
    // credit per source receiving_log row.
    const res = await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'CHK-40',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      received_qty: 40,
      received_unit: 'lb',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countInventoryUpdates(), 1);

    const recvRow = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.throws(
      () => {
        testDb
          .prepare(
            `INSERT INTO inventory_updates
               (shift_date, location_id, item, master_id, delta, direction, note, cook_id, receiving_log_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            recvRow.shift_date,
            recvRow.location_id,
            recvRow.item,
            recvRow.master_id,
            '40 lb',
            'in',
            'duplicate credit attempt',
            null,
            recvRow.id,
          );
      },
      /UNIQUE constraint/,
      'partial unique index must reject a second credit for the same receiving_log_id',
    );

    // The original credit row is the only one — the failed second
    // INSERT did not leak through.
    assert.strictEqual(countInventoryUpdates(), 1);
  });
});

// ── Manager queue — unresolved receiving matches ─────────────────

describe('GET/PATCH /api/receiving/matches — unresolved manager queue', () => {
  it('GET lists accepted qty rows that could not be matched', async () => {
    await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'NO-MATCH',
      category: 'refrigerated',
      item: 'mystery case',
      reading_f: 38,
      package_ok: true,
      received_qty: 2,
      received_unit: 'case',
    }));

    const res = await GET_MATCHES(getMatchesReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.matches[0].vendor_sku, 'NO-MATCH');
    assert.strictEqual(body.matches[0].match_status, 'unmatched');
    assert.strictEqual(body.matches[0].received_qty, 2);
  });

  it('PATCH resolves an unmatched row, writes one inventory credit, and audits both changes', async () => {
    seedMaster('mst_mystery_case', 'Mystery case');
    await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'NO-MATCH',
      category: 'refrigerated',
      item: 'mystery case',
      reading_f: 38,
      package_ok: true,
      received_qty: 2,
      received_unit: 'case',
      cook_id: 'alice',
    }));
    const recvRow = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(countInventoryUpdates(), 0);

    const res = await PATCH_MATCH(
      ...patchMatchReq(recvRow.id, {
        master_id: 'mst_mystery_case',
        cook_id: 'manager-jane',
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.receiving.master_id, 'mst_mystery_case');
    assert.strictEqual(body.receiving.match_status, 'matched');

    const afterRecv = testDb
      .prepare('SELECT master_id, match_status, match_reason FROM receiving_log WHERE id=?')
      .get(recvRow.id);
    assert.deepStrictEqual(afterRecv, {
      master_id: 'mst_mystery_case',
      match_status: 'matched',
      match_reason: 'manager_selected',
    });

    const invRow = testDb.prepare('SELECT * FROM inventory_updates').get();
    assert.strictEqual(invRow.receiving_log_id, recvRow.id);
    assert.strictEqual(invRow.master_id, 'mst_mystery_case');
    assert.strictEqual(invRow.delta, '2 case');
    assert.strictEqual(invRow.direction, 'in');

    const correctionAudit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='receiving_log' AND action='correction'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(correctionAudit, 'manager match resolution must audit receiving_log correction');
    assert.strictEqual(correctionAudit.actor_cook_id, 'manager-jane');
    assert.strictEqual(countAudit('inventory_updates'), 1);
  });

  it('PATCH refuses to credit the same receiving row twice', async () => {
    seedMaster('mst_mystery_case', 'Mystery case');
    await POST(postReq({
      vendor: 'Shamrock',
      vendor_sku: 'NO-MATCH',
      category: 'refrigerated',
      item: 'mystery case',
      reading_f: 38,
      package_ok: true,
      received_qty: 2,
      received_unit: 'case',
    }));
    const recvRow = testDb.prepare('SELECT * FROM receiving_log').get();
    const first = await PATCH_MATCH(
      ...patchMatchReq(recvRow.id, { master_id: 'mst_mystery_case' }),
    );
    assert.strictEqual(first.status, 200);
    const second = await PATCH_MATCH(
      ...patchMatchReq(recvRow.id, { master_id: 'mst_mystery_case' }),
    );
    assert.strictEqual(second.status, 409);
    assert.strictEqual(countInventoryUpdates(), 1);
  });
});
