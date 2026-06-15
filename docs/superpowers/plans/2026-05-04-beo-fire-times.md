# PLAN: BEO course fire-times + per-station rollup + temp PINs

> **STATUS: SHIPPED (verified 2026-06-15 reconciliation) — all 10 tasks: temp-PIN subsystem (routes + HMAC cookie), BEO course model + CRUD, fire-schedule rollup, prep UI with audio/visual cues, management temp-PIN UI; tests pass. (Supersedes the "awaiting approval" line below.)**

**Spec:** `docs/superpowers/specs/2026-05-04-beo-fire-times.md`
**Status:** ~~awaiting approval (skill: spec-plan-tdd, step 3/5)~~ → SHIPPED (see top header)
**Execution worktree (to be created on approval):** `Lariat-worktrees/claude-beo-fire-times` (branch `feat/beo-fire-times`)
**Commit convention:** `T<n>: <one-line summary>` per skill rule

---

## Phase summary

| Phase | Tasks | Independence |
|---|---|---|
| A — Temp PIN subsystem | T1, T2, T3 | Independently shippable. Could land alone. |
| B — BEO course model | T4, T5, T6 | Depends on A only for T5/T6 PIN-gating (defer-able to master-PIN-only first). |
| C — Tonight rollup | T7, T8, T9 | Depends on B. |
| D — Temp-PIN management UI | T10 | Depends on A. |

If you want to peel phases off (e.g. ship A independently first, then ship B+C+D as a second PR), tell me at approval and I'll structure the worktrees / PRs accordingly.

---

## Tasks

### T1 — Temp PIN schema + pure module

**Goal:** Append `temp_pins` table to `initFoodSafetyLaborSchema`. Create `lib/tempPin.ts` with pure helpers: `hashPin`, `validatePinFormat`, `isExpired`, `hasScope`, `parseScopes`. No I/O.

**MAY modify:**
- `lib/db.ts` (append-only inside `initFoodSafetyLaborSchema`)
- `lib/tempPin.ts` (new)
- `tests/js/test-temp-pin-rules.mjs` (new)

**MUST NOT modify:**
- `lib/pin.ts` (T3)
- Anything in `app/api/auth/`
- Existing audit-event modules

**Acceptance:**
- `node --experimental-strip-types --test tests/js/test-temp-pin-rules.mjs` — green
- `npm run test:schema` — 45/45 pass + new schema row
- `npm run typecheck` — clean

**Dependencies:** none.

---

### T2 — Temp PIN issue/list/revoke/login API routes

**Goal:** Four POST/GET routes under `app/api/auth/temp-pin/`. `issue`, `list`, `revoke` require master-PIN cookie. `login` accepts the raw temp PIN, validates against `temp_pins`, sets `lariat_temp_pin_ok` cookie (HMAC-signed via existing `lib/pinCookie`). All routes wrapped in `withIdempotency` per `docs/PATTERNS.md` and emit `audit_events` rows in the same tx.

**MAY modify:**
- `app/api/auth/temp-pin/issue/route.js` (new)
- `app/api/auth/temp-pin/list/route.js` (new)
- `app/api/auth/temp-pin/revoke/route.js` (new)
- `app/api/auth/temp-pin/login/route.js` (new)
- `lib/tempPinCookie.ts` (new — HMAC helpers, mirrors `lib/pinCookie`)
- `tests/js/test-temp-pin-routes.mjs` (new)

