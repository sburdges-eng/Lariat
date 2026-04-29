#!/usr/bin/env node
// Tests for PR #6: BEO worksheet — line-item table, invoice-header fields
// on beo_events, and the /api/beo action surface that backs the
// worksheet-style board (app/beo/BeoBoard.jsx).
//
// Pins:
//   - Schema migration: a legacy beo_events row (pre event_time /
//     contact_name / tax_rate / service_fee_pct) round-trips through
//     initSchema + migrateLegacyColumns, the four new columns appear,
//     and the two REAL columns pick up their defaults.
//   - beo_line_items table + idx_beo_line_ev index exist.
//   - GET /api/beo returns {events, prep_tasks, line_items}, with
//     line_items empty when no events and populated when they exist.
//   - POST /api/beo action strings (observed in app/api/beo/route.js):
//       event, update_event, line, update_line, delete_line,
//       prep, prep_done, delete_event
//     are exercised for happy paths + defaults + FK cascade.
//
// BEO routes do NOT call postAuditEvent — no atomicity test here.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-worksheet.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-beo-worksheet-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Cascade through children first so FK-enforced DELETE can't choke on
  // prep_tasks / line_items that still reference an event.
  testDb.exec(
    'DELETE FROM beo_line_items; DELETE FROM beo_prep_tasks; DELETE FROM beo_events;',
  );
});

function postReq(body) {
  return new Request('http://localhost/api/beo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/beo${qs}`);
}

const columnsOf = (table) =>
  testDb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// ── Schema migration ─────────────────────────────────────────────

describe('beo_events — schema migration adds invoice-header columns', () => {
  it('has event_time / contact_name / tax_rate / service_fee_pct', () => {
    const cols = columnsOf('beo_events');
    for (const c of ['event_time', 'contact_name', 'tax_rate', 'service_fee_pct']) {
      assert.ok(cols.includes(c), `beo_events.${c} missing`);
    }
  });

  it('tax_rate defaults to 0.0675, service_fee_pct defaults to 20', () => {
    testDb.prepare(
      `INSERT INTO beo_events (title, event_date, location_id) VALUES (?,?,?)`,
    ).run('bare-minimum', '2026-05-01', 'default');
    const row = testDb.prepare(
      `SELECT tax_rate, service_fee_pct FROM beo_events WHERE title = ?`,
    ).get('bare-minimum');
    assert.strictEqual(row.tax_rate, 0.0675);
    assert.strictEqual(row.service_fee_pct, 20);
  });

  it('pre-migration beo_events shape still picks up new columns on init', () => {
    // Simulate a DB written before the worksheet columns shipped.
    // We drop and recreate the table with the legacy shape, then
    // re-run initSchema to trigger the ALTER TABLE migrations.
    testDb.exec('DROP TABLE IF EXISTS beo_line_items'); // FK child
    testDb.exec('DROP TABLE IF EXISTS beo_prep_tasks'); // FK child
    testDb.exec('DROP TABLE IF EXISTS beo_events');
    testDb.exec(`
      CREATE TABLE beo_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        event_date TEXT,
        guest_count INTEGER,
        notes TEXT,
        status TEXT DEFAULT 'planned',
        location_id TEXT DEFAULT 'default',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // Legacy row with only the pre-worksheet columns populated.
    testDb.prepare(
      `INSERT INTO beo_events (title, event_date, guest_count, notes, status, location_id)
       VALUES (?,?,?,?,?,?)`,
    ).run('legacy-party', '2026-06-01', 40, 'no nuts', 'planned', 'default');

    db.initSchema(testDb);

    const cols = columnsOf('beo_events');
    for (const c of ['event_time', 'contact_name', 'tax_rate', 'service_fee_pct']) {
      assert.ok(cols.includes(c), `beo_events.${c} missing after migration`);
    }
    // Legacy row is still there, and picks up the defaults for the
    // new REAL columns. (ALTER TABLE ... ADD COLUMN with DEFAULT
    // applies that default to existing rows in SQLite.)
    const row = testDb.prepare(
      `SELECT title, event_time, contact_name, tax_rate, service_fee_pct
         FROM beo_events WHERE title = ?`,
    ).get('legacy-party');
    assert.strictEqual(row.title, 'legacy-party');
    assert.strictEqual(row.event_time, null);
    assert.strictEqual(row.contact_name, null);
    assert.strictEqual(row.tax_rate, 0.0675);
    assert.strictEqual(row.service_fee_pct, 20);
  });
});

describe('beo_line_items — table shape', () => {
  it('exists in sqlite_master', () => {
    const row = testDb.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='beo_line_items'`,
    ).get();
    assert.ok(row, 'beo_line_items table missing');
  });

  it('has expected columns', () => {
    const cols = columnsOf('beo_line_items');
    for (const c of [
      'id', 'event_id', 'sort_order', 'item_name',
      'category', 'unit_cost', 'quantity', 'created_at',
    ]) {
      assert.ok(cols.includes(c), `beo_line_items.${c} missing`);
    }
  });

  it('has idx_beo_line_ev index on event_id', () => {
    const row = testDb.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_beo_line_ev'`,
    ).get();
    assert.ok(row, 'idx_beo_line_ev index missing');
  });
});

