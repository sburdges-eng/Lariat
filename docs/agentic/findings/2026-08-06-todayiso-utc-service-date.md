---
title: "todayISO() is UTC — every record logged after 6 PM is filed on tomorrow"
date: 2026-08-06
status: open — needs an owner decision before any fix
severity: high (regulated records affected)
verified_against: origin/main e6cb9c9
---

# `todayISO()` is UTC, so the business date rolls at 6 PM local

## The defect

`lib/db.ts:4028` exports the repo's shared "what day is it" helper:

```ts
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
```

`toISOString()` is **UTC**. The venue is `America/Denver` — UTC−6 in MDT. So from
**18:00 local onward, `todayISO()` returns tomorrow's date.**

Measured against the venue's own service-date formatter:

| Denver wall clock | `todayISO()` | correct service date |
|---|---|---|
| 17:30 | 2026-08-06 | 2026-08-06 |
| **18:30** | **2026-08-07** | 2026-08-06 |
| **23:34** | **2026-08-07** | 2026-08-06 |
| 00:55 | 2026-08-06 | 2026-08-06 |

The entire dinner service is filed under the next calendar day. A shift that clocks in at
11:34 PM and out at 12:55 AM is split across two dates, neither of which is its service day.

## Blast radius

**62 non-test files** call `todayISO()`. The concentration matters more than the count —
these are regulated surfaces:

- `app/api/cooling/route.js` — HACCP cooling logs
- `app/api/date-marks/route.js` — date marking
- `app/api/food-safety/haccp-plan/route.js` — HACCP plan
- `app/api/corrective-actions/route.js` — corrective actions
- `app/api/eighty-six/route.ts`, `app/api/prep-tasks/route.js`, `app/api/inventory/**`
- `app/api/breaks/route.js` — labor
- `app/api/kitchen-assistant/route.js` — 10 call sites, the highest single concentration

Separately, 19 sites inline the same `new Date().toISOString().slice(0, 10)` expression
rather than calling the helper, including four `shift_date` writes in `lib/boxOfficeRepo.ts`
and `scripts/ingest-analytics.mjs:198`.

## The correct implementation already exists

`lib/boh/index.ts:89` does it right, and only the BOH module uses it:

```ts
const VENUE_TIME_ZONE = 'America/Denver';
const SERVICE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
```

So this is not a design problem. One module solved it; the shared helper never adopted it.

There is no `serviceDay` / `service_day` / `businessDay` concept anywhere else in the
codebase — `git grep -l` returns zero files outside that module.

## Why this is not being fixed in this pass

Three reasons, each sufficient on its own:

1. **The records are regulated.** `CLAUDE.md` §5 — never silently auto-correct a food-safety
   record. Changing what date a cooling log claims is exactly that.
2. **Historical data is already mis-filed.** Every after-6-PM record written to date carries
   the wrong date. Whether to migrate them, and how to represent a corrected date in an
   append-only audit trail, is an owner decision, not an implementation detail.
3. **Service day ≠ calendar day even after the timezone fix.** A restaurant service day
   typically ends at close (say 2 AM), not midnight. Fixing UTC→local gets 18:00–23:59
   right and still mis-files 00:00–02:00. The real fix needs a service-day boundary, which
   is a business rule nobody has written down.

## Recommended shape

- Define the service-day boundary explicitly — a documented rule, not an inferred one.
- Generalize `lib/boh/index.ts`'s formatter into a shared `serviceDate()` and make
  `todayISO()` either delegate to it or be deleted.
- Decide the historical-record question separately, and record the decision before touching
  data.
- Add a parity test: web and native must agree on the service date for a set of boundary
  timestamps, including 17:59, 18:00, 23:59, 00:00, and 01:59 local.

## Native side

Not yet audited. `LariatNative/Sources/LariatDB/AssistantContextRepository.swift` uses
SQLite `date(shift_date)` comparisons, which inherit whatever the write side stored — so
native correctness depends on this same decision.
