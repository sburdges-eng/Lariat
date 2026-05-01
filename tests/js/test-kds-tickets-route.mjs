#!/usr/bin/env node
// Contract test for GET /api/kds/tickets — the v1 stub endpoint that
// the Lariat-KDS Swift app reads from. The shape is binding because
// the Swift parser at Sources/LariatKDSCore/TicketParser.swift will
// fail closed on any drift; spec lives in
// ~/Dev/Lariat-KDS/docs/lariat-kds-protocol.md §2.
//
// Run: node --experimental-strip-types --test tests/js/test-kds-tickets-route.mjs
//
// The route function is invoked directly (no Next.js bundler / HTTP
// server) — same pattern as test-beo-*.mjs. We use the test resolver
// so the route's relative imports work under Node ESM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const route = await import('../../app/api/kds/tickets/route.js');

async function callGet() {
  const res = await route.GET();
  const body = await res.json();
  return { res, body };
}

describe('GET /api/kds/tickets (stub)', () => {
  it('returns 200 with application/json', async () => {
    const { res } = await callGet();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  });

  it('body has a top-level tickets array', async () => {
    const { body } = await callGet();
    assert.ok(Array.isArray(body.tickets), 'tickets should be an array');
    assert.ok(body.tickets.length >= 3, 'stub should return >= 3 tickets');
  });

  it('every ticket has the required protocol fields', async () => {
    const { body } = await callGet();
    for (const t of body.tickets) {
      assert.equal(typeof t.id, 'string', `ticket.id is a string (${JSON.stringify(t)})`);
      assert.ok(t.id.length > 0, 'ticket.id is non-empty');
      assert.equal(typeof t.order_number, 'string', 'ticket.order_number is a string');
      assert.ok(t.order_number.length > 0, 'ticket.order_number is non-empty');
      assert.equal(typeof t.placed_at, 'string', 'ticket.placed_at is a string');
      assert.ok(Array.isArray(t.lines), 'ticket.lines is an array');
      // destination is optional per §2; if present, must be a string.
      if (t.destination !== undefined) {
        assert.equal(typeof t.destination, 'string', 'ticket.destination, if present, is a string');
      }
    }
  });

  it('placed_at parses as ISO-8601 (round-trips through Date)', async () => {
    const { body } = await callGet();
    for (const t of body.tickets) {
      const ms = Date.parse(t.placed_at);
      assert.ok(Number.isFinite(ms), `placed_at "${t.placed_at}" must parse as a date`);
      // Round-tripping a strict ISO-8601 string through Date should
      // yield the same canonical form. Catches things like
      // "2026-05-01 18:42:11" which Date can parse on some platforms
      // but the Swift ISO8601 decoder will reject.
      const round = new Date(ms).toISOString();
      assert.equal(
        round,
        t.placed_at,
        `placed_at "${t.placed_at}" is not canonical ISO-8601 (round-trip: "${round}")`,
      );
    }
  });

  it('every line has the required protocol fields', async () => {
    const { body } = await callGet();
    let lineCount = 0;
    for (const t of body.tickets) {
      for (const l of t.lines) {
        lineCount++;
        assert.equal(typeof l.id, 'string', 'line.id is a string');
        assert.ok(l.id.length > 0, 'line.id is non-empty');
        assert.equal(typeof l.item_name, 'string', 'line.item_name is a string');
        assert.ok(l.item_name.length > 0, 'line.item_name is non-empty');
        assert.equal(typeof l.station, 'string', 'line.station is a string');
        assert.equal(l.station, l.station.toLowerCase(), 'line.station is lowercased per §2');
        if (l.modifiers !== undefined) {
          assert.equal(typeof l.modifiers, 'string', 'line.modifiers, if present, is a string');
        }
      }
    }
    assert.ok(lineCount >= 1, 'stub should expose at least one line across all tickets');
  });

  it('quantity is an integer >= 1 on every line', async () => {
    const { body } = await callGet();
    for (const t of body.tickets) {
      for (const l of t.lines) {
        assert.equal(typeof l.quantity, 'number', 'line.quantity is a number');
        assert.ok(Number.isInteger(l.quantity), 'line.quantity is an integer');
        assert.ok(l.quantity >= 1, 'line.quantity is >= 1');
      }
    }
  });
});
