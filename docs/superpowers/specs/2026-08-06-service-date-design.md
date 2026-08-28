---
title: "Service date — one definition of what day it is"
date: 2026-08-06
status: approved 2026-08-06 — Option A chosen
canonical_id: service-date
finding: docs/agentic/findings/2026-08-06-todayiso-utc-service-date.md
---

# Service date

## Decision

**The service day runs 02:00 to 02:00, venue-local, and is named by the date it started.**
Owner decision, 2026-08-06. Venue timezone is `America/Denver`, already declared at
`lib/boh/index.ts:89`.

A cooling log written at 23:34 on 6 August and one written at 00:55 on 7 August both belong to
service day **2026-08-06**, because both fall in the service day that began at 02:00 on the 6th.

## The problem this replaces

`lib/db.ts:4028` returns UTC:

```ts
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
```

From 18:00 local onward that is tomorrow's date. Full analysis in the finding; the short
version is that 62 files and 84 call sites derive "what day is it" from UTC, including
HACCP-regulated surfaces.

## Why nobody noticed — and the central migration hazard

The same helper defaults **both** sides of every board:

```js
const shift_date = clip(body.shift_date, 32) || todayISO();   // write default
const date = url.searchParams.get('date') || todayISO();      // read filter default
```

Write and read are wrong *together*, so the app is self-consistent: a cook logs at 20:00, the
row is stamped tomorrow, and the board asking for "today" also asks for tomorrow — so the cook
sees their own record. The corruption is invisible in the UI and only surfaces in exports,
audit review, analytics, and anything a regulator would read.

**Consequence for the migration: write and read defaults for a given surface must change in the
same commit.** Fixing either alone makes a cook's own entries vanish from their board mid-shift.
This is the single largest risk in the work, and it is a service-floor risk, not a data risk.

## The API

One function, in a module both halves can reach:

```ts
/** Venue-local service date (YYYY-MM-DD) for an instant. Service day starts 02:00. */
export function serviceDate(at: Date = new Date()): string;
```

Implementation is **instant arithmetic, not wall-clock arithmetic**:

```
serviceDate(at) = denverCalendarDate(at − 2h)
```

Subtracting two hours from the instant and then formatting in `America/Denver` is
DST-total: it never has to reason about a wall-clock time that doesn't exist or happens twice.
A naive `if (hour < 2) useYesterday()` breaks twice a year, on the two nights a bar is most
likely to still be open.

Verified behaviour:

| Instant (Denver) | Service date | Note |
|---|---|---|
| 6 Aug 17:30 MDT | 2026-08-06 | |
| 6 Aug 23:34 MDT | 2026-08-06 | late close, same service day |
| 7 Aug 00:55 MDT | 2026-08-06 | after midnight, still the 6th |
| 7 Aug 01:59 MDT | 2026-08-06 | last minute of the service day |
| 7 Aug 02:01 MDT | 2026-08-07 | boundary |
| 8 Mar 01:30 MST | 2026-03-07 | spring forward; 02:00 never occurs |
| 8 Mar 04:30 MDT | 2026-03-08 | boundary effectively 03:00 wall clock |
| 1 Nov 01:30 MDT | 2026-10-31 | first pass through the repeated hour |
| 1 Nov 01:30 MST | 2026-11-01 | second pass — see below |

### One edge case that needs a ruling

On fall-back night the clock reads 01:00–01:59 twice. Under instant arithmetic the service day
flips at 02:00 **MDT**, which is 01:00 MST — so the entire repeated hour belongs to the *new*
service day, and a cook closing at 01:45 MST files to the next day despite the wall clock
reading before 2 AM.

- **Option A (recommended): keep instant arithmetic.** Every instant maps to exactly one
  service date, the function is total, and the audit trail is unambiguous. Cost: one hour a
  year is filed a day later than the wall clock suggests.
- **Option B: wall-clock boundary with an explicit tie-break.** Operationally truer, but
  requires a documented rule for both the nonexistent hour and the ambiguous one, and makes
  the function partial on inputs that are otherwise fine.

**Decided 2026-08-06: Option A.** For regulated records, determinism beats an hour of
intuition once a year. `serviceDate` is total, every instant maps to exactly one date, and the
November behaviour is documented in the function and pinned by the boundary fixture.

## A second, smaller instance of the same bug

`lib/boh/index.ts` already exports `serviceDateISO()`, and its docstring reasons explicitly
about the UTC problem — "a UTC date rolls over at 6pm Mountain, which would hand a cook a blank
dinner day plan in the middle of dinner service." It fixes the timezone but uses **midnight**,
not 02:00. So the line book rolls over at Colorado midnight and a cook closing at 01:00 is
handed tomorrow's sheet mid-shift. Same defect class, two-hour window instead of six.