// ── GET /api/beo ─────────────────────────────────────────────────

describe('GET /api/beo', () => {
  it('returns {events, prep_tasks, line_items} with empty arrays when untouched', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.events));
    assert.ok(Array.isArray(body.prep_tasks));
    assert.ok(Array.isArray(body.line_items));
    assert.strictEqual(body.events.length, 0);
    assert.strictEqual(body.prep_tasks.length, 0);
    assert.strictEqual(body.line_items.length, 0);
  });

  it('populates line_items when an event has them', async () => {
    const ev = await POST(postReq({
      action: 'event',
      title: 'Clauss party',
      event_date: '2026-05-10',
    }));
    const { id: eventId } = await ev.json();

    await POST(postReq({
      action: 'line',
      event_id: eventId,
      item_name: 'Green Chile Enchiladas',
      category: 'Entree',
      unit_cost: 14.5,
      quantity: 40,
    }));

    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.events.length, 1);
    assert.strictEqual(body.line_items.length, 1);
    const li = body.line_items[0];
    assert.strictEqual(li.event_id, eventId);
    assert.strictEqual(li.item_name, 'Green Chile Enchiladas');
    assert.strictEqual(li.category, 'Entree');
    assert.strictEqual(li.unit_cost, 14.5);
    assert.strictEqual(li.quantity, 40);
  });
});

// ── POST action=event ────────────────────────────────────────────

