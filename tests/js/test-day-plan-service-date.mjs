#!/usr/bin/env node
/**
 * The day plan must file against the service date, not the UTC date.
 *
 * `todayISO()` is `new Date().toISOString().slice(0, 10)` — a UTC slice that
 * rolls over at 18:00 Mountain. A cook opening the day plan during Saturday
 * dinner service got Sunday's plan, with tonight's closing and side-work steps
 * nowhere on the screen.
 *
 * The rule is `serviceDate()`: the venue day runs 02:00 to 02:00
 * America/Denver, named by the date it started, so a shift opening at 16:00
 * and closing at 01:30 sits on one date.
 * Spec: docs/superpowers/specs/2026-08-06-service-date-design.md
 *
 * Note this is a stricter bar than the venue *calendar* date. `serviceDateISO()`
 * in lib/boh fixes the timezone but rolls at midnight, so it still hands a cook
 * closing at 01:00 the next day's plan — a two-hour window instead of six. The
 * boundary cases below fail against it, which is the point.
 *
 * Run: node --experimental-strip-types --test tests/js/test-day-plan-service-date.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));
const { serviceDate } = await import('../../lib/serviceDate.ts');

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures',
      'service_date_parity.json'),
    'utf8',
  ),
);

/** UTC slice — what todayISO() returns, and what the day plan used to default to. */
const utcISO = (d) => d.toISOString().slice(0, 10);

describe('the day plan files against the service date', () => {
  it('agrees with the shared boundary fixture', () => {
    for (const { at, local, expect, why } of FIXTURE.cases) {
      assert.equal(
        serviceDate(new Date(at)),
        expect,
        `${at} (${local}) belongs to service day ${expect} — ${why}`,
      );
    }
  });

  it('holds the shift date while UTC has already advanced', () => {
    // 02:00Z Friday = 20:00 Thursday in Denver — mid dinner service.
    const dinner = new Date('2026-08-07T02:00:00Z');
    assert.equal(utcISO(dinner), '2026-08-07', 'sanity: UTC really has rolled over');
    assert.equal(serviceDate(dinner), '2026-08-06', 'the shift is still Thursday’s');
  });

  it('keeps a whole shift on one date across midnight and past it', () => {
    const open = new Date('2026-08-06T22:00:00Z'); // 16:00 MDT
    const afterMidnight = new Date('2026-08-07T06:55:00Z'); // 00:55 MDT
    const lastCall = new Date('2026-08-07T07:59:00Z'); // 01:59 MDT
    assert.equal(serviceDate(open), '2026-08-06');
    assert.equal(serviceDate(afterMidnight), '2026-08-06', 'past midnight, same shift');
    assert.equal(serviceDate(lastCall), '2026-08-06', 'last minute of the service day');
    // The midnight-boundary helper in lib/boh would already say the 7th here.
    assert.notEqual(serviceDate(afterMidnight), utcISO(afterMidnight));
  });

  it('rolls at 02:00 local, not midnight and not 18:00', () => {
    assert.equal(serviceDate(new Date('2026-08-07T08:01:00Z')), '2026-08-07'); // 02:01 MDT
  });
});

// Source guard. The day-plan spine defaults its shift date in three places —
// the page, the GET read filter and the POST write — and all three are reached
// during evening service. They move together or a cook's own entries vanish
// from the board mid-shift.
const VENUE_DATE_FILES = ['app/day-plan/page.jsx', 'app/api/ops-run/route.js'];

describe('the day-plan surface defaults to the service date', () => {
  for (const file of VENUE_DATE_FILES) {
    it(`${file} defaults from serviceDate()`, () => {
      const src = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(src, /\btodayISO\b/, `${file} must not default from the UTC date`);
      assert.doesNotMatch(
        src,
        /\bserviceDateISO\b/,
        `${file} must use serviceDate() (02:00 boundary), not the midnight-boundary helper`,
      );
      assert.match(src, /\bserviceDate\b/, `${file} should default from serviceDate()`);
    });
  }

  it('moves the read and write defaults together', () => {
    const src = fs.readFileSync('app/api/ops-run/route.js', 'utf8');
    assert.equal(
      (src.match(/serviceDate\(\)/g) || []).length,
      2,
      'both the GET read default and the POST write default must use it',
    );
  });
});