It is not folded into the migration below, because the line book is a shipped surface
(#574, #578) and changing when its sheet rolls is a visible behaviour change. It becomes its
own commit: `serviceDateISO` delegates to `serviceDate`, with the docstring corrected.

## Scope — what changes

Re-triaged 2026-08-06 by **surface**, not by file or by line. Two earlier passes got the unit
wrong: line-level missed that write and read defaults sit in the same file, and file-level
missed that the *page* carries a third default. `git grep` classified by whether the value
falls back from a request `body` (a write) or from `searchParams` (a read).

**The atomic unit is a surface: the API route plus the page that renders it.** Splitting one
across commits leaves a board whose write, read and page defaults disagree — and a cook's own
entries vanish from their screen mid-shift.

### Wave 1 — the full triad (7 surfaces, one commit each)

`breaks`, `cleaning`, `cooling`, `eighty-six`, `receiving`, `sanitizer`, `tip-pool`.

Each is identical in shape: an API route holding both a write default (`body.X || todayISO()`)
and a read default (`searchParams.get('date') || todayISO()`), plus a page with its own
default. Three files, one commit, one write/read symmetry test per surface: a record written at
23:30 local appears on that board at 23:31 *and* at 00:30.

These are the highest-risk commits in the migration and they are also the most mechanical.
`cooling`, `sanitizer` and `receiving` are HACCP surfaces.

### Wave 2 — split or one-sided surfaces (4)

`beo` (write in `route.js`, read in `fire-schedule/route.js`), `date-marks`, `shows/tonight`,
`temp-log`. Same symmetry requirement, but the two halves live in different files or only one
half exists, so each needs reading before it is moved rather than pattern-matching.

### Wave 3 — write with no paired read (6, safe alone)

`pest`, `sds`, `sick-worker`, `thermometer-calibrations`, `tphc`, `inventory/counts`. No read
default to keep in step, so these can land together in one commit.

### Wave 4 — `kitchen-assistant` alone

Nine call sites in `app/api/kitchen-assistant/route.js`, the highest concentration in the repo,
mixing reads and writes across several entities. Its own commit and its own reading.

### Wave 5 — display defaults and bare calls (~29)

`command`, `operators`, `haccp-plan`, `morning`, `stations`, and the page-level defaults that
merely seed a date picker. Most should follow so a board's "today" matches what was written;
some genuinely want the calendar date. Each is decided explicitly and the reasoning recorded.
None is changed by sed.

Separately, **19 sites inline `new Date().toISOString().slice(0, 10)`** rather than calling the
helper, including four `shift_date` writes in `lib/boxOfficeRepo.ts` and
`scripts/ingest-analytics.mjs:198`. Same defect, same waves.

## Native

`LariatNative` compares with SQLite `date(shift_date)` and inherits whatever the write side
stored, so native correctness follows from this change rather than needing its own rule. It
needs the same `serviceDate` for anything it stamps itself.

Parity is pinned the way `UnitConvert`, `actor_source` and the cloud-bridge envelope already
are: a shared fixture of boundary instants, asserted identical in both languages.

## Tests

1. **Boundary table** — every row above, both languages, from the same fixture file.
2. **DST** — the four transition instants, asserted explicitly rather than derived.
3. **Write/read symmetry** — for each surface in group B, a record written at 23:30 local
   appears on the board that surface renders for "today" at 23:31 *and* at 00:30.
4. **Audit ledger** — an `audit_events` row written at 23:30 carries the service date of the
   day that began that morning.
5. **No caller left behind** — a coverage test that fails when a new `todayISO()` or inline
   `toISOString().slice(0, 10)` appears outside an allowlist, in the shape of the existing
   `test-pin-gate-coverage.mjs` and `test-idempotency-coverage.mjs` sweeps.

## Explicitly out of scope

**Historical rows already mis-filed.** Every after-18:00 record written to date carries the
wrong date. Whether to migrate them, and how a corrected date is represented in an append-only
audit trail, is an owner decision that this spec deliberately does not make. It is a separate
piece of work and should not ride along with the code change.

Also out: changing the venue timezone, making the boundary configurable per location, and
anything that would rewrite an existing `audit_events` row.

## Sequence

1. `serviceDate()` plus its tests and the shared boundary fixture. No callers change. (#617)
2. `lib/auditEvents.ts` alone, with its contract test. (#618)
3. Wave 1 — the seven full-triad surfaces, one commit each, symmetry test per surface.
4. Wave 2 — the four split or one-sided surfaces.
5. Wave 3 — the six write-only routes, together.
6. Wave 4 — `kitchen-assistant` alone.
7. Wave 5 — display defaults, each decided explicitly; plus the 19 inline sites.
8. Native `serviceDate` plus the cross-language parity gate.
9. The coverage sweep that keeps it from regressing.

Each step is independently shippable and independently revertible. No step leaves a surface
with a write default and a read default that disagree.