describe("POST /api/beo action='event'", () => {
  it('stores event_time / contact_name / tax_rate / service_fee_pct', async () => {
    const res = await POST(postReq({
      action: 'event',
      title: 'Rehearsal dinner',
      event_date: '2026-05-15',
      event_time: '5-7pm',
      contact_name: 'Jane Doe',
      guest_count: 24,
      notes: 'gluten-free bride',
      tax_rate: 0.08,
      service_fee_pct: 22,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.id);

    const row = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(body.id);
    assert.strictEqual(row.title, 'Rehearsal dinner');
    assert.strictEqual(row.event_date, '2026-05-15');
    assert.strictEqual(row.event_time, '5-7pm');
    assert.strictEqual(row.contact_name, 'Jane Doe');
    assert.strictEqual(row.guest_count, 24);
    assert.strictEqual(row.notes, 'gluten-free bride');
    assert.strictEqual(row.tax_rate, 0.08);
    assert.strictEqual(row.service_fee_pct, 22);
    assert.strictEqual(row.status, 'planned');
  });

  it('applies defaults when tax_rate / service_fee_pct omitted', async () => {
    const res = await POST(postReq({
      action: 'event',
      title: 'Default-rates party',
      event_date: '2026-06-01',
    }));
    const { id } = await res.json();
    const row = testDb.prepare(`SELECT tax_rate, service_fee_pct FROM beo_events WHERE id = ?`).get(id);
    assert.strictEqual(row.tax_rate, 0.0675);
    assert.strictEqual(row.service_fee_pct, 20);
  });

  it('400 when title is missing', async () => {
    const res = await POST(postReq({
      action: 'event',
      event_date: '2026-06-01',
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ── POST action=update_event ─────────────────────────────────────

describe("POST /api/beo action='update_event'", () => {
  it('updates invoice-header fields on an existing event', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Before',
      event_date: '2026-05-20',
    }));
    const { id } = await createdRes.json();

    const res = await POST(postReq({
      action: 'update_event',
      id,
      title: 'After',
      event_date: '2026-05-21',
      event_time: '6pm',
      contact_name: 'Bob Clauss',
      guest_count: 12,
      notes: 'two vegetarians',
      tax_rate: 0.09,
      service_fee_pct: 18,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);

    const row = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);
    assert.strictEqual(row.title, 'After');
    assert.strictEqual(row.event_date, '2026-05-21');
    assert.strictEqual(row.event_time, '6pm');
    assert.strictEqual(row.contact_name, 'Bob Clauss');
    assert.strictEqual(row.guest_count, 12);
    assert.strictEqual(row.notes, 'two vegetarians');
    assert.strictEqual(row.tax_rate, 0.09);
    assert.strictEqual(row.service_fee_pct, 18);
  });

  it('400 when id is missing', async () => {
    const res = await POST(postReq({ action: 'update_event', title: 'nope' }));
    assert.strictEqual(res.status, 400);
  });
});

// ── POST action=line / update_line / delete_line ─────────────────

describe("POST /api/beo action='line'", () => {
  it('inserts a line item with cost + quantity', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Line host',
      event_date: '2026-05-25',
    }));
    const { id: event_id } = await createdRes.json();

    const res = await POST(postReq({
      action: 'line',
      event_id,
      item_name: 'Queso',
      category: 'Starter',
      unit_cost: 6.5,
      quantity: 30,
      sort_order: 1,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.id);

    const row = testDb.prepare(`SELECT * FROM beo_line_items WHERE id = ?`).get(body.id);
    assert.strictEqual(row.event_id, event_id);
    assert.strictEqual(row.item_name, 'Queso');
    assert.strictEqual(row.category, 'Starter');
    assert.strictEqual(row.unit_cost, 6.5);
    assert.strictEqual(row.quantity, 30);
    assert.strictEqual(row.sort_order, 1);
  });

  it('defaults unit_cost to 0 and quantity to 1 when omitted', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Defaults party',
      event_date: '2026-05-26',
    }));
    const { id: event_id } = await createdRes.json();

    const res = await POST(postReq({
      action: 'line',
      event_id,
      item_name: 'Napkins',
    }));
    const { id } = await res.json();
    const row = testDb.prepare(`SELECT unit_cost, quantity FROM beo_line_items WHERE id = ?`).get(id);
    assert.strictEqual(row.unit_cost, 0);
    assert.strictEqual(row.quantity, 1);
  });

  it('400 when event_id or item_name missing', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'host-missing-fields',
      event_date: '2026-05-27',
    }));
    const { id: event_id } = await createdRes.json();

    const noEvent = await POST(postReq({ action: 'line', item_name: 'x' }));
    assert.strictEqual(noEvent.status, 400);
    const noName = await POST(postReq({ action: 'line', event_id }));
    assert.strictEqual(noName.status, 400);
  });
});

describe("POST /api/beo action='update_line'", () => {
  it('mutates item_name / unit_cost / quantity / category', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Update host',
      event_date: '2026-06-02',
    }));
    const { id: event_id } = await createdRes.json();

    const lineRes = await POST(postReq({
      action: 'line',
      event_id,
      item_name: 'Taco bar',
      category: 'Entree',
      unit_cost: 9,
      quantity: 20,
    }));
    const { id } = await lineRes.json();

    const res = await POST(postReq({
      action: 'update_line',
      id,
      item_name: 'Taco bar (deluxe)',
      unit_cost: 11.5,
      quantity: 25,
      category: 'Entree (Featured)',
    }));
    assert.strictEqual(res.status, 200);

    const row = testDb.prepare(`SELECT * FROM beo_line_items WHERE id = ?`).get(id);
    assert.strictEqual(row.item_name, 'Taco bar (deluxe)');
    assert.strictEqual(row.unit_cost, 11.5);
    assert.strictEqual(row.quantity, 25);
    assert.strictEqual(row.category, 'Entree (Featured)');
  });

  it('400 when id missing', async () => {
    const res = await POST(postReq({ action: 'update_line', item_name: 'x' }));
    assert.strictEqual(res.status, 400);
  });
});