**MUST NOT modify:**
- `lib/pin.ts` (T3)
- `lib/pinCookie.ts` (existing master-PIN cookie helpers — extend via parallel module, don't edit)
- `middleware.js`
- Any `app/api/beo/*`

**Acceptance:**
- `node --experimental-strip-types --test tests/js/test-temp-pin-routes.mjs` — covers happy path, expiry rejection, revocation rejection, scope mismatch rejection, idempotent replay, audit-row-in-tx atomicity
- `npm run typecheck` — clean

**Dependencies:** T1.

---

### T3 — Extend lib/pin.ts with hasPinOrTempPin

**Goal:** Add `hasPinOrTempPin(req, scope)` that returns true if either the master PIN cookie is valid OR a `lariat_temp_pin_ok` cookie validates against `temp_pins` (active + scope match). Existing `hasPinCookie` unchanged.

**MAY modify:**
- `lib/pin.ts` (additive only — new export, no edit to existing functions)
- `tests/js/test-pin-gate.mjs` (new — covers both cookie paths)

**MUST NOT modify:**
- Existing route handlers (no consumer migration in this task)
- `middleware.js`

**Acceptance:**
- `node --experimental-strip-types --test tests/js/test-pin-gate.mjs` — green
- `npm run typecheck` — clean

**Dependencies:** T1, T2.

---

### T4 — BEO course schema migration

**Goal:** Append `beo_courses` table + `course_id` column on `beo_line_items` to schema. Append-only — no edits to existing DDL.

**MAY modify:**
- `lib/db.ts` (additions inside `initFoodSafetyLaborSchema` + `migrateLegacyColumns` for the ALTER on `beo_line_items`)

**MUST NOT modify:**
- Existing `beo_*` table definitions
- `assertCriticalSchemas` requirements (no entries needed — new tables, optional FK)

**Acceptance:**
- `npm run test:schema` — 45/45 pass + new row for `beo_courses`
- `npm run typecheck` — clean

**Dependencies:** none.

---

### T5 — lib/beoCourses.ts + course CRUD API

**Goal:** Pure module `lib/beoCourses.ts` (validation, sort_order resolution). New `app/api/beo/courses/route.js` (POST create/upsert) and `app/api/beo/courses/[id]/route.js` (DELETE + PATCH). Extends existing `app/api/beo/route.js` PATCH path on `beo_line_items` to accept `course_id`. All gated via `hasPinOrTempPin(req, 'beo.fire_at_edit')` — temp-PIN scope works.

**MAY modify:**
- `lib/beoCourses.ts` (new)
- `app/api/beo/courses/route.js` (new)
- `app/api/beo/courses/[id]/route.js` (new)
- `app/api/beo/route.js` (only the line-item PATCH path; no other handler edits)
- `tests/js/test-beo-courses-rules.mjs` (new)
- `tests/js/test-beo-courses-api.mjs` (new)

**MUST NOT modify:**
- `app/beo/BeoBoard.jsx` (T6)
- Other `tests/js/test-beo-*.mjs` files (existing BEO behavior must not change)
- `lib/beoPrepHistory.ts`

**Acceptance:**
- All new tests green
- `npm run test:rules` — still 370/370 (no regression on existing BEO)
- `node --experimental-strip-types --test tests/js/test-beo-*.mjs` — all green incl. existing 8
- `npm run typecheck` — clean

**Dependencies:** T3, T4.

---

### T6 — BeoBoard.jsx course assignment UI

**Goal:** Add "Course" dropdown to existing line-item rows + "Add course" button per event. Calls T5's API. Uses kitchen-native copy per `docs/UI_COPY_RULES.md` ("course" is acceptable kitchen jargon; keep verb labels short: "Add course", "Save", "Done").

**MAY modify:**
- `app/beo/BeoBoard.jsx`
- `app/beo/_components/CourseEditor.jsx` (new — extracted helper if BeoBoard grows past 400 lines)
- `app/__tests__/BeoBoard.course.test.jsx` (new — Jest/jsdom)

**MUST NOT modify:**
- `app/beo/page.jsx`
- `app/beo/PrepHistoryPanel.jsx`
- API routes (T5 owns those)

**Acceptance:**
- `npm run test:unit` — all green incl. new test
- Manual smoke: dev server, add a course on an existing event, assign 2 line items, refresh, persistence verified

**Dependencies:** T5.

---

### T7 — Tonight rollup endpoint + lib/beoFireSchedule.ts

**Goal:** GET `/api/beo/fire-schedule?date=&location=` returns the per-station tonight rollup payload from the SPEC §"Example". Pure resolver `lib/beoFireSchedule.ts::resolveSchedule(courses, lineItems, dishComponents, now)` returns the grouped+sorted shape with no I/O. Route is unauthenticated (matches `/api/kds/tickets`). Joins courses → line_items → dish_components for station; lines without a station_id collapse into a `station_id: 'unassigned'` bucket so they don't disappear.

**Open recon question:** confirm `dish_components.station_id` exists. If not, the fallback is to require an explicit station per line in T6 — handle at task start.

**MAY modify:**
- `lib/beoFireSchedule.ts` (new)
- `app/api/beo/fire-schedule/route.js` (new)
- `tests/js/test-beo-fire-schedule-rules.mjs` (new)
- `tests/js/test-beo-fire-schedule-api.mjs` (new)

**MUST NOT modify:**
- `app/api/beo/route.js`
- `lib/beoCourses.ts`
- Anything in `app/prep/` (T8)

**Acceptance:**
- All new tests green; covers empty-day, multi-event multi-station case, unassigned-station bucket, ordering by `fire_at`, age-bucketing helper
- `npm run typecheck` — clean

**Dependencies:** T4, T5.

---

### T8 — Fire-schedule page with audio/visual cues

**Goal:** New page `app/prep/fire-schedule/page.jsx` that polls T7's endpoint every 15s, lays out per-station columns, color-codes cards by age (green > 30min away, yellow ≤30min, red on/past), plays a 440Hz tone via Web Audio API once per course at fire_at, and pulses the card background red for 5s. "Ack" button per card suppresses the cue locally (in-memory Set keyed on course id).

**MAY modify:**
- `app/prep/fire-schedule/page.jsx` (new)
- `app/prep/fire-schedule/_components/StationColumn.jsx` (new)
- `app/prep/fire-schedule/_components/CourseCard.jsx` (new)
- `app/prep/fire-schedule/_lib/useFireCue.ts` (new — Web Audio hook)
- `app/__tests__/FireSchedule.test.jsx` (new — Jest/jsdom; mock Web Audio)

**MUST NOT modify:**
- `app/prep/page.jsx` (T9)
- API routes
- Anything in `app/beo/`

**Acceptance:**
- `npm run test:unit` — all green incl. new test (cue fires once per course, ack suppresses, age coloring buckets are correct on synthetic timestamps)
- Manual smoke: dev server, set a course fire_at to "now+30s", confirm tone plays + card pulses

**Dependencies:** T7.

---

### T9 — Hub tile + nav-registry entry

**Goal:** Register `/prep/fire-schedule` in `app/_components/navRegistry.js` so the command palette and sidebar pick it up. Add a tile to `app/prep/page.jsx`.

**MAY modify:**
- `app/_components/navRegistry.js` (one entry)
- `app/prep/page.jsx` (one tile)

**MUST NOT modify:**
- Anything in `app/prep/fire-schedule/`
- Other nav entries

**Acceptance:**
- `npm run test:unit` — all green
- Manual: nav tile renders, click navigates, palette finds "fire schedule"

**Dependencies:** T8.

---

### T10 — Temp-PIN management UI

**Goal:** New page `app/management/temp-pins/page.jsx`. Manager-only (master PIN cookie required by middleware — `/management` is already gated per `docs/ARCHITECTURE.md §4`). Issue form (label, expires_at, scopes), shows the new PIN ONCE on success, lists active temp PINs with revoke button.

**MAY modify:**
- `app/management/temp-pins/page.jsx` (new)
- `app/management/temp-pins/_components/IssueForm.jsx` (new)
- `app/management/temp-pins/_components/ActiveList.jsx` (new)
- `app/_components/navRegistry.js` (one entry, additive)
- `app/__tests__/TempPins.test.jsx` (new)

**MUST NOT modify:**
- API routes (T2 owns them)
- `middleware.js`
- `app/management/page.jsx` (the page already lists everything in `/management/*` automatically via `navRegistry`)

**Acceptance:**
- `npm run test:unit` — all green incl. new test (form submission, PIN-shown-once, list rendering, revoke confirmation)
- Manual: dev server, log in with master PIN, issue a temp PIN, log out, log in with the temp PIN at `/login-pin`, attempt a `beo.fire_at_edit` action — should pass

**Dependencies:** T2, T3.

---

## Test gate at end (step 5 of skill — verification-before-completion)

Before opening the PR:

```bash
npm run typecheck                       # tsc --noEmit, must be clean
npm run test:rules                      # all 370+ HACCP rule tests
npm run test:schema                     # migration idempotency + assertCriticalSchemas
npm run test:unit                       # Jest jsdom (BeoBoard, FireSchedule, TempPins)
node --experimental-strip-types --test tests/js/test-temp-pin-*.mjs
node --experimental-strip-types --test tests/js/test-beo-*.mjs
node --experimental-strip-types --test tests/js/test-pin-gate.mjs
npm run build                           # next build — catches route-handler signature drift
```

All green = ready to open PR. Any red = stop, no PR.

## Out-of-scope drive-by temptations (resist)

- Refactoring the existing `beo_line_items.order_time` column. It overlaps semantically with `fire_at` but is per-line, used elsewhere, and removing it would explode this PR.
- Cleaning up the prepared-statement cache pattern in `app/api/beo/route.js` (`_getStatementCache` WeakMap). Tempting because we'll be in the file. Don't.
- Backfilling `course_id` on existing `beo_line_items` rows. They stay NULL by design; operators course-up new events going forward.
- Adding a "duplicate course" or "copy from previous event" UX affordance. Phase 2.
- Wiring the audio cue to a configurable sound file. Spec §"Open question 2" — 440Hz tone in v1.

## Risks I'm tracking

| Risk | Mitigation |
|---|---|
| `dish_components.station_id` may not exist | T7 has explicit recon-first step; falls back to per-line station if needed |
| Browser autoplay policy blocks Web Audio without user gesture | T8 uses a "tap-to-enable-sound" affordance on first page load (matches HTML5 audio convention) |
| Master-PIN env-var deployments without `LARIAT_PIN` set | `pinRequiredForPic()` returns false, gates pass through — temp PINs degrade gracefully (issuance forbidden when no master PIN, but rollup view still works) |
| Time zones | All `fire_at` stored UTC, displayed in browser local time. No tz column. Operators in one venue = one tz. |
| GitNexus stale during the run | Index re-analyzes after each commit via PostToolUse hook (currently writable on main worktree); flag if read-only mode resumes |
