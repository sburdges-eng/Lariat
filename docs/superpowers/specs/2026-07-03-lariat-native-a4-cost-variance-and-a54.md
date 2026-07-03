---
title: "spec: native A4 recipe cost-variance card + A5.4 peers/cloud-bridge decision"
date: 2026-07-03
status: approved — A5.4 option B ratified by user 2026-07-03
origin: /spec-plan-tdd — "spec plan for A4/A5/A6" → gap-audit → the two real remaining gaps
supersedes: nothing (A4/A5/A6 otherwise ported; see gap-audit below)
---

# Native A4/A5/A6 — the real remaining gaps

## Gap-audit result (why this spec is small)

A native-main-vs-web audit on 2026-07-03 found **A4/A5/A6 are ~95% ported.**
Present and merged: Costing core, DishCostBridge, MarginDeltas, PriceShocks,
depletion resolver, MenuEngineering, Purchasing (VendorCompare/Link, OrderGuide,
ReceivingMatches), Inventory (counts/par/waste/log), AuditLog, ManagerPins,
TempPins, PerformanceReviews, Host, Floor, Reservations, Booking, Bar, Equipment,
Specials, GoldStars, AllergenLookup, DatapackSearch, Shows/*.

**Two real gaps remain**, addressed by this spec:
1. **A4 — recipe-level cost-variance card** (`computeCostVariance`): a clean,
   in-scope port. (Part 1.)
2. **A5.4 — Peers + cloud-bridge**: a deferral *decision*, not a port. (Part 2.)

Out of the A4-A6 lists but unported (flagged, not specced here): the `/recipes`
browser and the `/admin` config editors (service-hours, cleaning-schedule).

---

# Part 1 — A4 recipe-level cost-variance card

## Goal

Port the web costing page's **recipe-level cost-variance card** to native
`CostingView`, at behaviour parity with `computeCostVariance`
(`lib/costingBenchmarks.mjs:141`). The card summarises per-recipe theoretical-vs-
actual cost variance: **max variance %, mean variance %, count of recipes over
5%, and the top-5 offenders**, with an unmatched-line ratio gate
(`DEFAULT_UNMATCHED_THRESHOLD = 0.30`) that excludes recipes whose BOM can't be
priced. `CostingView.swift:9-11` explicitly records this card as "not ported in
P1a" — native currently shows only the accounting-COGS variance + 28-day trend.

## Non-goals

- No new web-side work; `computeCostVariance` is the read-only source of truth.
- No schema changes — native reads the existing `recipe_costs`, `bom_lines`,
  `vendor_prices`, `ingredient_densities`, `ingredient_unit_weights` tables.
- No re-implementation of pricing primitives already ported (see reuse below) —
  extend, don't duplicate.
- Not the accounting-COGS variance (already ported as `getVarianceTrend`); this
  is the distinct *recipe-level* card.

## User-facing surface

A new section in `CostingView` (below the existing "Section 1: Variance
(accounting COGS)"), rendering the recipe cost-variance card:
- headline stats: **max %**, **mean %**, **# recipes > 5%** (of eligible recipes)
- a **top-5 offenders** list: recipe name + variance %, sorted desc
- an eligibility/coverage note (recipes excluded: yield ≤ 0, theoretical ≤ 0, or
  unmatched-line ratio ≥ 0.30) so an empty/sparse card explains itself rather
  than reading as "no variance".

## Parity source (what to port, exactly)

`computeCostVariance(db, locationId, { unmatchedThreshold = 0.30 })` in
`lib/costingBenchmarks.mjs`:
- Reads `recipe_costs` (cost_per_yield_unit, yield; filters yield > 0, cost NOT
  NULL), `bom_lines`, `vendor_prices` (latest-per-vendor by imported_at desc),
  and the conversion seeds `ingredient_densities` / `ingredient_unit_weights`.
- Prices each recipe's BOM via `resolveMergedCost` (preferred-vendor →
  latest-per-key → mean-across-vendors fallback; unit conversion via density /
  unit-weight; `yield_pct` / `loss_factor` applied), tracking unmatched lines.
- Per recipe: `variance_pct` = (actual − theoretical) / theoretical (confirm sign
  + denominator against source during port); excludes recipes with
  unmatched-ratio ≥ threshold, yield ≤ 0, or theoretical ≤ 0.
- Aggregates the remaining recipes to `{ max, mean, over5pct_count, top5[] }`.

## Native reuse (keeps this MEDIUM, not from-scratch)

Native already ports the pricing building blocks — the port should call these,
not re-hand-roll them:
- `DishCostBridge` (`BridgeRecipeCost`, `BridgeVendorPrice`, `computeDishCost`,
  the vendor-merge + unit-conversion path) — the recipe-pricing primitive.
- `VendorCompareCompute` / `VarianceAttributionCompute` — merged-cost + variance
  patterns already in Swift.
- `CostingRepository` — the existing costing read layer + `CostingBundle` the
  view already consumes; the new card data rides in the same bundle.
- `getVarianceTrend` / `CostingCompute` — the section sits beside these.

**Open question (T1 resolves):** does `DishCostBridge.computeDishCost` produce a
per-recipe theoretical cost that matches `computeCostVariance`'s recipe-level
re-pricing exactly, or is a thin dedicated `recipe_costs × bom_lines ×
vendor_prices` re-pricing needed? T1 is a read-only parity check that decides
whether the compute reuses DishCostBridge or adds a focused re-pricing helper.

## Data model deltas

**None.** All inputs are existing tables; output is an in-memory struct on
`CostingBundle`.

## Invariants

1. **Read-only.** No writes, no audit rows — this is a pure read/compute surface.
2. **Location-scoped.** Every query filters `location_id = ?` (parity with the
   web function's `locationId` arg).
3. **Numeric parity.** Native `max / mean / over5pct_count / top5` match the web
   `computeCostVariance` output for the same DB fixture within float tolerance —
   pinned by a golden-fixture parity test.
4. **Unmatched gate preserved.** The 0.30 unmatched-ratio exclusion and the
   yield/theoretical guards are reproduced exactly; excluded recipes never enter
   the stats.
5. **No empty-state lie.** A sparse/empty card states *why* (coverage note), not
   a bare "no data".

## Testing

- `CostVarianceComputeTests` (LariatModel): golden-fixture parity vs the web
  output — seed `recipe_costs`/`bom_lines`/`vendor_prices`/seeds, assert
  `{max, mean, over5pct_count, top5}` match `computeCostVariance` on the same data
  (mirror an existing web fixture from `tests/js` costing tests).
- Edge cases: all recipes excluded (empty card), a recipe exactly at 5%
  (boundary), unmatched-ratio exactly 0.30 (boundary), single eligible recipe.
- Repository test: the query returns the rows the compute expects.
- `swift build && swift test` green; `git diff --name-status origin/main HEAD`
  confirms scope stays inside `LariatNative/**` (+ this doc).

## Open questions

1. Variance sign/denominator convention — confirm against `computeCostVariance`
   during T1 (some costing surfaces use theoretical as the base, others actual).
2. Whether the card shows a coverage % (eligible / total recipes) — recommend yes
   (matches the "no empty-state lie" invariant); confirm against the web card's
   actual chrome.

---

# Part 2 — A5.4 Peers + cloud-bridge (decision, not a port)

## The surface

Web: `lib/peers.ts`, `lib/peerTrust.ts`, `lib/peerKeypair.ts`;
`app/api/peers/{route, sync-since}`, `app/api/discover/route.js`;
`app/api/cloud-bridge/{status, dead-letters, dead-letters/[id]/{drop,requeue}}`;
`app/management/cloud-bridge/{page, CloudBridgeBoard}.jsx`. Zero native files.

This is a **distributed-systems transport layer**: peer identity/keypair/trust,
peer-to-peer sync-since, mDNS discovery, a cloud relay, and a dead-letter queue
with requeue/drop management + a status board.

## Decision: keep the transport on the Next.js edge; port read/status UI only

The full-replacement roadmap already flags this as the most likely A-phase
edge-blocker and recommends "edge for now." This spec **confirms that decision**:

- **Transport stays on the edge server** (peer keypair/trust, sync-since,
  discovery, cloud relay, dead-letter requeue/drop **writes**). Rationale: it's
  network/crypto/HTTP-replay machinery with no native UI value, it's exactly the
  class of surface Phase D keeps on the edge, and re-implementing peer crypto +
  a replay/dead-letter queue in Swift is high-risk for zero operator-facing gain.
- **Native gets, at most, a read-only CloudBridge *status* view**: bridge
  up/down, last-sync time, dead-letter **count** — reading the same status the
  web `cloud-bridge/status` endpoint exposes, so a manager on the native app can
  *see* sync health without leaving for the web cockpit. The requeue/drop
  *actions* stay on the edge/web.
- **Log it as an edge-blocker** in `lariat-native-edge-blockers.md` (the Phase D
  scope), with this rationale, so it's a recorded decision, not a silent gap.

## Decision — RATIFIED: option B (2026-07-03)

The user ratified **(B) Edge transport + a native read-only status view**: a
`CloudBridgeStatusView` (~one repository read of the status/dead-letter-count,
one view). No writes, no peer crypto — those stay on the edge. Adds native
visibility of sync health. This becomes a second small swift-port task (plan T6),
alongside the blocker-log entry for the transport layer.

(Option A — edge-only with no native UI — was offered and declined.)
