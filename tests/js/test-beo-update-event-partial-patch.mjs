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

register(new URL('./resolver.mjs', import.meta.url));

const {
  createTempBeoDb,
  clearBeoTables,
  postReq,
  seedEvent,
} = await import('./helpers/beo-fixtures.mjs');

const { testDb, cleanup } = await createTempBeoDb('update-patch');
const route = await import('../../app/api/beo/route.js');

const { POST } = route;

after(cleanup);

beforeEach(() => {
  clearBeoTables(testDb);
});

describe("POST /api/beo action='update_event' — partial patch preserves omitted columns", () => {
  it('patching only event_time leaves all other columns intact', async () => {
    const id = await seedEvent(POST);

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
    const id = await seedEvent(POST);
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
    const id = await seedEvent(POST);
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

describe('POST /api/beo — min_spend (Increment 2)', () => {
  it('create (action=event) persists a numeric min_spend', async () => {
    const res = await POST(postReq({ action: 'event', title: 'Gala Dinner', min_spend: 2500 }));
    assert.strictEqual(res.status, 200);
    const { id } = await res.json();
    const row = testDb.prepare('SELECT min_spend FROM beo_events WHERE id = ?').get(id);
    assert.strictEqual(row.min_spend, 2500);
  });

  it('create rejects a negative min_spend with 400', async () => {
    const res = await POST(postReq({ action: 'event', title: 'Bad Min', min_spend: -5 }));
    assert.strictEqual(res.status, 400);
  });

  it('create with no min_spend leaves it NULL', async () => {
    const res = await POST(postReq({ action: 'event', title: 'No Min' }));
    const { id } = await res.json();
    const row = testDb.prepare('SELECT min_spend FROM beo_events WHERE id = ?').get(id);
    assert.strictEqual(row.min_spend, null);
  });

  it('update patches only min_spend, preserving other columns', async () => {
    const id = await seedEvent(POST);
    const before = testDb.prepare('SELECT * FROM beo_events WHERE id = ?').get(id);
    const res = await POST(postReq({ action: 'update_event', id, min_spend: 1800 }));
    assert.strictEqual(res.status, 200);
    const after = testDb.prepare('SELECT * FROM beo_events WHERE id = ?').get(id);
    assert.strictEqual(after.min_spend, 1800);
    assert.strictEqual(after.title, before.title);
    assert.strictEqual(after.tax_rate, before.tax_rate);
    assert.strictEqual(after.service_fee_pct, before.service_fee_pct);
    assert.strictEqual(after.event_time, before.event_time);
  });

  it('update preserves min_spend when the patch omits it', async () => {
    const id = await seedEvent(POST);
    await POST(postReq({ action: 'update_event', id, min_spend: 1800 }));
    await POST(postReq({ action: 'update_event', id, event_time: '6-9pm' }));
    const row = testDb.prepare('SELECT min_spend, event_time FROM beo_events WHERE id = ?').get(id);
    assert.strictEqual(row.min_spend, 1800);
    assert.strictEqual(row.event_time, '6-9pm');
  });

  it('update clears min_spend when an empty value is sent', async () => {
    const id = await seedEvent(POST);
    await POST(postReq({ action: 'update_event', id, min_spend: 2000 }));
    await POST(postReq({ action: 'update_event', id, min_spend: '' }));
    const row = testDb.prepare('SELECT min_spend FROM beo_events WHERE id = ?').get(id);
    assert.strictEqual(row.min_spend, null);
  });

  it('update rejects a negative min_spend with 400', async () => {
    const id = await seedEvent(POST);
    const res = await POST(postReq({ action: 'update_event', id, min_spend: -1 }));
    assert.strictEqual(res.status, 400);
  });
});
