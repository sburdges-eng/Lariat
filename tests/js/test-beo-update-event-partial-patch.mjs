#!/usr/bin/env node
// Regression test for T3: POST /api/beo action='update_event' partial patch.
//
// The UI today sends a full snapshot of the event row, which masked a bug
// in the handler: every non-key column was written unconditionally, so any
// future caller that sent a partial patch (e.g. only event_time, or only
// tax_rate) would NULL out every other column on the row.
//
// Fix uses `col = COALESCE(?, col)` per non-key column. The handler must
// also pass `payload.col ?? null` for omitted fields so that COALESCE sees
// a real SQL NULL and falls back to the existing column.
//
// Title and status stay unconditional — those are the keys the UI explicitly
// edits. They already used COALESCE before this fix.
//
// Run: node --experimental-strip-types --test \
//        tests/js/test-beo-update-event-partial-patch.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-beo-update-patch-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
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

async function seedEvent(overrides = {}) {
  const res = await POST(postReq({
    action: 'event',
    title: 'Wallace anniversary',
    event_date: '2026-07-04',
    event_time: '6-9pm',
    contact_name: 'Marie Wallace',
    guest_count: 32,
    notes: 'two vegetarians, one tree-nut allergy',
    tax_rate: 0.08,
    service_fee_pct: 22,
    ...overrides,
  }));
  const { id } = await res.json();
  return id;
}

describe("POST /api/beo action='update_event' — partial patch preserves omitted columns", () => {
  it('patching only event_time leaves all other columns intact', async () => {
    const id = await seedEvent();

    const before = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);

    // Partial patch: only event_time supplied. Everything else must
    // be preserved by COALESCE on the column side and `?? null` on
    // the JS side.
    const res = await POST(postReq({
      action: 'update_event',
      id,
      event_time: '7-10pm',
    }));
    assert.strictEqual(res.status, 200);

    const after = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);

    // The patched field changed.
    assert.strictEqual(after.event_time, '7-10pm');

    // Every other column survives.
    assert.strictEqual(after.title, before.title);
    assert.strictEqual(after.event_date, before.event_date);
    assert.strictEqual(after.contact_name, before.contact_name);
    assert.strictEqual(after.guest_count, before.guest_count);
    assert.strictEqual(after.notes, before.notes);
    assert.strictEqual(after.status, before.status);
    assert.strictEqual(after.tax_rate, before.tax_rate);
    assert.strictEqual(after.service_fee_pct, before.service_fee_pct);
  });

  it('patching only tax_rate leaves contact / time / notes / fee intact', async () => {
    const id = await seedEvent();
    const before = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);

    const res = await POST(postReq({
      action: 'update_event',
      id,
      tax_rate: 0.095,
    }));
    assert.strictEqual(res.status, 200);

    const after = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);
    assert.strictEqual(after.tax_rate, 0.095);
    assert.strictEqual(after.event_time, before.event_time);
    assert.strictEqual(after.contact_name, before.contact_name);
    assert.strictEqual(after.notes, before.notes);
    assert.strictEqual(after.service_fee_pct, before.service_fee_pct);
    assert.strictEqual(after.guest_count, before.guest_count);
  });

  it('patching only contact_name leaves the numeric / time columns intact', async () => {
    const id = await seedEvent();
    const before = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);

    const res = await POST(postReq({
      action: 'update_event',
      id,
      contact_name: 'Marie Wallace-Hodge',
    }));
    assert.strictEqual(res.status, 200);

    const after = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(id);
    assert.strictEqual(after.contact_name, 'Marie Wallace-Hodge');
    assert.strictEqual(after.event_time, before.event_time);
    assert.strictEqual(after.event_date, before.event_date);
    assert.strictEqual(after.guest_count, before.guest_count);
    assert.strictEqual(after.notes, before.notes);
    assert.strictEqual(after.tax_rate, before.tax_rate);
    assert.strictEqual(after.service_fee_pct, before.service_fee_pct);
  });
});
