# Service-worker replay idempotency — implementation plan

> **STATUS: SHIPPED (verified 2026-06-15 reconciliation) — `withIdempotency` wrapper + schema + coverage test + Phase 2 client activation; tests pass.**

**Spec:** [`docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md`](../specs/2026-05-02-sw-replay-idempotency-design.md)

**TDD shape:** Each task is failing-test-first → minimal implementation → green → commit. Each task ships as its own PR; the next task starts from the merged base.

---

## Task 1 — Schema + wrapper kit (no callers yet)

**Branch:** `feat/idempotency-schema-and-wrapper`

**Files created:**
- `lib/db.ts` — new `idempotency_keys` migration in the existing `migrateLegacyColumns` block (alongside #113's `idx_box_office_external_ref_unique`)
- `lib/idempotency.ts` — `withIdempotency(req, handler)` + the request-hash helper + the lazy-TTL sweep
- `lib/clientFetch.ts` — thin client wrapper that injects an `idempotency-key` header on `idempotent: true`
- `tests/js/test-idempotency-wrapper.mjs` — three contract tests:
  1. No `idempotency-key` header → handler called once, response passes through.
  2. New key → handler called, response cached in `idempotency_keys`.
  3. Same key + same request hash → handler NOT called, cached response returned.
  4. Same key + different request hash → 409 "idempotency-key reused for a different request".
  5. Key older than 24h → swept; treated as fresh.

**Acceptance:**
- `tests/js/test-idempotency-wrapper.mjs` 5/5 pass
- `npm run test:schema` 45/45 pass (migration is idempotent + additive)
- `npx tsc --noEmit` clean

**No route is opted in yet.** Strictly the kit. ~150 lines + ~150 test lines.

---

## Task 2 — Retrofit signoff + box-office line write

**Branch:** `feat/idempotency-retrofit-signoff-box-office`

**Why these first:** Highest blast radius — signoff is regulated CCP attestation (just gained DB audit in #103); box-office line write is cash custody (Section 5 finding pair).

**Files modified:**
- `app/api/signoff/route.js` — wrap the existing handler body in `withIdempotency`
- `app/api/shows/[id]/box-office/route.js` (POST) — same
- The two client-side surfaces that POST to these routes — switch from bare `fetch` to `clientFetch({ idempotent: true })`
- `tests/js/test-signoff-audit-atomicity.mjs` — extend with idempotency case (POST same key twice → one row, one audit, two 200 responses with identical body)
- `tests/js/test-box-office-repo.mjs` (or `test-box-office-route.mjs` if it exists) — same
- `tests/e2e/offline-queue.spec.ts:83` — un-skip ONLY the signoff + box-office paths in the round-trip test

**Acceptance:**
- All four test files pass
- e2e round-trip for signoff + box-office green; replays show exactly one row written
- No regression on `node --test tests/js/test-bundle-h-apis.mjs` (the broader signoff coverage)

---

## Task 3 — Retrofit temp-log + receiving

**Branch:** `feat/idempotency-retrofit-temp-log-receiving`

**Why these next:** Highest-volume regulated routes (every shift, every delivery).

**Files modified:**
- `app/api/temp-log/route.js`
- `app/api/receiving/route.js`
- Their two client surfaces
- `tests/js/test-haccp-audit-atomicity.mjs` — extend with idempotency case for both routes
- `tests/e2e/offline-queue.spec.ts` — un-skip those two paths

**Acceptance:** Same shape as Task 2.

---

## Task 4 — Coverage test + bulk retrofit

**Branch:** `feat/idempotency-coverage-and-bulk-retrofit`

**The coverage test** (`tests/js/test-idempotency-coverage.mjs`) walks every `route.{js,ts}` under `app/api/**`, parses the file, and asserts that every exported `POST` / `PUT` / `PATCH` / `DELETE` handler that writes to a regulated table calls `withIdempotency`. Static check via `grep` + AST-light parsing — same shape as the proposed `test-ui-copy-rules.mjs` from §7.

**Failing-first** — the test fires, identifies the un-retrofitted routes, then the test acts as the punch list. Bulk-retrofit:

- `app/api/cooling/route.js`
- `app/api/sanitizer/route.ts`
- `app/api/date-marks/route.js`
- `app/api/sick-worker/route.js`
- `app/api/breaks/route.js`
- `app/api/eighty-six/route.js`
- `app/api/inventory/route.js`
- `app/api/inventory/counts/route.js`
- `app/api/inventory/par/route.js`
- `app/api/preshift-notes/route.ts`
- `app/api/pest/route.ts`
- `app/api/sds/route.ts`
- `app/api/thermometer-calibrations/route.js`
- `app/api/reservations/route.js` + `[id]/route.js`
- `app/api/dining-tables/route.js` + `[id]/route.js`
- `app/api/prep-tasks/[id]/route.js`
- `app/api/gold-stars/route.ts`
- `app/api/specials/saved/[id]/route.js`
- `app/api/shows/[id]/{deal,settlement,sound,sound/[sceneId],stage,box-office/[lineId]}/route.js`

(Subject to the test's actual list — the test surfaces the truth.)

**Acceptance:**
- `tests/js/test-idempotency-coverage.mjs` green
- Full e2e suite green (un-skip the rest of `offline-queue.spec.ts`)
- No regression in any existing route test

---

## Cross-task notes

- Each task is a single logical PR. Force-push wall (denied `--force-with-lease`) means each PR's branch is base = main-at-merge-time-of-prior-task.
- The wrapper is opt-in via function call — un-retrofitted routes keep working unchanged. This is the safety property that lets us stage.
- Audit-event invariants per `docs/PATTERNS.md §3` are preserved: `withIdempotency` runs OUTSIDE the handler's `db.transaction` (the cache table write is its own statement after the handler returns); the handler's audit posting still fires inside its own tx as today.
- Cache-hit path returns the cached response **without** calling the handler — meaning no second audit row, which is the desired behavior (one mutation, one audit row, even on replay).

## Stop conditions (per task)

Abort task and re-scope if any of these come up:

- Migration introduces a column rename or table drop on existing data.
- The wrapper changes the audit transaction boundary.
- The wrapper changes any PIN-gate behavior.
- A retrofit accidentally bypasses an existing `requirePin()` gate.

## Estimated effort

- Task 1: 1–2 hours (kit + tests)
- Task 2: 1–2 hours (2 routes + 2 client surfaces + e2e un-skip)
- Task 3: 1–2 hours (same shape)
- Task 4: 2–3 hours (coverage test + ~15 route retrofits)

Total: 5–9 hours across 4 PRs. Can be paused mid-plan; each task ships independently.

---

## Phase 2 — client activation (closed)

Tasks 1–4 above shipped the server-side wrapper, schema, coverage gate, and the 48-route `TODO_RETROFIT` allowlist. They also shipped `lib/clientFetch.ts` with an opt-in `idempotent: true` flag — but **no cockpit surface ever opted in**. The wrapper saw no `idempotency-key` header on any iPad submission and fell through to "case 1: no header" (handler runs unchanged, nothing cached). Phase 2 closes that dormancy gap by migrating the 4 wrapped routes' iPad cockpit callers to `clientFetch({ idempotent: true })`:

- `8ecc20f feat(idempotency): activate clientFetch on ReceivingBoard (Phase 2 #1)` — `app/food-safety/receiving/ReceivingBoard.jsx`. Also pins the clientFetch contract in `tests/js/test-clientFetch.mjs` (header injection, opt-in shape, fresh key per call, caller-override respected).
- `4f5522a feat(idempotency): activate clientFetch on TempLogBoard (Phase 2 #2)` — `app/food-safety/temp-log/TempLogBoard.jsx`. Adds two route-level dedup tests to `tests/js/test-temp-log-api.mjs` (same key → 1 temp_log + 1 audit_events, different keys → 2 + 2).
- `beaa568 feat(idempotency): activate clientFetch on StationChecklist (Phase 2 #3)` — `app/stations/[id]/StationChecklist.tsx`. Signoff dedup contract was already pinned by `tests/js/test-signoff-audit-atomicity.mjs` (PR #119).
- `f0666a9 feat(idempotency): activate clientFetch on BoxOfficeBoard (Phase 2 #4)` — `app/shows/[id]/box-office/BoxOfficeBoard.jsx`. Touches only the `POST /api/shows/[id]/box-office` caller; the per-line PATCH at line 93 hits `[lineId]` which is in `TODO_RETROFIT` and stays bare. Box-office dedup contract was pinned by `tests/js/test-box-office-route-idempotency.mjs` (PR #119).

### Phase 2 e2e — deliberately not added

The original spec called for a Playwright test that drives the full offline → SW queue → online → replay round-trip and asserts the server dedups. That test is **not feasible under the current Playwright harness**: `context.setOffline()` does not block service-worker–initiated fetches, which is the same limitation that already caused `tests/e2e/offline-queue.spec.ts:80-83` to leave its full-round-trip case as `test.skip(... 'manual only')`. The dormancy property is instead proven by the chain:

1. **Client emits the header.** `tests/js/test-clientFetch.mjs` (4 cases).
2. **SW preserves the header verbatim through queue serialization.** `public/sw.js:106-107` captures every header into the IndexedDB row; `public/sw.js:131-135` replays with those exact headers. The round-trip property is structural, not stateful — no cache TTL, no header rewriting.
3. **Server dedups identical-key requests.** `tests/js/test-idempotency-wrapper.mjs` (5 cases) + `tests/js/test-temp-log-api.mjs` (2 new) + `tests/js/test-signoff-audit-atomicity.mjs` (3) + `tests/js/test-box-office-route-idempotency.mjs` (5).

Manual verification on an iPad (per `OPERATIONS.md`): submit, kill wifi, submit again, restore wifi — DB shows one row per real action.

## Phase 3 — HACCP retrofit (deferred)

Wrap the 9 HACCP rule-module routes still in `TODO_RETROFIT`: `cooling`, `sanitizer`, `sds`, `pest`, `sick-worker`, `date-marks`, `tphc`, `cleaning`, `thermometer-calibrations`. Each writes `audit_events` per POST → duplicate replay = duplicate HACCP attestation. Same regulatory weight as Phase 2; lands as its own plan.

## Phase 4 — operational drain (deferred)

Remaining 39 entries in `TODO_RETROFIT` (event-ops Phase 2 subroutes, dining/reservations, inventory, prep, equipment, eighty-six, breaks/certs, recipes, specials, costing pack-changes, compute/status). Lower regulatory weight; lands as its own plan.
