#!/usr/bin/env node
/**
 * The day plan must use the venue's date, not the UTC one.
 *
 * `todayISO()` is `new Date().toISOString().slice(0, 10)` — a UTC slice that
 * rolls over at 6pm Mountain. A cook opening the day plan during Saturday
 * dinner service would get Sunday's plan, with tonight's closing and side-work
 * steps nowhere to be seen.
 *
 * `serviceDateISO()` in lib/boh/index.ts exists for exactly this, and says so
 * in its own docstring: "A UTC date rolls over at 6pm Mountain, which would
 * hand a cook a blank dinner day plan in the middle of dinner service."
 *
 * These tests pin both halves: that the venue date really does differ from the
 * UTC date across the dinner window, and that the day-plan surface reaches for
 * the venue one.
 *
 * Run: node --experimental-strip-types --test tests/js/test-day-plan-service-date.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));
const { serviceDateISO } = await import('../../lib/boh/index.ts');

/** UTC slice, i.e. what todayISO() returns. */
const utcISO = (d) => d.toISOString().slice(0, 10);

describe('serviceDateISO across the dinner rollover', () => {
  it('holds the venue date while UTC has already advanced', () => {
    // 01:30Z Sunday = 19:30 Saturday in Denver (MDT, UTC-6) — mid dinner service.
    const duringDinner = new Date('2026-08-30T01:30:00Z');
    assert.equal(utcISO(duringDinner), '2026-08-30', 'UTC has rolled over');
    assert.equal(
      serviceDateISO(duringDinner),
      '2026-08-29',
      'the venue is still on Saturday, and so is the shift',
    );
  });

  it('rolls at venue midnight, not before', () => {
    // 05:59Z = 23:59 MDT, still the same service day.
    assert.equal(serviceDateISO(new Date('2026-08-30T05:59:00Z')), '2026-08-29');
    // 06:01Z = 00:01 MDT, the next one.
    assert.equal(serviceDateISO(new Date('2026-08-30T06:01:00Z')), '2026-08-30');
  });

  it('agrees with UTC during service prep, when both are the same day', () => {
    const midMorning = new Date('2026-08-29T16:00:00Z'); // 10:00 MDT
    assert.equal(serviceDateISO(midMorning), utcISO(midMorning));
  });
});

// Source guard — the day-plan spine defaults its shift date in these three
// places, and every one of them is reached during evening service.
const VENUE_DATE_FILES = [
  'app/day-plan/page.jsx',
  'app/api/ops-run/route.js',
];

describe('the day-plan surface defaults to the venue date', () => {
  for (const file of VENUE_DATE_FILES) {
    it(`${file} does not fall back to the UTC date`, () => {
      const src = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        src,
        /\btodayISO\b/,
        `${file} must default its shift date with serviceDateISO(), not todayISO()`,
      );
      assert.match(src, /\bserviceDateISO\b/, `${file} should use the venue date`);
    });
  }
});
