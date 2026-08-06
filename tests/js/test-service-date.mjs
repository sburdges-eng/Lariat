#!/usr/bin/env node
// The venue service day runs 02:00 to 02:00 America/Denver and is named by the
// date it started. Spec: docs/superpowers/specs/2026-08-06-service-date-design.md
//
// This replaces todayISO(), which returns a UTC slice and therefore rolls over
// at 18:00 local — filing the whole dinner service under the next calendar day.
//
// Run: node --experimental-strip-types --test tests/js/test-service-date.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { serviceDate, VENUE_TIME_ZONE, SERVICE_DAY_START_HOUR } from '../../lib/serviceDate.ts';

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'service_date_parity.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

describe('serviceDate — the venue day, not the UTC day', () => {
  it('agrees with the shared boundary fixture on every case', () => {
    for (const { at, local, expect, why } of fixture.cases) {
      assert.equal(
        serviceDate(new Date(at)),
        expect,
        `${at} (${local}) should be service day ${expect} — ${why}`,
      );
    }
  });

  it('declares the rule the fixture was built against', () => {
    assert.equal(VENUE_TIME_ZONE, fixture.timezone);
    assert.equal(SERVICE_DAY_START_HOUR, fixture.boundary_hour_local);
  });

  it('does not roll over at 18:00 local, which is what todayISO got wrong', () => {
    // 6 Aug 20:00 MDT. toISOString().slice(0,10) would say the 7th.
    const dinner = new Date('2026-08-07T02:00:00Z');
    assert.equal(dinner.toISOString().slice(0, 10), '2026-08-07', 'sanity: UTC really does say the 7th');
    assert.equal(serviceDate(dinner), '2026-08-06');
  });

  it('keeps a whole service day on one date across midnight', () => {
    const open = new Date('2026-08-06T22:00:00Z'); // 6 Aug 16:00 MDT
    const close = new Date('2026-08-07T07:30:00Z'); // 7 Aug 01:30 MDT
    assert.equal(serviceDate(open), serviceDate(close));
  });

  it('is total — every instant maps to exactly one date, including DST nights', () => {
    // Walk both transition nights minute by minute; no throw, no gap, monotonic.
    for (const start of ['2026-03-08T06:00:00Z', '2026-11-01T05:00:00Z']) {
      let prev = null;
      for (let m = 0; m < 360; m += 1) {
        const at = new Date(new Date(start).getTime() + m * 60_000);
        const d = serviceDate(at);
        assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${at.toISOString()} produced ${d}`);
        if (prev !== null) assert.ok(d >= prev, `service date went backwards at ${at.toISOString()}`);
        prev = d;
      }
    }
  });

  it('defaults to now when called with no argument', () => {
    assert.match(serviceDate(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
