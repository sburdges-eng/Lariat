# Native A4 — Recipe Cost-Variance Card Implementation Plan

> **For agentic workers:** dispatch as ONE `swift-port` task (the roadmap's unit of work) in an isolated worktree, TDD per layer. Steps use checkbox (`- [ ]`) syntax. Read the SPEC first: `docs/superpowers/specs/2026-07-03-lariat-native-a4-cost-variance-and-a54.md`.

**Goal:** Port the web recipe-level cost-variance card (`computeCostVariance`, `lib/costingBenchmarks.mjs:141`) into native `CostingView` at behaviour parity — max %, mean %, # recipes > 5%, top-5 offenders, with the 0.30 unmatched-ratio gate.

**Architecture:** LariatModel compute (parity port, reusing `DishCostBridge` pricing where it matches) → LariatDB repository read (rides the existing `CostingBundle`) → `CostingView` section. Read-only, location-scoped, no schema/web changes.

**Tech Stack:** Swift / SwiftPM (`LariatModel` / `LariatDB` / `LariatApp`), GRDB read layer, `swift test` parity tests against golden fixtures mirrored from the web costing tests.

## Global Constraints (from SPEC + roadmap)

- **Read-only surface** — no writes, no `audit_events`, no schema changes.
- **Location-scoped** — every query filters `location_id = ?`.
- **Numeric parity** — native `{max, mean, over5pct_count, top5}` match `computeCostVariance` on the same fixture within float tolerance (golden test).
- **Reuse, don't duplicate** — call `DishCostBridge` / `CostingRepository` pricing primitives; do not re-hand-roll vendor-merge or unit conversion.
- **No empty-state lie** — sparse/empty card renders a coverage note (why it's empty), never a bare blank.
- **Never edit the web app or `data/lariat.db`; never auto-merge.**

## Scope contract (for the swift-port dispatch)

```
SCOPE CONTRACT
- task: native A4 recipe cost-variance card
- MAY modify: LariatNative/Sources/LariatModel/Compute/**, LariatNative/Sources/LariatModel/*Records*,
              LariatNative/Sources/LariatDB/**, LariatNative/Sources/LariatApp/CostingView.swift,
              LariatNative/Tests/**, this plan/spec doc
- MUST NOT modify: app/** (web), lib/** (web), data/lariat.db, any other native feature area
                   (BEO, inventory writes, shows, etc.)
- MUST NOT implement: the A5.4 CloudBridge status view (separate/optional task),
                      the accounting-COGS variance (already ported)
```

---

### Task T1: Parity check — pick the pricing primitive (read-only, no code)

**Files:** none (investigation → decision recorded in the T2 test header).

- [ ] **Step 1:** Read `computeCostVariance` + `resolveMergedCost` in `lib/costingBenchmarks.mjs` fully; note the exact per-recipe theoretical-cost formula, `variance_pct` sign + denominator, and the unmatched-ratio gate.
- [ ] **Step 2:** Read `DishCostBridge.computeDishCost` + `BridgeRecipeCost`. Decide: does its per-recipe theoretical cost equal `computeCostVariance`'s recipe re-pricing? Record the answer:
  - **Reusable** → T2 computes variance from `DishCostBridge` output.
  - **Not exact** → T2 adds a focused `recipe_costs × bom_lines × vendor_prices` re-pricing helper in `CostingCompute`, reusing the existing unit-conversion + vendor-merge Swift utilities (do NOT re-port them).
- [ ] **Step 3:** Pick a web golden fixture to mirror (from `tests/js` costing/benchmark tests) — the input DB rows + expected `{max, mean, over5pct_count, top5}`.

### Task T2: `CostVarianceCompute` in LariatModel (TDD parity)

**Files:**
- Create/extend: `LariatNative/Sources/LariatModel/Compute/CostVarianceCompute.swift` (or extend `CostingCompute`)
- Test: `LariatNative/Tests/LariatModelTests/CostVarianceComputeTests.swift`

**Interfaces:**
- Produces: `struct RecipeCostVariance { max: Double; mean: Double; over5pctCount: Int; eligibleCount: Int; topOffenders: [(name: String, variancePct: Double)] }` and `static func computeCostVariance(recipes:, bomLines:, vendorPrices:, densities:, unitWeights:, unmatchedThreshold: Double = 0.30) -> RecipeCostVariance`.

- [ ] **Step 1:** Write the failing golden-parity test — seed the T1 fixture rows, assert `{max, mean, over5pctCount, topOffenders}` equal the web expected values within `1e-6`.
- [ ] **Step 2:** Run `swift test --filter CostVarianceComputeTests` → FAIL (symbol undefined / values mismatch).
- [ ] **Step 3:** Implement `computeCostVariance` per T1's decision (reuse DishCostBridge pricing or the focused re-pricing helper); apply the unmatched-ratio gate + yield/theoretical exclusions; aggregate max/mean/over5pct/top5.
- [ ] **Step 4:** Run `swift test --filter CostVarianceComputeTests` → PASS.
- [ ] **Step 5:** Add boundary tests (all excluded → empty; recipe exactly at 5%; unmatched-ratio exactly 0.30; single eligible) → PASS.
- [ ] **Step 6:** Commit `T2: native recipe cost-variance compute (parity with computeCostVariance)`.

### Task T3: Repository read + `CostingBundle` wiring

**Files:**
- Modify: `LariatNative/Sources/LariatDB/CostingRepository.swift` (+ `CostingBundle`)
- Test: `LariatNative/Tests/LariatDBTests/CostingRepository*Tests.swift`

- [ ] **Step 1:** Write a failing repository test: seed a temp DB with `recipe_costs`/`bom_lines`/`vendor_prices`/seed tables, call the new bundle load, assert it carries a populated `RecipeCostVariance`.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Add the location-scoped reads (matching the web SQL) + feed `CostVarianceCompute`; attach `recipeCostVariance` to `CostingBundle`.
- [ ] **Step 4:** Run the repo test → PASS.
- [ ] **Step 5:** Commit `T3: cost-variance rides CostingBundle (location-scoped read)`.

### Task T4: `CostingView` section + wire

**Files:**
- Modify: `LariatNative/Sources/LariatApp/CostingView.swift` (add the section; remove the "not ported in P1a" note at lines 9-11)

- [ ] **Step 1:** Add a "Recipe cost variance" section below the accounting-COGS section: max % / mean % / # over 5% stat row + top-5 offenders list + coverage note (eligible/total). Bind to `bundle.recipeCostVariance`.
- [ ] **Step 2:** Update the header comment (delete the "not ported in P1a" lines — it's now ported).
- [ ] **Step 3:** `swift build` → clean.
- [ ] **Step 4:** Commit `T4: render recipe cost-variance card in CostingView`.

### Task T5: Verify + scope-confirm

- [ ] **Step 1:** `swift build && swift test` (full) → all green; capture the count.
- [ ] **Step 2:** `git diff --name-status origin/main HEAD` → confirm only `LariatNative/**` + the spec/plan docs changed (scope contract held).
- [ ] **Step 3:** Open a PR (SPEC + PLAN links, parity-test evidence, full `swift test` count). Do NOT auto-merge.

---

## Task T6 (A5.4 option B — RATIFIED 2026-07-03): CloudBridge status view

Dispatched as a **second** swift-port task in its own worktree (separate feature
area; A0 self-registration keeps it conflict-free with T1-T5).

**Files:** `LariatNative/Sources/LariatDB/CloudBridgeStatusRepository.swift`, `LariatNative/Sources/LariatApp/CloudBridgeStatusView.swift`, tests.

- [ ] Read-only: bridge up/down + last-sync + dead-letter **count**, parity with `app/api/cloud-bridge/status`. **No** requeue/drop actions, **no** peer crypto (those stay on the edge). Register via the A0 FeatureRegistry. TDD repo parity test. Also append the edge-blocker entry to `lariat-native-edge-blockers.md`.

## Self-Review

**Spec coverage:** cost-variance compute (T2) ✓, repo/bundle (T3) ✓, view section + un-defer (T4) ✓, parity + boundary tests (T2/T3) ✓, reuse-not-duplicate (T1 decision + Global Constraints) ✓, read-only/location-scoped/no-empty-lie invariants (Global Constraints + T4 coverage note) ✓, A5.4 decision (T6 optional + blocker log) ✓. **Placeholders:** none — the one genuine unknown (reuse DishCostBridge vs focused re-pricing) is an explicit T1 decision gate, not a hidden TODO. **Type consistency:** `RecipeCostVariance` / `computeCostVariance` names used identically across T2/T3/T4.
