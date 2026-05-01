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

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM receiving_log; DELETE FROM inventory_updates; DELETE FROM audit_events;');
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
      expiration_date: '2026-05-15',
    }));
    const row = testDb.prepare('SELECT * FROM receiving_log').get();
    assert.strictEqual(row.invoice_ref, 'INV-2002');
    assert.strictEqual(row.expiration_date, '2026-05-15');
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
    assert.strictEqual(body.needs_corrective_action, true);
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
    assert.strictEqual(countReceiving(), 0);
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
  it('happy path: accepted + qty + unit writes BOTH rows + 2 audits', async () => {
    const res = await POST(postReq({
      vendor: 'Shamrock',
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
    assert.strictEqual(invRow.delta, '40 lb');
    assert.strictEqual(invRow.direction, 'in');
    assert.strictEqual(invRow.cook_id, 'alice');
    assert.match(invRow.note, /closed-loop receiving from receiving_log #\d+/);

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
    const res = await POST(postReq({
      vendor: 'Shamrock',
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
    // Drop the inventory_updates table mid-test to force the closed-loop
    // INSERT to fail. The route must then roll back the receiving_log
    // INSERT + its audit row — we should see ZERO new rows of any kind.
    testDb.exec('DROP TABLE inventory_updates');
    try {
      const res = await POST(postReq({
        vendor: 'Shamrock',
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
          delta TEXT,
          direction TEXT,
          note TEXT,
          cook_id TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          location_id TEXT DEFAULT 'default'
        );
      `);
    }
  });
});