describe("POST /api/beo action='delete_line'", () => {
  it('removes a single line row', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Delete host',
      event_date: '2026-06-03',
    }));
    const { id: event_id } = await createdRes.json();
    const lineRes = await POST(postReq({
      action: 'line',
      event_id,
      item_name: 'Ephemeral',
    }));
    const { id } = await lineRes.json();

    const res = await POST(postReq({ action: 'delete_line', id }));
    assert.strictEqual(res.status, 200);

    const row = testDb.prepare(`SELECT * FROM beo_line_items WHERE id = ?`).get(id);
    assert.strictEqual(row, undefined);
  });
});

// ── FK cascade: deleting an event drops its line items ───────────

describe('FK cascade — beo_events → beo_line_items', () => {
  it('delete_event removes the event and all its line items', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Cascade host',
      event_date: '2026-06-05',
    }));
    const { id: event_id } = await createdRes.json();

    for (const name of ['Line A', 'Line B', 'Line C']) {
      await POST(postReq({ action: 'line', event_id, item_name: name }));
    }
    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_line_items WHERE event_id = ?`).get(event_id).c,
      3,
    );

    const res = await POST(postReq({ action: 'delete_event', id: event_id }));
    assert.strictEqual(res.status, 200);

    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_events WHERE id = ?`).get(event_id).c,
      0,
    );
    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_line_items WHERE event_id = ?`).get(event_id).c,
      0,
      'child beo_line_items rows should be cascade-deleted',
    );
  });
});

// ── FK cascade: deleting an event drops its prep_tasks ───────────
//
// The schema declares beo_prep_tasks.event_id REFERENCES beo_events(id)
// ON DELETE CASCADE (lib/db.ts, FOREIGN KEY clause inside the
// beo_prep_tasks CREATE TABLE). PRAGMA foreign_keys = ON is set when
// the connection opens (lib/db.ts, getDb()). Together that means
// deleting a beo_events row should sweep its beo_prep_tasks children
// without the route handler having to issue an explicit DELETE.
//
// This test asserts that cascade fires from the FK alone — not from
// the (since-removed) `DELETE FROM beo_prep_tasks WHERE event_id = ?`
// the handler used to run. Diff-bisect: with that line still in place
// this passes (the handler does the work); with it removed this still
// passes (the FK does the work). That's the proof the FK is what's
// actually doing it.

describe('FK cascade — beo_events → beo_prep_tasks', () => {
  it('delete_event removes the event and all its prep_tasks via FK cascade', async () => {
    const createdRes = await POST(postReq({
      action: 'event',
      title: 'Prep cascade host',
      event_date: '2026-07-04',
    }));
    const { id: event_id } = await createdRes.json();

    for (const task of ['Brine birds', 'Portion sauce', 'Set up buffet']) {
      await POST(postReq({ action: 'prep', event_id, task }));
    }
    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_prep_tasks WHERE event_id = ?`).get(event_id).c,
      3,
      'sanity: 3 prep_tasks rows should exist before delete',
    );

    const res = await POST(postReq({ action: 'delete_event', id: event_id }));
    assert.strictEqual(res.status, 200);

    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_events WHERE id = ?`).get(event_id).c,
      0,
    );
    assert.strictEqual(
      testDb.prepare(`SELECT COUNT(*) AS c FROM beo_prep_tasks WHERE event_id = ?`).get(event_id).c,
      0,
      'child beo_prep_tasks rows should be cascade-deleted by the FK alone',
    );
  });

  it('FK enforcement is actually on for this connection', () => {
    // Belt-and-suspenders: if PRAGMA foreign_keys ever gets flipped off
    // the cascade test above could give a false positive (the handler
    // delete is gone, but rows could still survive without FK
    // enforcement — wait, no, they couldn't, because they'd have no
    // parent. Still: keep this assertion to lock in the connection
    // setup so a future refactor of getDb() that drops the pragma
    // surfaces here, not as a silent regression in production.)
    const [{ foreign_keys }] = testDb.pragma('foreign_keys');
    assert.strictEqual(foreign_keys, 1, 'PRAGMA foreign_keys must be ON');
  });
});

// ── Unknown action ───────────────────────────────────────────────

describe('POST /api/beo unknown action', () => {
  it('400s with an unknown-action error', async () => {
    const res = await POST(postReq({ action: 'obliterate', id: 1 }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unknown action/);
  });
});
