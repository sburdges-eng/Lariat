/**
 * What day is it, for a restaurant?
 *
 * The venue service day runs 02:00 to 02:00 local and is named by the date it
 * started, so a shift that opens at 16:00 and closes at 01:30 sits on one date.
 * Spec: docs/superpowers/specs/2026-08-06-service-date-design.md
 *
 * This exists because `todayISO()` in lib/db.ts returns a UTC slice, which rolls
 * over at 18:00 Mountain — filing the entire dinner service under the next
 * calendar day. Write and read defaults were both wrong together, so the app
 * looked self-consistent and only exports, audits and analytics showed it.
 *
 * Deliberately dependency-free: no database, no node builtins, nothing but
 * `Intl`. Client components need this for their date defaults, and a lib module
 * that reaches for `node:crypto` or `node:fs` breaks `next build` the moment a
 * `'use client'` file imports it.
 */

export const VENUE_TIME_ZONE = 'America/Denver';

/** The service day starts at 02:00 local. Owner decision, 2026-08-06. */
export const SERVICE_DAY_START_HOUR = 2;

const MS_PER_HOUR = 3_600_000;

const VENUE_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in the venue's timezone, as YYYY-MM-DD. */
function venueCalendarDate(at: Date): string {
  const parts = VENUE_DATE_PARTS.formatToParts(at);
  let year = '';
  let month = '';
  let day = '';
  for (const { type, value } of parts) {
    if (type === 'year') year = value;
    else if (type === 'month') month = value;
    else if (type === 'day') day = value;
  }
  return `${year}-${month}-${day}`;
}

/**
 * The service date for an instant, as YYYY-MM-DD.
 *
 * Shifting the *instant* back by the boundary and then formatting is what makes
 * this total across daylight-saving transitions. Wall-clock arithmetic — "if the
 * local hour is under 2, use yesterday" — breaks twice a year, on the two nights
 * a bar is most likely to still be serving: in March 02:00 local never happens,
 * and in November it happens twice.
 *
 * On the November night the boundary therefore lands at the first 02:00 (MDT),
 * so the repeated 01:00 hour belongs to the new service day. That is the spec's
 * Option A: one hour a year is filed a day later than the wall clock suggests,
 * in exchange for a function that is total and an audit trail that is never
 * ambiguous.
 */
export function serviceDate(at: Date = new Date()): string {
  return venueCalendarDate(new Date(at.getTime() - SERVICE_DAY_START_HOUR * MS_PER_HOUR));
}
