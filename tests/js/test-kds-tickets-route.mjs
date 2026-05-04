#!/usr/bin/env node
// Contract tests for /api/kds/tickets — the Lariat <-> KDS wire
// (Lariat-KDS Swift parser at Sources/LariatKDSCore/TicketParser.swift
// fails closed on drift). Spec: ~/Dev/Lariat-KDS/docs/lariat-kds-protocol.md §2.
//
// Run: node --experimental-strip-types --test tests/js/test-kds-tickets-route.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-kds-tickets-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
// Route the file-audit log to a tmp file so it doesn't pollute the dev tree.
process.env.LARIAT_AUDIT_PATH = path.join(TMP_DIR, 'audit.jsonl');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/kds/tickets/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { GET, POST } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM kds_ticket_lines; DELETE FROM kds_tickets; DELETE FROM idempotency_keys;');
});

function postReq(body, headers = {}) {
  return new Request('http://localhost/api/kds/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function getReq(query = '') {
  return new Request(`http://localhost/api/kds/tickets${query}`, { method: 'GET' });
}

const SAMPLE_BODY = () => ({
  order_number: '1042',
  destination: 'T12',
  location_id: 'default',
  cook_id: 'expo-1',
  lines: [
    { item_name: 'Smoked Brisket', quantity: 2, station: 'grill', modifiers: 'no pickle; sub fries' },
    { item_name: 'Mac & Cheese', quantity: 1, station: 'sides' },
  ],
});

describe('GET /api/kds/tickets — empty state', () => {
  it('returns 200 with tickets: [] when nothing has been punched', async () => {
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, { tickets: [] });
  });
});

describe('POST /api/kds/tickets — protocol §2 punch', () => {
  it('returns 200 with the created ticket (protocol-shaped)', async () => {
    const res = await POST(postReq(SAMPLE_BODY()));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(typeof j.ticket.id, 'string');
    assert.equal(j.ticket.order_number, '1042');
    assert.equal(j.ticket.destination, 'T12');
    assert.equal(j.ticket.lines.length, 2);
    assert.equal(j.ticket.lines[0].item_name, 'Smoked Brisket');
    assert.equal(j.ticket.lines[0].station, 'grill');
    assert.equal(j.ticket.lines[0].quantity, 2);
    assert.equal(j.ticket.lines[0].modifiers, 'no pickle; sub fries');
    // Line 2 has no modifiers — must be omitted from JSON, not null.
    assert.equal(j.ticket.lines[1].modifiers, undefined);
  });

  it('400 when order_number missing', async () => {
    const body = SAMPLE_BODY();
    delete body.order_number;
    const res = await POST(postReq(body));
    assert.equal(res.status, 400);
  });

  it('400 when lines is empty', async () => {
    const res = await POST(postReq({ ...SAMPLE_BODY(), lines: [] }));
    assert.equal(res.status, 400);
  });

  it('400 when a line.quantity is not an integer >= 1', async () => {
    for (const bad of [0, -1, 1.5, 'two', null]) {
      const body = SAMPLE_BODY();
      body.lines[0].quantity = bad;
      const res = await POST(postReq(body));
      assert.equal(res.status, 400, `quantity=${JSON.stringify(bad)} should 400`);
    }
  });

  it('400 when a line.station is missing', async () => {
    const body = SAMPLE_BODY();
    delete body.lines[0].station;
    const res = await POST(postReq(body));
    assert.equal(res.status, 400);
  });

  it('lowercases station per protocol §2', async () => {
    const body = SAMPLE_BODY();
    body.lines[0].station = 'GRILL';
    const res = await POST(postReq(body));
    const j = await res.json();
    assert.equal(j.ticket.lines[0].station, 'grill');
  });

  it('placed_at — uses now if omitted; canonicalizes ISO-8601 if provided', async () => {
    const r1 = await POST(postReq(SAMPLE_BODY()));
    const j1 = await r1.json();
    assert.ok(Number.isFinite(Date.parse(j1.ticket.placed_at)));
    // Provided value: round-trip through Date.toISOString() canonical form.
    const r2 = await POST(postReq({ ...SAMPLE_BODY(), placed_at: '2026-05-01T18:42:11.000Z' }));
    const j2 = await r2.json();
    assert.equal(j2.ticket.placed_at, '2026-05-01T18:42:11.000Z');
  });

  it('400 when placed_at is unparseable', async () => {
    const res = await POST(postReq({ ...SAMPLE_BODY(), placed_at: 'not a date' }));
    assert.equal(res.status, 400);
  });
});

describe('GET /api/kds/tickets — populated state', () => {
  it('returns the punched ticket in protocol §2 shape', async () => {
    await POST(postReq(SAMPLE_BODY()));
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tickets.length, 1);
    const t = body.tickets[0];
    assert.equal(typeof t.id, 'string');
    assert.equal(t.order_number, '1042');
    assert.equal(t.destination, 'T12');
    assert.ok(Array.isArray(t.lines));
    assert.equal(t.lines.length, 2);
    const round = new Date(Date.parse(t.placed_at)).toISOString();
    assert.equal(round, t.placed_at);
    assert.equal(t.lines[1].modifiers, undefined);
    assert.equal(t.lines[1].station, 'sides');
  });

  it('omits destination when not set', async () => {
    const body = SAMPLE_BODY();
    delete body.destination;
    await POST(postReq(body));
    const res = await GET(getReq());
    const out = await res.json();
    assert.equal(out.tickets[0].destination, undefined);
  });

  it('returns lines in sort_order (insertion order)', async () => {
    const body = SAMPLE_BODY();
    body.lines = [
      { item_name: 'First', quantity: 1, station: 'grill' },
      { item_name: 'Second', quantity: 1, station: 'sides' },
      { item_name: 'Third', quantity: 1, station: 'bar' },
    ];
    await POST(postReq(body));
    const res = await GET(getReq());
    const out = await res.json();
    assert.deepEqual(
      out.tickets[0].lines.map((l) => l.item_name),
      ['First', 'Second', 'Third'],
    );
  });

  it('scopes by location_id query param', async () => {
    await POST(postReq({ ...SAMPLE_BODY(), location_id: 'default' }));
    await POST(postReq({ ...SAMPLE_BODY(), location_id: 'lariat-south', order_number: '9999' }));
    const def = await (await GET(getReq('?location=default'))).json();
    const south = await (await GET(getReq('?location=lariat-south'))).json();
    assert.equal(def.tickets.length, 1);
    assert.equal(def.tickets[0].order_number, '1042');
    assert.equal(south.tickets.length, 1);
    assert.equal(south.tickets[0].order_number, '9999');
  });
});

describe('POST /api/kds/tickets — idempotency-key', () => {
  it('same key + same body → one row, identical response', async () => {
    const key = 'kds-test-' + Math.random().toString(36).slice(2, 12).padEnd(10, 'x');
    const body = SAMPLE_BODY();
    const r1 = await POST(postReq(body, { 'idempotency-key': key }));
    const j1 = await r1.json();
    const r2 = await POST(postReq(body, { 'idempotency-key': key }));
    const j2 = await r2.json();
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(j2.ticket.id, j1.ticket.id);
    assert.deepStrictEqual(j2, j1);
    const list = await (await GET(getReq())).json();
    assert.equal(list.tickets.length, 1);
  });
});
