#!/usr/bin/env node
// BEO event-model schema wave (docs/superpowers/specs/2026-07-21-beo-event-model-design.md):
// six new beo_events columns (space, service_style, service_hours, bar_mode,
// bar_amount, bar_notes) + beo_event_charges (AV/fees, charge-vs-cost split)
// + beo_run_of_show, with /api/beo create/update/CRUD support.
// Run: node --experimental-strip-types --test tests/js/test-beo-event-model.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  createTempBeoDb, clearBeoTables, postReq, getReq, seedEvent,
} = await import('./helpers/beo-fixtures.mjs');

/** @type {Awaited<ReturnType<typeof createTempBeoDb>>} */
let fixture;
let conn;
let POST;
let GET;

before(async () => {
  fixture = await createTempBeoDb('event-model');
  conn = fixture.testDb;
  const route = await import('../../app/api/beo/route.js');
  POST = route.POST;
  GET = route.GET;
});

after(() => fixture.cleanup());

beforeEach(() => {
  clearBeoTables(conn);
  conn.exec('DELETE FROM audit_events;');
});

const eventRow = (id) =>
  conn.prepare('SELECT * FROM beo_events WHERE id = ?').get(id);

// ── 1+2: create ─────────────────────────────────────────────────────

describe('action:event — new model fields', () => {
  it('persists all six fields and returns them via GET', async () => {
    const id = await seedEvent(POST, {
      space: 'Back Room',
      service_style: 'buffet',
      service_hours: 3,
      bar_mode: 'fixed',
      bar_amount: 1200,
      bar_notes: 'Open Bar Basic — quoted flat',
    });
    const row = eventRow(id);
    assert.equal(row.space, 'Back Room');
    assert.equal(row.service_style, 'buffet');
    assert.equal(row.service_hours, 3);
    assert.equal(row.bar_mode, 'fixed');
    assert.equal(row.bar_amount, 1200);
    assert.equal(row.bar_notes, 'Open Bar Basic — quoted flat');

    const res = await GET(getReq());
    const body = await res.json();
    const ev = body.events.find((e) => e.id === id);
    assert.equal(ev.service_style, 'buffet');
    assert.equal(ev.bar_mode, 'fixed');
  });

  it('leaves all six NULL when omitted — no accidental defaults', async () => {
    const id = await seedEvent(POST);
    const row = eventRow(id);
    for (const col of ['space', 'service_style', 'service_hours', 'bar_mode', 'bar_amount', 'bar_notes']) {
      assert.equal(row[col], null, `${col} should default to NULL`);
    }
  });

  it('rejects a bad service_style / bar_mode / negative bar_amount / non-positive service_hours on create', async () => {
    for (const bad of [
      { service_style: 'seated' },
      { bar_mode: 'open' },
      { bar_amount: -5 },
      { service_hours: 0 },
      { service_hours: -2 },
    ]) {
      const res = await POST(postReq({ action: 'event', title: 'Bad Event', ...bad }));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_events').get().c, 0, 'nothing written');
  });
});

// ── 3: update_event partial patch ───────────────────────────────────

describe('action:update_event — partial patch on new fields', () => {
  const seedFull = () =>
    seedEvent(POST, {
      space: 'Main Hall',
      service_style: 'plated',
      service_hours: 4,
      bar_mode: 'fill',
      bar_amount: 800,
      bar_notes: 'fill to minimum',
    });

  it('omitted keys preserve existing values', async () => {
    const id = await seedFull();
    const res = await POST(postReq({ action: 'update_event', id, title: 'Renamed' }));
    assert.equal(res.status, 200);
    const row = eventRow(id);
    assert.equal(row.title, 'Renamed');
    assert.equal(row.space, 'Main Hall');
    assert.equal(row.service_style, 'plated');
    assert.equal(row.service_hours, 4);
    assert.equal(row.bar_mode, 'fill');
    assert.equal(row.bar_amount, 800);
    assert.equal(row.bar_notes, 'fill to minimum');
  });

  it('present keys update; explicit null (or empty string) clears each field', async () => {
    const id = await seedFull();
    let res = await POST(postReq({
      action: 'update_event', id,
      space: 'Patio', service_style: 'buffet', service_hours: 2.5,
      bar_mode: 'fixed', bar_amount: 950, bar_notes: 'switched to fixed tab',
    }));
    assert.equal(res.status, 200);
    let row = eventRow(id);
    assert.equal(row.space, 'Patio');
    assert.equal(row.service_style, 'buffet');
    assert.equal(row.service_hours, 2.5);
    assert.equal(row.bar_mode, 'fixed');
    assert.equal(row.bar_amount, 950);
    assert.equal(row.bar_notes, 'switched to fixed tab');

    res = await POST(postReq({
      action: 'update_event', id,
      space: null, service_style: '', service_hours: null,
      bar_mode: null, bar_amount: '', bar_notes: null,
    }));
    assert.equal(res.status, 200);
    row = eventRow(id);
    for (const col of ['space', 'service_style', 'service_hours', 'bar_mode', 'bar_amount', 'bar_notes']) {
      assert.equal(row[col], null, `${col} should be cleared`);
    }
  });

  it('soft-rejects bad enum/numeric values without writing', async () => {
    const id = await seedFull();
    for (const bad of [
      { service_style: 'family' },
      { bar_mode: 'cash' },
      { bar_amount: -1 },
      { service_hours: 0 },
    ]) {
      const res = await POST(postReq({ action: 'update_event', id, ...bad }));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    const row = eventRow(id);
    assert.equal(row.service_style, 'plated', 'rejected update must not partially apply');
    assert.equal(row.bar_mode, 'fill');
    assert.equal(row.bar_amount, 800);
    assert.equal(row.service_hours, 4);
  });
});

// ── 6: charges CRUD ─────────────────────────────────────────────────

describe('beo_event_charges CRUD', () => {
  it('adds av + fee rows, returns them via GET, and audits the insert', async () => {
    const id = await seedEvent(POST);
    const av = await POST(postReq({
      action: 'charge', event_id: id, kind: 'av',
      item_name: 'PA + two wireless mics', charge: 250, cost: 40,
    }));
    assert.equal(av.status, 200);
    const { id: avId } = await av.json();

    const fee = await POST(postReq({
      action: 'charge', event_id: id, kind: 'fee',
      item_name: 'Room fee', charge: 300,
    }));
    assert.equal(fee.status, 200);

    const res = await GET(getReq());
    const body = await res.json();
    assert.ok(Array.isArray(body.charges), 'GET exposes a charges array');
    const mine = body.charges.filter((c) => c.event_id === id);
    assert.equal(mine.length, 2);
    const avRow = mine.find((c) => c.kind === 'av');
    assert.equal(avRow.item_name, 'PA + two wireless mics');
    assert.equal(avRow.charge, 250);
    assert.equal(avRow.cost, 40);
    const feeRow = mine.find((c) => c.kind === 'fee');
    assert.equal(feeRow.charge, 300);
    assert.equal(feeRow.cost, 0, 'cost defaults to 0');

    const audit = conn
      .prepare("SELECT COUNT(*) c FROM audit_events WHERE entity = 'beo_event_charges' AND action = 'insert'")
      .get();
    assert.equal(audit.c, 2);
    assert.ok(Number.isInteger(avId));
  });

  it('rejects a bad kind, a missing item_name, and negative money', async () => {
    const id = await seedEvent(POST);
    for (const bad of [
      { kind: 'misc', item_name: 'X' },
      { kind: 'av' }, // no item_name
      { kind: 'av', item_name: 'X', charge: -10 },
      { kind: 'fee', item_name: 'X', cost: -1 },
    ]) {
      const res = await POST(postReq({ action: 'charge', event_id: id, ...bad }));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_event_charges').get().c, 0);
  });

  it('update_charge patches item/charge/cost and audits; delete_charge removes and audits', async () => {
    const id = await seedEvent(POST);
    const created = await POST(postReq({
      action: 'charge', event_id: id, kind: 'av', item_name: 'Projector', charge: 100, cost: 10,
    }));
    const { id: chargeId } = await created.json();

    let res = await POST(postReq({
      action: 'update_charge', id: chargeId, item_name: 'Projector + screen', charge: 150,
    }));
    assert.equal(res.status, 200);
    let row = conn.prepare('SELECT * FROM beo_event_charges WHERE id = ?').get(chargeId);
    assert.equal(row.item_name, 'Projector + screen');
    assert.equal(row.charge, 150);
    assert.equal(row.cost, 10, 'omitted cost preserved');

    res = await POST(postReq({ action: 'update_charge', id: chargeId, charge: -5 }));
    assert.equal(res.status, 400);

    res = await POST(postReq({ action: 'delete_charge', id: chargeId }));
    assert.equal(res.status, 200);
    row = conn.prepare('SELECT * FROM beo_event_charges WHERE id = ?').get(chargeId);
    assert.equal(row, undefined);

    const audits = conn
      .prepare("SELECT action, COUNT(*) c FROM audit_events WHERE entity = 'beo_event_charges' GROUP BY action")
      .all();
    const byAction = Object.fromEntries(audits.map((a) => [a.action, a.c]));
    assert.equal(byAction.insert, 1);
    assert.equal(byAction.update, 1, 'the rejected update must not audit');
    assert.equal(byAction.delete, 1);
  });
});

// ── 6: run-of-show CRUD ─────────────────────────────────────────────

describe('beo_run_of_show CRUD', () => {
  it('adds, patches, deletes rows; GET exposes run_of_show ordered by sort_order', async () => {
    const id = await seedEvent(POST);
    const a = await POST(postReq({
      action: 'soe', event_id: id, show_time: '5:30 PM', note: 'guests arrive', sort_order: 1,
    }));
    assert.equal(a.status, 200);
    const { id: soeA } = await a.json();
    const b = await POST(postReq({
      action: 'soe', event_id: id, show_time: '6:15 PM', note: 'buffet live', sort_order: 2,
    }));
    const { id: soeB } = await b.json();

    let res = await GET(getReq());
    let body = await res.json();
    assert.ok(Array.isArray(body.run_of_show), 'GET exposes a run_of_show array');
    const mine = body.run_of_show.filter((r) => r.event_id === id);
    assert.deepEqual(mine.map((r) => r.note), ['guests arrive', 'buffet live']);

    res = await POST(postReq({ action: 'update_soe', id: soeA, show_time: '5:00 PM' }));
    assert.equal(res.status, 200);
    let row = conn.prepare('SELECT * FROM beo_run_of_show WHERE id = ?').get(soeA);
    assert.equal(row.show_time, '5:00 PM');
    assert.equal(row.note, 'guests arrive', 'omitted note preserved');

    res = await POST(postReq({ action: 'update_soe', id: soeA, show_time: null }));
    assert.equal(res.status, 200);
    row = conn.prepare('SELECT * FROM beo_run_of_show WHERE id = ?').get(soeA);
    assert.equal(row.show_time, null, 'show_time is clearable');

    res = await POST(postReq({ action: 'delete_soe', id: soeB }));
    assert.equal(res.status, 200);
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_run_of_show').get().c, 1);
  });

  it('requires event_id + note', async () => {
    const id = await seedEvent(POST);
    let res = await POST(postReq({ action: 'soe', event_id: id }));
    assert.equal(res.status, 400);
    res = await POST(postReq({ action: 'soe', note: 'orphan' }));
    assert.equal(res.status, 400);
  });
});

// ── 7: cascade ──────────────────────────────────────────────────────

describe('ON DELETE CASCADE', () => {
  it('delete_event removes its charges and run_of_show rows', async () => {
    const id = await seedEvent(POST);
    await POST(postReq({ action: 'charge', event_id: id, kind: 'fee', item_name: 'Room fee', charge: 300 }));
    await POST(postReq({ action: 'soe', event_id: id, note: 'doors' }));

    const res = await POST(postReq({ action: 'delete_event', id }));
    assert.equal(res.status, 200);
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_event_charges').get().c, 0);
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_run_of_show').get().c, 0);
  });
});

// ── 8: location scoping ─────────────────────────────────────────────

describe('location scoping through the parent event', () => {
  it('cannot insert a charge/soe against another location\'s event', async () => {
    const idB = await seedEvent(POST, { location_id: 'site-b', title: 'Site B Party' });
    let res = await POST(postReq({
      action: 'charge', location_id: 'site-a', event_id: idB, kind: 'av', item_name: 'Sneaky PA', charge: 1,
    }));
    assert.equal(res.status, 404);
    res = await POST(postReq({
      action: 'soe', location_id: 'site-a', event_id: idB, note: 'sneaky cue',
    }));
    assert.equal(res.status, 404);
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_event_charges').get().c, 0);
    assert.equal(conn.prepare('SELECT COUNT(*) c FROM beo_run_of_show').get().c, 0);
  });

  it('cannot update or delete another location\'s charge/soe rows', async () => {
    const idB = await seedEvent(POST, { location_id: 'site-b', title: 'Site B Party' });
    const c = await POST(postReq({
      action: 'charge', location_id: 'site-b', event_id: idB, kind: 'av', item_name: 'B PA', charge: 100,
    }));
    const { id: chargeId } = await c.json();
    const s = await POST(postReq({
      action: 'soe', location_id: 'site-b', event_id: idB, note: 'B cue',
    }));
    const { id: soeId } = await s.json();

    await POST(postReq({ action: 'update_charge', location_id: 'site-a', id: chargeId, charge: 1 }));
    await POST(postReq({ action: 'delete_charge', location_id: 'site-a', id: chargeId }));
    await POST(postReq({ action: 'update_soe', location_id: 'site-a', id: soeId, note: 'hijack' }));
    await POST(postReq({ action: 'delete_soe', location_id: 'site-a', id: soeId }));

    const chargeRow = conn.prepare('SELECT * FROM beo_event_charges WHERE id = ?').get(chargeId);
    assert.equal(chargeRow.charge, 100, 'cross-location update must not apply');
    const soeRow = conn.prepare('SELECT * FROM beo_run_of_show WHERE id = ?').get(soeId);
    assert.equal(soeRow.note, 'B cue');
  });

  it('GET only returns the requested location\'s charges and run_of_show', async () => {
    const idA = await seedEvent(POST, { location_id: 'site-a', title: 'A Party' });
    const idB = await seedEvent(POST, { location_id: 'site-b', title: 'B Party' });
    await POST(postReq({ action: 'charge', location_id: 'site-a', event_id: idA, kind: 'av', item_name: 'A PA', charge: 10 }));
    await POST(postReq({ action: 'charge', location_id: 'site-b', event_id: idB, kind: 'av', item_name: 'B PA', charge: 20 }));
    await POST(postReq({ action: 'soe', location_id: 'site-a', event_id: idA, note: 'A cue' }));
    await POST(postReq({ action: 'soe', location_id: 'site-b', event_id: idB, note: 'B cue' }));

    const res = await GET(getReq('?location=site-a'));
    const body = await res.json();
    assert.deepEqual(body.charges.map((c) => c.item_name), ['A PA']);
    assert.deepEqual(body.run_of_show.map((r) => r.note), ['A cue']);
  });
});
