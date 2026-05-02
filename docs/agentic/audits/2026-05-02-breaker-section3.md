# Breaker Audit — 2026-05-02 — Section 3

**Section covered:** 3 — Location scoping.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** fresh (reindexed at the start of the prior session, 16,026 nodes / 24,519 edges).

---

## Method

Six-prong checklist applied to:
- `lib/location.ts` — the canonical helper module
- Every `app/api/**/route.{js,ts}` for location_id derivation
- Cross-checked against `docs/PATTERNS.md §4` (the binding rule)

The prior PR-review findings (#96 had a CRITICAL hardcode of `loc = DEFAULT_LOCATION_ID` in `app/management/page.jsx`) primed the search. The audit looked specifically for:

1. Routes deriving location from cookie / header / session (forbidden)
2. Routes hardcoding `'default'` instead of using the helper
3. Routes accepting `body.location_id` or `?location=` directly without trim/alias handling
4. Inconsistent fall-through patterns between body and query

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P2** | Four `/api/equipment/*` routes bypass `lib/location.ts` — they read `searchParams.get('location_id')` directly and don't honor the `?location=` alias or whitespace trim. Multi-site deploys using the canonical alias get all equipment data silently scoped to `'default'`. [Full record](findings/2026-05-02-equipment-routes-bypass-location-helpers.md). |
| 2 | **P2** | `locFromBody !== 'default' ? locFromBody : locFromReq` ternary in three routes (`/api/specials`, `/api/specials/saved`, `/api/kitchen-assistant`) conflates "body explicitly said `'default'`" with "body said nothing", causing a wrong-location write when both a body and a query are present. [Full record](findings/2026-05-02-locFromBody-default-fallthrough-ambiguity.md). |

No P0, P1, or P3 findings this pass.

---

## Verified-correct surfaces

- **`lib/location.ts`** — both helpers handle the `location` / `location_id` aliases and trim whitespace. Returns `DEFAULT_LOCATION_ID` consistently on missing/empty input.
- **HACCP routes** (breaks, sick-worker, pest, sds, thermometer-calibrations, etc.) — all use `locationFromBody`/`locationFromRequest` consistently. The `|| DEFAULT_LOCATION_ID` fallback they sometimes append is dead code (the helper already returns `DEFAULT_LOCATION_ID`) but not a behavior bug.
- **Phase 2 routes** (`shows/[id]/*`, `specials/saved/*`) — use the helpers correctly. Specials' default-fallthrough ternary is a separate concern (finding #2).
- **`#96 management rollup`** (just merged) — the location hardcoded to `DEFAULT_LOCATION_ID` was patched in the merged version. Verified `app/management/page.jsx` now derives from `searchParams.location`.
- **`#108 PIN defense-in-depth`** (in flight) — the 10 patched routes do NOT introduce new location-derivation bugs. compute/status was changed from `searchParams.get('location') || 'default'` (already non-canonical) to the same shape; both pre and post the PR are technically a Section 3 finding for compute/status, but it's a single-line cleanup and can ride a follow-up location-scoping fix PR.

---

## Test gaps surfaced

- **No `tests/js/test-equipment-location-scoping.mjs`.** Equipment surface lacks a regression test that scopes a write to `?location=X` and reads it back via the same query. Pair with finding #1's fix.
- **No `tests/js/test-location-helpers-default-fallthrough.mjs`.** The three-site ternary pattern is uncovered. Add a test that POSTs `body: { location_id: 'default' }` AND `?location=X`, asserts the row writes under `'default'` (per finding #2's expected behavior).

---

## Recommended next moves

1. **Fix finding #1** — single PR replaces 8 derivation sites in `app/api/equipment/*` with helper calls + adds a regression test.
2. **Fix finding #2** — single PR. Two paths: either inline the explicit body-key-present check at the three call sites, or hoist `locationFromBodyOrRequest` to `lib/location.ts` and call it. The hoist is a contract-hardening refactor per `REFACTOR_GOVERNANCE.md`; if you go that way, it should be its own PR before the call-site fix lands.
3. **Section 4 (costing/inventory/vendor history/unit parity) next.** Highest-leverage remaining section because it touches the financial computation pipeline. The reindexed GitNexus graph supports the call-graph reach prong here too.

---

## Stop conditions hit

None. Section 3 sweep completed. Two P2 findings, no P0/P1.

---

## Workflow notes

- The "call-graph reach" prong — using `mcp__gitnexus__query` against a freshly-reindexed graph — was the right move; the equipment-route bypass surfaced from a single grep but the locFromBody ternary required cross-route correlation that the graph supports better than ad-hoc grep.
- Findings #1 and #2 share a structural root: routes that re-implement what `lib/location.ts` already handles. Worth a one-line addition to `BREAKER_AUDIT.md §2` Section 3 row: "and any route that does its own searchParams/body parsing instead of using the helpers."
