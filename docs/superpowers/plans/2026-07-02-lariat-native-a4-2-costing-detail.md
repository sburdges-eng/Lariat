# LariatNative A4.2 — Costing-detail Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the five web costing-detail surfaces — price-shocks, single-SKU price-history, variance-attribution, depletion-exceptions, ingredient-masters — into LariatNative under a new `.costing` tier, at behavior parity with the Next.js routes.

**Architecture:** Standard three-layer port — `LariatModel` (pure `Compute/` + `FetchableRecord` rows), `LariatDB` (GRDB repositories over the web-owned shared `lariat.db`; **no migration**), `LariatApp` (SwiftUI `View` + `@Observable` `ViewModel`, A0 self-registration). Four boards are pure reads; **ingredient-masters** carries the wave's one audited write.

**Tech Stack:** SwiftPM, Swift 6, SwiftUI (macOS), GRDB, XCTest.

## Global Constraints

- **Money is `Double` dollars, NOT Int cents** for this wave — every table is `REAL` dollars; the web rounds for display/comparison only. Mirror the web's `Double` + the **exact** `Math.round` call per rule (e.g. `Math.round(pct*10)/10`, `Math.round(x*100)/100`). JS `Math.round` = `floor(x+0.5)` (Swift `.rounded()` differs on negative ties) — reuse the `floor(x+0.5)` helper pattern from `InventoryShrinkage` where a tie is reachable. Do NOT introduce a cents-Int type.
- **No native migration.** Port against the existing shared `lariat.db` schema; only test fixtures `CREATE` tables (mirror the real DDL columns).
- **Tier (locked):** new `FeatureTier.costing = "Costing"`; ALL boards register under `.costing`; the existing `manager.costing` aggregate is relocated to `costing.overview`.
- **`costing.prices` is a drill-down** from the Price Shocks board (tap a shock row → `PriceHistoryView` via selection state) — NOT its own `FeatureCatalog` descriptor / sidebar tile.
- **Reads are not per-view PIN-gated** in native (the web gates `/costing` via middleware; native manager-tier reads don't gate today). No PIN sheet on the 4 read boards.
- **The one write** (ingredient-masters MarkReviewed/edit): audited via `AuditedWriteRunner.perform { db in UPDATE…; AuditEventWriter.post(db,…) }` in ONE transaction, `action = .correction`, `actor_source = native_mac` (assert — deliberate divergence from web `manager_ui`); rule-failure (`validateMasterUpdates`) throws BEFORE the audit post; **no idempotency** layer (deferred).
- **`variance-attribution` route has no in-route PIN** (middleware-only) — a divergence from the other four routes; note it.
- **`normalize_dish_name`** (variance unresolved-depletions join): normalize in Swift + filter in memory (`MarginDeltasRepository` precedent), not a GRDB custom SQLite function.
- **A0 registration** = one `FeatureDescriptor`, one `FeatureModule`, one `FeatureRegistry.all` line, one `FeatureRegistryTests` assertion; a new tier is one `FeatureTier` case.
- **Verify** from `LariatNative/`: `swift build && swift test` (both green — build does not compile test targets). Commit gate: branch `feat/*`, lint + `tsc` run on commit (Swift-only commits pass trivially). No `--no-verify`.
- **Layer order per board:** `LariatModel` (Compute + Records, value-parity tests first) → `LariatDB` (repository, in-memory GRDB fixture tests) → `LariatApp` (View + `@Observable` ViewModel + A0 registration).

> **Note on task numbering & gaps:** board sections below were produced per-board and each carries a **Gap-fixes** subsection (from a completeness-critic pass against that board's parity oracle) — fold those fixes into the tasks as you execute. Task numbers restart per board section; execute in the Build-order sequence.

## Build order

**priceShocks (+ prices drill-down) → varianceAttribution → depletionExceptions → ingredientMasters (the one audited write, last).** Pure-read boards first (highest reuse: `priceShocks` extends `ManagementRollupRepository.loadPriceShocks`; `varianceAttribution` reuses `CostingCompute.colorFor`); the single write lands last once the read plumbing is proven.

## File Structure

| File | Action |
|------|--------|
| `LariatNative/Sources/LariatApp/CostingFeatures.swift` | Create |
| `LariatNative/Sources/LariatApp/DepletionExceptionsView.swift` | Create |
| `LariatNative/Sources/LariatApp/FeatureRegistry.swift` | Modify |
| `LariatNative/Sources/LariatApp/IngredientMastersView.swift` | Create |
| `LariatNative/Sources/LariatApp/IngredientMastersViewModel.swift` | Create |
| `LariatNative/Sources/LariatApp/ManagerFeatures.swift` | Modify |
| `LariatNative/Sources/LariatApp/PriceShocksView.swift` | Create |
| `LariatNative/Sources/LariatApp/VarianceAttributionView.swift` | Create |
| `LariatNative/Sources/LariatDB/DepletionExceptionsRepository.swift` | Create |
| `LariatNative/Sources/LariatDB/IngredientMastersRepository.swift` | Create |
| `LariatNative/Sources/LariatDB/PriceShockRepository.swift` | Create |
| `LariatNative/Sources/LariatDB/VarianceAttributionRepository.swift` | Create |
| `LariatNative/Sources/LariatModel/Compute/DepletionExceptionResolver.swift` | Create |
| `LariatNative/Sources/LariatModel/Compute/IngredientMastersCompute.swift` | Create |
| `LariatNative/Sources/LariatModel/Compute/PriceShockCompute.swift` | Create |
| `LariatNative/Sources/LariatModel/Compute/UnitConvert.swift` | Create |
| `LariatNative/Sources/LariatModel/Compute/VarianceAttributionCompute.swift` | Create |
| `LariatNative/Sources/LariatModel/DepletionExceptionRecords.swift` | Create |
| `LariatNative/Sources/LariatModel/DepletionReasonLabels.swift` | Create |
| `LariatNative/Sources/LariatModel/FeatureCatalog.swift` | Modify |
| `LariatNative/Sources/LariatModel/IngredientMasterRecords.swift` | Create |
| `LariatNative/Sources/LariatModel/PriceShockRecords.swift` | Create |
| `LariatNative/Sources/LariatModel/VarianceAttributionRecords.swift` | Create |
| `LariatNative/Sources/LariatModel/WriteErrorMapper.swift` | Modify |
| `LariatNative/Tests/LariatDBTests/DepletionExceptionsRepositoryTests.swift` | Test |
| `LariatNative/Tests/LariatDBTests/IngredientMastersRepositoryTests.swift` | Test |
| `LariatNative/Tests/LariatDBTests/PriceShockRepositoryTests.swift` | Test |
| `LariatNative/Tests/LariatDBTests/VarianceAttributionRepositoryTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/DepletionExceptionResolverTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/IngredientMastersComputeTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/PriceSeriesComputeTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/PriceShockComputeTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/UnitConvertTests.swift` | Test |
| `LariatNative/Tests/LariatModelTests/VarianceAttributionComputeTests.swift` | Test |

_(Exact per-file responsibilities are in each task's **Files** block below.)_

---



I have all the conventions confirmed. I now produce the plan section.

## Board: costing.priceShocks (Price Shocks — full board, promote the rollup summary)

**Reuse map (what already exists vs what's new).** The native `ManagementRollupRepository.loadPriceShocks` (`LariatNative/Sources/LariatDB/ManagementRollupRepository.swift:139-232`) already runs the *exact* two-source UNION SQL + live-overlay + `point_count>=2` / `baseline>0` / `abs(delta)>=minPct` gates — but it hard-codes `-7 days` / `minPct 5` / `limit 100`, discards `snapshot_at` / `category` / `baseline_at` / `latest_at`, keeps no per-group baseline/latest *timestamps*, and returns only `PriceShockSummary(total/up/down)` counts. **Do NOT edit `loadPriceShocks`** (it powers the Command "Price moves" tile and `RollupSnapshot.priceShocks`; changing its shape is HIGH blast radius). Instead build a *new, generalized* compute + repository pair modeled on the `MarginDeltasCompute` / `MarginDeltasRepository` precedent (pure grouping compute in LariatModel, SQL read in LariatDB). The web oracle is `lib/vendorPricesRepo.ts#listPriceShocks` (L419-604) + `lib/priceShockImpact.js` (impact joins) + `lib/vendorPricesRepo.ts#listPriceSeries` (L319-353, the drill-down). `formatDollars(_:decimals:)` already exists at `LariatNative/Sources/LariatApp/Money.swift:3` (use `decimals:4` for prices, mirroring `fmtPrice` = `formatDollars(n,{decimals:4})` and `page.jsx:45-47`).

**Tier relocation (do this FIRST, as its own task).** A new `FeatureTier.costing` case; the existing `manager.costing` descriptor + module move to id `costing.overview` under `.costing`; all new boards register under `.costing`.

---

### Task 1: Relocate the Costing tier — new `FeatureTier.costing`, `manager.costing` → `costing.overview`

- **Files:**
  - Modify `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (add `case costing`, add `costing.overview` descriptor, remove `manager.costing`).
  - Modify `LariatNative/Sources/LariatApp/ManagerFeatures.swift` (rename `managerCosting` → `costingOverview`, id `costing.overview`) OR move it into the new `CostingFeatures.swift` created in Task 5 — do the id/tier edit here, physical move deferred to Task 5.
  - Modify `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (replace `.managerCosting` line under Manager with `.costingOverview` under a new "// Costing" section).
  - Test: modify `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift`.
- **Interfaces:** Produces `FeatureTier.costing` (rawValue `"Costing"`); `FeatureCatalog.descriptor(id: "costing.overview")` with `tier == .costing`, `title "Costing"`. Consumes nothing new.
- Steps:
  - [ ] Step 1: Write the failing test `testCostingTierRelocation` in `FeatureRegistryTests.swift`:
    ```swift
    func testCostingTierRelocation() {
        XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
        XCTAssertEqual(FeatureTier.costing.rawValue, "Costing")
        // Old manager.costing id is gone; overview relocated under .costing.
        XCTAssertNil(FeatureCatalog.descriptor(id: "manager.costing"),
                     "manager.costing must be relocated to costing.overview")
        let overview = FeatureCatalog.descriptor(id: "costing.overview")
        XCTAssertNotNil(overview, "costing.overview must be registered")
        XCTAssertEqual(overview?.tier, .costing)
        XCTAssertEqual(overview?.title, "Costing")
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }
    ```
  - [ ] Step 2: Run to fail — `swift test --filter FeatureRegistryTests/testCostingTierRelocation` (fails: `.costing` case absent, compile error → treat as red).
  - [ ] Step 3: In `FeatureCatalog.swift`, add `case costing = "Costing"` to the `FeatureTier` enum (append after `.manager` so the sidebar renders Costing last). Replace the `manager.costing` descriptor line with `FeatureDescriptor(id: "costing.overview", tier: .costing, title: "Costing")` under a new `// Costing` comment block after the Manager block.
  - [ ] Step 4: In `ManagerFeatures.swift`, rename `static let managerCosting` → `static let costingOverview = FeatureModule(id: "costing.overview") { ctx in AnyView(CostingView(database: ctx.database)) }`. In `FeatureRegistry.swift`, remove `.managerCosting` from the Manager group and add a `// Costing` group with `.costingOverview`.
  - [ ] Step 5: Run to pass — `swift test --filter FeatureRegistryTests` (also confirms `testEveryTierHasAtLeastOneModule` still green: `.costing` now has `costing.overview`).
  - [ ] Step 6: `swift build && swift test`; commit `refactor(native): relocate Costing to costing.* tier` on `feat/*`.
- **Parity oracle cases covered:** author fresh vs the tier-decision in the wave brief (no web oracle — sidebar taxonomy is native-only). Guards `FeatureRegistryTests` invariants (unique ids, every tier non-empty).
- **Risks:** `testEveryTierHasAtLeastOneModule` will fail if the `.costing` case is added before `costing.overview` is registered — add the descriptor in the SAME edit. `CostingView` init signature is unchanged (`init(database:)`), so the module closure is a rename only, not a rewrite.

---

### Task 2: LariatModel — `PriceShockCompute` (pure grouping/gates/sort) + records

- **Files:**
  - Create `LariatNative/Sources/LariatModel/Compute/PriceShockCompute.swift`.
  - Create `LariatNative/Sources/LariatModel/PriceShockRecords.swift` (options + row records).
  - Test: create `LariatNative/Tests/LariatModelTests/PriceShockComputeTests.swift`.
- **Interfaces (produces):**
  ```swift
  public struct PriceShockOptions: Sendable {
      public let locationId: String
      public let windowDays: Int      // clamp [1,90], default 7
      public let minPctMove: Double   // clamp [0,1000], default 5
      public let limit: Int           // clamp [1,500], default 50
      public init(locationId: String = "default", windowDays: Int? = nil, minPctMove: Double? = nil, limit: Int? = nil)
  }
  public struct PriceShockInput: Sendable {   // one UNION row handed in by the repo
      public let vendor: String; public let sku: String; public let ingredient: String
      public let category: String?; public let snapshotAt: String; public let unitPrice: Double
      public init(vendor: String, sku: String, ingredient: String, category: String?, snapshotAt: String, unitPrice: Double)
  }
  public struct PriceShockLive: Sendable {    // one live vendor_prices row for the overlay
      public let vendor: String; public let sku: String; public let ingredient: String
      public let category: String?; public let unitPrice: Double; public let importedAt: String?
      public init(...)
  }
  public enum PriceShockDirection: String, Sendable, Equatable { case up, down }
  public struct PriceShockRow: Sendable, Equatable {
      public let vendor: String; public let sku: String; public let ingredient: String
      public let category: String?
      public let baselineUnitPrice: Double; public let baselineAt: String
      public let latestUnitPrice: Double; public let latestAt: String
      public let deltaPct: Double; public let direction: PriceShockDirection
      public init(...)
  }
  public enum PriceShockCompute {
      public static func compute(inputs: [PriceShockInput], live: [PriceShockLive], options: PriceShockOptions) -> [PriceShockRow]
  }
  ```
  - **Consumes:** nothing (pure).
- Steps:
  - [ ] Step 1: Write failing `PriceShockComputeTests.swift`. Use fixed ISO strings ordered by lexical compare (mirror `MarginDeltasComputeTests` `d6/d5/d0`). Cases pulled from `tests/js/test-price-shocks.mjs`:
    ```swift
    final class PriceShockComputeTests: XCTestCase {
        private let d6 = "2026-06-25 00:00:00"
        private let d5 = "2026-06-26 00:00:00"
        private let d3 = "2026-06-28 00:00:00"
        private let d0 = "2026-07-01 00:00:00"
        private func input(_ v: String, _ s: String, _ ing: String, _ p: Double, _ at: String, _ cat: String? = nil) -> PriceShockInput {
            PriceShockInput(vendor: v, sku: s, ingredient: ing, category: cat, snapshotAt: at, unitPrice: p)
        }
        // Oracle: "uses earliest in window vs latest overall, computes signed % delta"
        func testEarliestBaselineLatestOverall() {
            let rows = PriceShockCompute.compute(
                inputs: [input("sysco","AVO-1","Avocado",2.00,d6), input("sysco","AVO-1","Avocado",2.50,d0)],
                live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows[0].baselineUnitPrice, 2.00, accuracy: 1e-9)
            XCTAssertEqual(rows[0].latestUnitPrice, 2.50, accuracy: 1e-9)
            XCTAssertEqual(rows[0].direction, .up)
            XCTAssertEqual(rows[0].deltaPct, 25.0, accuracy: 1e-6)
        }
        // Oracle: "handles a price drop with direction=down"
        func testDrop() {
            let rows = PriceShockCompute.compute(
                inputs: [input("shamrock","OIL-1","Canola Oil",10,d5), input("shamrock","OIL-1","Canola Oil",8,d0)],
                live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows[0].direction, .down)
            XCTAssertTrue(rows[0].deltaPct < 0)
        }
        // Oracle: "filters out SKUs whose move is below the threshold"
        func testBelowThresholdDropped() {
            let rows = PriceShockCompute.compute(inputs: [
                input("sysco","A","A",100,d5), input("sysco","A","A",102,d0),   // +2%
                input("sysco","B","B",100,d5), input("sysco","B","B",110,d0),   // +10%
            ], live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5))
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows[0].sku, "B")
        }
        // Oracle: "sorts by absolute % move desc and trims to limit"
        func testSortDescAndLimit() {
            let rows = PriceShockCompute.compute(inputs: [
                input("v","A","A",100,d5), input("v","A","A",110,d0),  // +10
                input("v","B","B",100,d5), input("v","B","B",130,d0),  // +30
                input("v","C","C",100,d5), input("v","C","C",80,d0),   // -20
                input("v","D","D",100,d5), input("v","D","D",105,d0),  // +5
            ], live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 5, limit: 3))
            XCTAssertEqual(rows.map(\.sku), ["B","C","A"])
        }
        // Oracle: "skips SKUs with only one snapshot in window"
        func testSingleSnapshotSkipped() {
            let rows = PriceShockCompute.compute(
                inputs: [input("v","lonely","lonely",100,d0)],
                live: [], options: PriceShockOptions(windowDays: 7, minPctMove: 0))
            XCTAssertEqual(rows.count, 0)
        }
        // Oracle (live overlay): "live price overrides a stale history latest for the same SKU"
        func testLiveOverridesStaleLatest() {
            let rows = PriceShockCompute.compute(
                inputs: [input("v","OIL-9","Oil",10,d6), input("v","OIL-9","Oil",10.2,d3)],
                live: [PriceShockLive(vendor:"v", sku:"OIL-9", ingredient:"Oil", category:nil, unitPrice:13, importedAt:d0)],
                options: PriceShockOptions(windowDays: 30, minPctMove: 5))
            let hit = rows.first { $0.sku == "OIL-9" }
            XCTAssertNotNil(hit)
            XCTAssertEqual(hit?.latestUnitPrice, 13, accuracy: 1e-9)
            XCTAssertEqual(hit?.baselineUnitPrice, 10, accuracy: 1e-9)
        }
        // Oracle (live overlay): "does not invent a shock when there is no in-window history baseline"
        func testLiveOnlyNoBaseline() {
            let rows = PriceShockCompute.compute(
                inputs: [], live: [PriceShockLive(vendor:"sysco", sku:"ONLY-LIVE", ingredient:"Onions", category:nil, unitPrice:5, importedAt:d0)],
                options: PriceShockOptions(windowDays: 30, minPctMove: 5))
            XCTAssertNil(rows.first { $0.sku == "ONLY-LIVE" })
        }
        // Oracle: "surfaces a fresh-ingest price move that lives only in vendor_prices"
        func testFreshIngestViaLive() {
            let rows = PriceShockCompute.compute(
                inputs: [input("sysco","TOM-1","Tomatoes",10,d3)],
                live: [PriceShockLive(vendor:"sysco", sku:"TOM-1", ingredient:"Tomatoes", category:nil, unitPrice:12, importedAt:d0)],
                options: PriceShockOptions(windowDays: 30, minPctMove: 5))
            let hit = rows.first { $0.sku == "TOM-1" }
            XCTAssertEqual(hit?.latestUnitPrice, 12, accuracy: 1e-9)
            XCTAssertEqual(hit?.deltaPct ?? 0, 20, accuracy: 1e-6)
        }
        // Oracle: options clamp — parity with vendorPricesRepo.ts:428-444
        func testOptionClamps() {
            let o = PriceShockOptions(windowDays: 999, minPctMove: -50, limit: 99999)
            XCTAssertEqual(o.windowDays, 90)
            XCTAssertEqual(o.minPctMove, 0, accuracy: 1e-9)
            XCTAssertEqual(o.limit, 500)
            let d = PriceShockOptions()
            XCTAssertEqual(d.windowDays, 7); XCTAssertEqual(d.minPctMove, 5, accuracy: 1e-9); XCTAssertEqual(d.limit, 50)
        }
    }
    ```
  - [ ] Step 2: Run to fail — `swift test --filter PriceShockComputeTests` (no such symbol → red).
  - [ ] Step 3: Implement `PriceShockRecords.swift` (the structs/enum above). `PriceShockOptions.init` clamps exactly per `vendorPricesRepo.ts:428-444`:
    ```swift
    if let w = windowDays, w > 0 { self.windowDays = min(90, max(1, w)) } else { self.windowDays = 7 }
    if let m = minPctMove, m >= 0 { self.minPctMove = min(1000, m) } else { self.minPctMove = 5 }
    if let l = limit, l > 0 { self.limit = min(500, l) } else { self.limit = 50 }
    ```
  - [ ] Step 4: Implement `PriceShockCompute.compute`. Inputs arrive pre-sorted by the repo SQL (`vendor, sku, ingredient, snapshot_at ASC, source_order ASC, row_order ASC`), so first-seen per key = baseline, last = latest (mirrors `vendorPricesRepo.ts:508-536`). Key = `"\(vendor)|\(sku)|\(ingredient)"` (matches web L510). Track `baselineUnitPrice/baselineAt/latestUnitPrice/latestAt/pointCount/category`, keeping most-recent-non-null category (L535). Then overlay `live`: only for groups that already exist, set `latestUnitPrice = live.unitPrice`, `latestAt = live.importedAt ?? group.latestAt`, and set category if group's is nil (mirrors L563-571 — note the overlay's category rule is `if r.category != null && g.category == null` unlike the union pass). Gates (L575-587): skip if `pointCount < 2 || baselineUnitPrice <= 0`; `deltaPct = (latest - baseline) / baseline * 100`; skip if `abs(deltaPct) < minPctMove`. `direction = deltaPct > 0 ? .up : .down` (L598). Sort by `abs(deltaPct)` DESC then `prefix(limit)`. **Use insertion-order-stable sort** (`.enumerated().sorted { … return a.offset < b.offset }.map(\.element)`, exactly as `MarginDeltasCompute:193-197`) so ties preserve first-seen — JS `Array.sort` is stable and the Map preserves insertion order.
  - [ ] Step 5: Run to pass — `swift test --filter PriceShockComputeTests`.
  - [ ] Step 6: `swift build && swift test`; commit `feat(native): PriceShockCompute + records (LariatModel)`.
- **Parity oracle cases covered:** `tests/js/test-price-shocks.mjs` — "uses earliest in window vs latest overall", "handles a price drop with direction=down", "filters out SKUs whose move is below the threshold", "sorts by absolute % move desc and trims to limit", "skips SKUs with only one snapshot in window", plus the live-overlay describe block ("surfaces a fresh-ingest price move…", "does not invent a shock when there is no in-window history baseline", "live price overrides a stale history latest…"). Clamp values from `vendorPricesRepo.ts:428-444` (the API clamp test `days=999→90, minPct=-50→0, limit=99999→500` lives in the route, but the same clamp is asserted here at the options layer).
  - **Note vs the summary baseline:** the existing `loadPriceShocks` incorrectly keeps `baselinePrice` from the *very first* row without carrying `baselineAt`; here baseline/latest *timestamps* are new outputs — do not copy the summary's timestamp-less Group.
- **Risks:** **NO rounding in compute** — `delta_pct` is kept full-precision (web L586 does no rounding; rounding is display-only via `fmtPct`'s `.toFixed(1)` in Task 5). Money is `Double` dollars throughout — do NOT introduce cents-Int. Tie-stability: use the enumerated-offset stable sort, not `.sorted { abs > abs }` alone (unstable). `PriceShockDirection` is a new enum — do not reuse `MarginDirection` (keeps the two boards decoupled).

---

### Task 3: LariatModel — `PriceSeriesCompute` (drill-down series delta) + records

- **Files:**
  - Modify `LariatNative/Sources/LariatModel/PriceShockRecords.swift` (add `PriceSeriesOptions`, `PriceSeriesPoint`, `PriceSeriesResult`) OR create `PriceSeriesRecords.swift`.
  - Modify `LariatNative/Sources/LariatModel/Compute/PriceShockCompute.swift` add `PriceSeriesCompute` OR create `Compute/PriceSeriesCompute.swift`.
  - Test: create `LariatNative/Tests/LariatModelTests/PriceSeriesComputeTests.swift`.
- **Interfaces (produces):**
  ```swift
  public struct PriceSeriesOptions: Sendable {
      public let vendor: String; public let sku: String
      public let locationId: String; public let limit: Int   // clamp [1,1000] default 100
      public init(vendor: String, sku: String, locationId: String = "default", limit: Int? = nil)
      public var isBlank: Bool { vendor.isEmpty || sku.isEmpty }   // blank -> [] contract
  }
  public struct PriceSeriesPoint: Sendable, Equatable {
      public let snapshotAt: String; public let unitPrice: Double?
      public let packPrice: Double?; public let packSize: Double?; public let packUnit: String?
      public init(...)
  }
  public struct PriceSeriesResult: Sendable, Equatable {
      public let points: [PriceSeriesPoint]
      public let deltaPct: Double?   // (last-first)/first*100, nil unless ≥2 pts & first>0
      public init(points: [PriceSeriesPoint])   // computes deltaPct internally
  }
  public enum PriceSeriesCompute {
      public static func summarize(points: [PriceSeriesPoint]) -> Double?   // the delta rule
  }
  ```
  - **Consumes:** nothing (pure). The blank→[] and limit clamp normalization live in `PriceSeriesOptions.init` / `isBlank`, mirroring `vendorPricesRepo.ts:323-338`.
- Steps:
  - [ ] Step 1: Write failing `PriceSeriesComputeTests.swift` — author fresh vs `lib/vendorPricesRepo.ts:319-353` (there is no dedicated JS oracle for `listPriceSeries`; derive the delta rule from the wave brief + repo doc L300-317):
    ```swift
    final class PriceSeriesComputeTests: XCTestCase {
        private func pt(_ at: String, _ p: Double?) -> PriceSeriesPoint {
            PriceSeriesPoint(snapshotAt: at, unitPrice: p, packPrice: nil, packSize: nil, packUnit: nil)
        }
        func testDeltaOverTwoPoints() {
            // first 10 -> last 12.5 => +25%
            let d = PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 10), pt("2026-06-05 00:00:00", 12.5)])
            XCTAssertEqual(d ?? 0, 25.0, accuracy: 1e-6)
        }
        func testSinglePointHasNoDelta() {
            XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 10)]))
        }
        func testFirstZeroHasNoDelta() {
            XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", 0), pt("2026-06-05 00:00:00", 5)]))
        }
        func testFirstNilHasNoDelta() {
            XCTAssertNil(PriceSeriesCompute.summarize(points: [pt("2026-06-01 00:00:00", nil), pt("2026-06-05 00:00:00", 5)]))
        }
        func testOptionsBlankAndClamp() {
            XCTAssertTrue(PriceSeriesOptions(vendor: "  ", sku: "X").isBlank)
            XCTAssertTrue(PriceSeriesOptions(vendor: "v", sku: "").isBlank)
            XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s", limit: 99999).limit, 1000)
            XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s", limit: 0).limit, 100)   // non-positive -> default
            XCTAssertEqual(PriceSeriesOptions(vendor: "v", sku: "s").limit, 100)
        }
    }
    ```
  - [ ] Step 2: Run to fail — `swift test --filter PriceSeriesComputeTests`.
  - [ ] Step 3: Implement records + `PriceSeriesCompute.summarize`: guard `points.count >= 2`; take `first = points.first?.unitPrice`, `last = points.last?.unitPrice`; return nil unless both non-nil and `first > 0`; else `(last - first) / first * 100`. `PriceSeriesResult.init` calls `summarize`. `PriceSeriesOptions.init` trims vendor/sku (blank via `isBlank`), clamps limit `Number.isFinite && >0 ? min(1000, floor) : 100` → `if let l = limit, l > 0 { self.limit = min(1000, l) } else { self.limit = 100 }`.
  - [ ] Step 4: Run to pass — `swift test --filter PriceSeriesComputeTests`.
  - [ ] Step 5: `swift build && swift test`; commit `feat(native): PriceSeriesCompute + records`.
- **Parity oracle cases covered:** author fresh vs `lib/vendorPricesRepo.ts:319-353` (limit clamp L332-338; blank→[] L325; ordering handled in the repo SQL, Task 4). Delta rule (`(last-first)/first*100`, ≥2 pts, first>0) per wave brief.
- **Risks:** `unit_price` is nullable in `vendor_prices_history` (DDL `lib/db.ts:1308`) — `PriceSeriesPoint.unitPrice` MUST be `Double?`, and the delta must treat a nil endpoint as "no delta". 4-decimal display is a *view* concern (Task 5), not here. NO rounding on `deltaPct` (display rounds).

---

### Task 4: LariatDB — `PriceShockRepository` (UNION read + live overlay + impact joins + series read)

- **Files:**
  - Create `LariatNative/Sources/LariatDB/PriceShockRepository.swift`.
  - Test: create `LariatNative/Tests/LariatDBTests/PriceShockRepositoryTests.swift`.
- **Interfaces (produces):**
  ```swift
  public struct PriceShockImpact: Sendable, Equatable {   // per-ingredient join result
      public let dishes: [String]      // dish_name, distinct, sorted
      public let recipes: [String]     // recipe_id, distinct, sorted
  }
  public struct PriceShockRepository {
      public init(database: LariatDatabase, locationId: String = LocationScope.resolve())
      public func load(options: PriceShockOptions) async throws -> [PriceShockRow]
      public func impact(ingredients: [String]) async throws -> [String: PriceShockImpact]
      public func series(options: PriceSeriesOptions) async throws -> PriceSeriesResult
      public func historyCount() async throws -> Int   // zero-state discriminator
  }
  ```
  - **Consumes:** `PriceShockCompute.compute`, `PriceSeriesCompute` (Tasks 2-3), `LariatDatabase.pool.read` (read-only — no `LariatWriteDatabase`, per `MarginDeltasRepository` precedent).
- Steps:
  - [ ] Step 1: Write failing `PriceShockRepositoryTests.swift` using the exact temp-WAL-then-reopen fixture pattern from `MarginDeltasRepositoryTests.swift:18-55`. Fixture creates `vendor_prices`, `vendor_prices_history`, `dish_components`, `bom_lines` mirroring real DDL columns (`lib/db.ts:1278-1290, 1298-1318, 1410-1424`, and `dish_components` component_type CHECK from `MarginDeltasRepositoryTests:25-34`). Seed helpers use `datetime('now', '-N days')` for `snapshot_at` / `imported_at` so the runtime-relative window is exercised. Cases:
    ```swift
    // Oracle: "scopes to location_id"  (test-price-shocks.mjs)
    func testLocationScoping() async throws { /* kitchen-a 100->200 (+100%), kitchen-b 100->100.1 (+0.1%) → a:1, b:0 */ }
    // Oracle: "honours windowDays — older snapshots fall outside"
    func testWindowDaysClamp() async throws {
        // snapshot 40d ago @100 + today @200; windowDays 7 -> 0 rows; windowDays 90 -> 1 row, baseline 100
        let week = try await repo.load(options: PriceShockOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(week.count, 0)
        let quarter = try await repo.load(options: PriceShockOptions(windowDays: 90, minPctMove: 5))
        XCTAssertEqual(quarter.count, 1)
        XCTAssertEqual(quarter[0].baselineUnitPrice, 100, accuracy: 1e-9)
    }
    // Oracle: live overlay end-to-end through SQL (fresh-ingest TOM-1: history 10 @3d + live 12 → +20%)
    func testLiveOverlaySql() async throws { /* assert latestUnitPrice 12, deltaPct 20 */ }
    // Oracle: affectedDishes — priceShockImpact.js component_type='vendor_item' exact match
    func testImpactDishes() async throws {
        // dish_components: ('Guacamole','vendor_item','Avocado'), duplicate row → distinct+sorted
        let m = try await repo.impact(ingredients: ["Avocado"])
        XCTAssertEqual(m["Avocado"]?.dishes, ["Guacamole"])
    }
    // Oracle: test-price-shock-impact.mjs "scopes fallback recipe impact to the selected location"
    func testImpactRecipesLocationScoped() async throws {
        // bom_lines guac_a@kitchen-a + guac_b@kitchen-b, both vendor_ingredient 'Avocado'
        let repoA = PriceShockRepository(database: db, locationId: "kitchen-a")
        let m = try await repoA.impact(ingredients: ["Avocado"])
        XCTAssertEqual(m["Avocado"]?.recipes, ["guac_a"])
    }
    func testImpactEmptyIngredientsShortCircuits() async throws {
        let m = try await repo.impact(ingredients: [])
        XCTAssertTrue(m.isEmpty)
    }
    // series drill-down — ordered snapshot_at ASC, id ASC; blank -> []
    func testSeriesOrderedAndDelta() async throws {
        // history for (v, SKU) 10 @5d, 12 @0d → points.count 2, deltaPct 20
        let r = try await repo.series(options: PriceSeriesOptions(vendor: "v", sku: "SKU"))
        XCTAssertEqual(r.points.count, 2)
        XCTAssertEqual(r.points.first?.unitPrice ?? 0, 10, accuracy: 1e-9)
        XCTAssertEqual(r.deltaPct ?? 0, 20, accuracy: 1e-6)
    }
    func testSeriesBlankReturnsEmpty() async throws {
        let r = try await repo.series(options: PriceSeriesOptions(vendor: "", sku: "SKU"))
        XCTAssertTrue(r.points.isEmpty)
        XCTAssertNil(r.deltaPct)
    }
    // zero-state discriminator
    func testHistoryCount() async throws {
        XCTAssertEqual(try await repo.historyCount(), /* seeded row count for loc */ 2)
    }
    ```
  - [ ] Step 2: Run to fail — `swift test --filter PriceShockRepositoryTests`.
  - [ ] Step 3: Implement `load`: run the SELECT verbatim from `loadPriceShocks` (`ManagementRollupRepository.swift:145-171`) BUT add `category` to both SELECT legs (present in `vendorPricesRepo.ts:457-482`, dropped by the summary):
    ```swift
    let sinceModifier = "-\(options.windowDays) days"
    let unionRows = try Row.fetchAll(db, sql: """
        SELECT vendor, sku, ingredient, category, snapshot_at, unit_price, source_order, row_order
          FROM (
            SELECT vendor, sku, ingredient, category, snapshot_at, unit_price,
                   0 AS source_order, id AS row_order
              FROM vendor_prices_history
             WHERE location_id = ? AND snapshot_at >= datetime('now', ?)
               AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
            UNION ALL
            SELECT vendor, sku, ingredient, category,
                   COALESCE(imported_at, datetime('now')) AS snapshot_at, unit_price,
                   1 AS source_order, id AS row_order
              FROM vendor_prices
             WHERE location_id = ? AND COALESCE(imported_at, datetime('now')) >= datetime('now', ?)
               AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
          )
         ORDER BY vendor, sku, ingredient, snapshot_at ASC, source_order ASC, row_order ASC
        """, arguments: [locationId, sinceModifier, locationId, sinceModifier])
    ```
    Map to `[PriceShockInput]` (ingredient decode `row["ingredient"] as String? ?? ""` matching baseline L184). Live rows via the second query (`ManagementRollupRepository.swift:196-203`) plus `category, imported_at` columns → `[PriceShockLive]`. Return `PriceShockCompute.compute(inputs:live:options:)`.
  - [ ] Step 4: Implement `impact` — port `priceShockImpact.js` exactly, dynamic `?` placeholders, short-circuit on empty:
    ```swift
    // dishes: dish_components WHERE location_id=? AND component_type='vendor_item' AND vendor_ingredient IN (…)
    // recipes: bom_lines WHERE location_id=? AND vendor_ingredient IN (…)
    ```
    Group into `[ingredient: (Set<dish>, Set<recipe>)]`, then emit `dishes`/`recipes` as `Array(set).sorted()` (mirrors JS `[...new Set(v)].sort()` at `priceShockImpact.js:20,42`). Argument binding order = `[locationId] + ingredients` (matches `.all(loc, ...ingredients)`).
  - [ ] Step 5: Implement `series` — return `PriceSeriesResult(points: [])` when `options.isBlank`; else the SELECT from `vendorPricesRepo.ts:342-352` (`snapshot_at, run_id, pack_size, pack_unit, pack_price, unit_price, yield_pct, actual_received_lb, reconciled_unit_price, imported_at ORDER BY snapshot_at ASC, id ASC LIMIT ?`), keep only the fields `PriceSeriesPoint` needs, wrap in `PriceSeriesResult`. Implement `historyCount` = `SELECT COUNT(*) FROM vendor_prices_history WHERE location_id = ?` (page.jsx:154-156).
  - [ ] Step 6: Run to pass — `swift test --filter PriceShockRepositoryTests`.
  - [ ] Step 7: `swift build && swift test`; commit `feat(native): PriceShockRepository (UNION + overlay + impact + series)`.
- **Parity oracle cases covered:** `tests/js/test-price-shocks.mjs` — "scopes to location_id", "honours windowDays", live-overlay describe block (end-to-end via SQL). `tests/js/test-price-shock-impact.mjs` — "scopes fallback recipe impact to the selected location". Impact-dishes + empty-ingredients + series + historyCount are authored fresh vs `lib/priceShockImpact.js:2-45` and `vendorPricesRepo.ts:319-353` / `page.jsx:154-156` (no JS oracle for those exact paths).
- **Risks:** Do NOT touch `loadPriceShocks` — new repository is additive. `unit_price` / `imported_at` nullability must survive decode (`Double?`, `String?`). The `COALESCE(imported_at, datetime('now'))` in the union leg means live rows always fall inside the window unless `imported_at` is an old explicit value — matches web. Decode `snapshot_at`/`imported_at` as `String?` then coalesce. NO native migration — the fixture is the only place these tables are `CREATE`d.

---

### Task 5: LariatApp — `PriceShocksView` + `@Observable` VM, `PriceHistoryView` drill-down (selection state), A0 registration

- **Files:**
  - Create `LariatNative/Sources/LariatApp/PriceShocksView.swift` (VM + list view + `PriceHistoryView` + sparkline).
  - Create `LariatNative/Sources/LariatApp/CostingFeatures.swift` (physically relocate `costingOverview` here from `ManagerFeatures.swift` per Task 1's deferral, and add `costingPriceShocks`).
  - Modify `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (add `costing.priceShocks` descriptor).
  - Modify `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (add `.costingPriceShocks` to the Costing group).
  - Test: modify `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` (add `costing.priceShocks` assertion; `costing.prices` is NOT asserted — it is not a descriptor).
- **Interfaces (produces):**
  ```swift
  @Observable @MainActor final class PriceShocksViewModel {
      var rows: [PriceShockRow] = []
      var impact: [String: PriceShockImpact] = [:]
      var historyCount: Int = 0
      var windowDays = 7          // page defaults to 14 on web; native brief default 7
      var minPctMove: Double = 5  // web page default 10; brief default 5
      var errorText: String?
      var selected: PriceShockRow?   // drill-down selection state → PriceHistoryView
      var series: PriceSeriesResult?
      init(database: LariatDatabase)
      func start(); func stop()
      func select(_ row: PriceShockRow) async   // loads series via repo.series(vendor,sku)
  }
  struct PriceShocksView: View { init(database: LariatDatabase) }
  ```
  - **Consumes:** `PriceShockRepository` (Task 4), `formatDollars(_:decimals:)` (`Money.swift:3`), `AppContext.database`, `FeatureModule(id:makeView:)`.
- Steps:
  - [ ] Step 1: Write the failing registration test in `FeatureRegistryTests.swift`:
    ```swift
    func testCostingPriceShocksRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.priceShocks")
        XCTAssertNotNil(d, "costing.priceShocks must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Price shocks")
        XCTAssertEqual(d?.enabled, true)
        // costing.prices is a drill-down, NOT a catalog descriptor:
        XCTAssertNil(FeatureCatalog.descriptor(id: "costing.prices"),
                     "price history is reached from a shock row, not a sidebar tile")
    }
    ```
  - [ ] Step 2: Run to fail — `swift test --filter FeatureRegistryTests/testCostingPriceShocksRegistered`.
  - [ ] Step 3: Add `FeatureDescriptor(id: "costing.priceShocks", tier: .costing, title: "Price shocks")` to `FeatureCatalog.all`. Create `CostingFeatures.swift`:
    ```swift
    import SwiftUI
    extension FeatureModule {
        static let costingOverview = FeatureModule(id: "costing.overview") { ctx in
            AnyView(CostingView(database: ctx.database))
        }
        static let costingPriceShocks = FeatureModule(id: "costing.priceShocks") { ctx in
            AnyView(PriceShocksView(database: ctx.database))
        }
    }
    ```
    Remove `costingOverview` from `ManagerFeatures.swift` (finishing Task 1's move). Add `.costingPriceShocks` to the `// Costing` group in `FeatureRegistry.swift`.
  - [ ] Step 4: Run to pass — `swift test --filter FeatureRegistryTests`.
  - [ ] Step 5: Implement `PriceShocksView.swift` mirroring the `CostingView` VM pattern (`CostingView.swift:13-89`): poll every 3 s in `start()`, `MainActor.run` to publish `rows`/`impact`/`historyCount`, `TileDegrade` on error, `ProgressView` while loading. Each shock row shows `ingredient` (tappable → `vm.select(row)`), `vendor · sku` meta, `fmtPct` colored red (up) / green (down), price change `formatDollars(baselineUnitPrice, decimals: 4) … to … formatDollars(latestUnitPrice, decimals: 4)` (mirrors `page.jsx:45-47,259-263`), and "Used in" text built from `impact[ingredient]`: dishes first (slice 5, "and N more"), else recipes (slice 3, "and N more"), else "Not currently used in any costed recipe or dish." (verbatim from `page.jsx:227-231`). Zero-state: if `rows.isEmpty`, show `historyCount == 0 ? "No price history yet. Run npm run ingest:costing to capture a snapshot." : "No vendor price moves above this threshold in the window."` (verbatim `page.jsx:206-208`). `fmtPct(v)` = `String(format: "%+.1f%%", v)` for finite (matches `page.jsx:37-42` `toFixed(1)` with sign) — note `+` prefix covers both signs since down is negative. Add `PriceHistoryView` presented via `.sheet(item: $vm.selected)` (selection state, NOT a route): renders `vm.series` points as a Swift Charts line/sparkline (color red/green by `selected.direction`, mirroring `PriceMoveSparkline` tone at `page.jsx:102-124`), each point label uses `formatDollars(unitPrice ?? 0, decimals: 4)`, header shows `deltaPct` via `fmtPct`.
  - [ ] Step 6: `swift build && swift test`; commit `feat(native): costing.priceShocks board + price-history drill-down + A0 registration`.
- **Parity oracle cases covered:** `tests/js/test-price-shocks.mjs` "PriceShocksPage roadmap 1.7 contract" and "SkuHistoryPage Next 16 params contract" are web source-shape asserts with no native analog — the native equivalent is the `FeatureRegistryTests` registration assert (author fresh). "Used in" / zero-state strings are ported verbatim from `page.jsx:206-208, 227-231`; 4-decimal price + signed 1-decimal pct from `page.jsx:37-47`.
  - **`costing.prices` handling:** intentionally NOT a `FeatureDescriptor` / sidebar tile — reached only through `vm.selected` (a shock row tap). The registration test explicitly asserts `descriptor(id: "costing.prices") == nil`.
- **Risks:** Views/VMs aren't unit-tested in this suite (only the registration invariant is), so display formatting parity rides on Tasks 2-4 correctness plus the verbatim strings — copy the "and N more" thresholds (dishes 5, recipes 3) and zero-state strings *exactly*. `fmtPct` `%+.1f%%` uses Swift's default rounding, which for one-decimal display of these magnitudes differs from JS `toFixed` only on exact half-cases — acceptable for a display string (no comparison/gate depends on it), so no `floor(x+0.5)` helper is needed here (unlike `InventoryShrinkage`). Reads are NOT PIN-gated — do not add a PIN sheet. No write on this board — no `AuditedWriteRunner`. The `PriceHistoryView` sheet uses `PriceShockRow` as `Identifiable` for `.sheet(item:)`; add `id` (e.g. `"\(vendor)|\(sku)|\(ingredient)"`) if `PriceShockRow` isn't already `Identifiable`.

---

**Layer order satisfied:** Task 1 (tier relocation, prerequisite) → Tasks 2-3 (LariatModel compute + records, value-parity tests first) → Task 4 (LariatDB repository, in-memory GRDB fixture) → Task 5 (LariatApp view + VM + A0 registration). No task edits `loadPriceShocks` / `PriceShockSummary` (Command tile untouched). `costing.prices` is a drill-down only. Money stays `Double` dollars end-to-end; no rounding in compute (display-only, no gate depends on rounded pct so the JS `floor(x+0.5)` tie helper is not required on this board).

#### Gap-fixes for priceShocks (fold into the tasks above during execution)

I now have full source context. Let me verify the delta rule in the drill-down: the page computes `delta` from `series[0]` and `series[last]` guarded by `series.length >= 2 && first?.unit_price > 0` — but note it does NOT check `last.unit_price` for null. Let me note that against the plan. I have enough to produce the gap audit.

GAPS for priceShocks:

- **Category filter is entirely unmodeled — a whole oracle test is dropped.** The route (`app/api/vendor-prices/shocks/route.js:60,68-73`) applies an exact-match, case-insensitive `category` filter (`(r.category ?? '').toLowerCase() === k`), and `tests/js/test-price-shocks.mjs:222-245` ("honours category filter (case-insensitive)") asserts it. No task carries a `category` option into `PriceShockOptions` / repo `load` / the VM, and no test covers it. Either the board intentionally omits category filtering (say so and note the oracle case as N/A) or it must be added — the plan does neither.

- **Route clamp for `days`/`minPct`/`limit` uses different fallback semantics than the compute-layer clamp the plan mirrors.** The plan's `PriceShockOptions.init` (Task 2 Step 3) clamps only positive/valid inputs and otherwise defaults, matching `vendorPricesRepo.ts:428-444`. But the API route (`route.js:39-51`) uses `Math.max(min, Math.min(max, floor(n)))` with a raw-string short-circuit — so e.g. `days=-5` clamps to `min` (1) at the route but the repo would treat `-5` as invalid→default 7. The plan's `testOptionClamps` (`minPctMove: -50 → 0`) asserts the route's clamp behavior (`route.js:58` → `Math.max(0,…)` = 0) yet cites the repo clamp (`vendorPricesRepo.ts:434-438` would give default 5, not 0, for a negative `minPctMove` since `rawMin >= 0` is false). This is a genuine contradiction: `minPctMove: -50` yields 5 in the repo but the test expects 0. The clamp test values come from the *route* (`test-price-shocks.mjs:212-220`), not the options layer — the plan conflates the two.

- **`testOptionClamps` `windowDays: 999 → 90` also disagrees with the repo rule.** `vendorPricesRepo.ts:431` floors then clamps, so 999→90 is correct there, but the plan asserts this at the `PriceShockOptions` layer while the repo clamp is `Math.min(90, Math.max(1, Math.floor(rawWindow)))` — fine for 999, but the plan's Swift snippet `min(90, max(1, w))` omits the `floor`. `windowDays` is `Int` so floor is moot, but `minPctMove` is `Double` and the repo does NOT floor it (`Math.min(1000, rawMin)`), while `limit` DOES floor (`Math.floor(rawLimit)`); the plan's limit clamp `min(500, l)` on an `Int` is fine, but there is no test asserting a fractional-limit-flooring parity (N/A for Int) — acceptable, but the `-50→0` vs `-50→default-5` conflict above remains unresolved.

- **`PriceSeriesResult.deltaPct` guard omits the `last`-non-nil / `last>0` check present in nothing — but the web page guard is weaker than the plan.** Web `SkuHistoryPage` (`page.jsx:124-127`) guards only `series.length >= 2 && first?.unit_price > 0`; it does NOT guard `last.unit_price` non-null. The plan's `PriceSeriesCompute.summarize` (Task 3 Step 3) adds "return nil unless both non-nil" — stricter than the oracle. `testFirstNilHasNoDelta` is authored fresh (no web oracle), and a nil *last* endpoint would `NaN` in JS but the plan returns nil. This is a deliberate hardening, not a parity match — flag that there is no oracle for the last-nil case and the plan silently diverges from web (web would produce `NaN`, plan produces nil). Acceptable if intentional, but undocumented.

- **`listPriceSeries` limit parity: plan uses `limit: 500` in view but page uses 500 — OK; however the drill-down repo `series` SELECT limit is `PriceSeriesOptions.limit` (default 100), while the actual web drill-down passes `limit: 500`** (`prices/[vendor]/[sku]/page.jsx:98`). The plan's `PriceSeriesOptions` defaults to 100 and Task 5's `vm.select` is not stated to pass 500, so the native drill-down would truncate to 100 snapshots vs web's 500. No task wires the 500 through. (The clamp default-100 is correct per `vendorPricesRepo.ts:313`, but the *caller* default of 500 is unmodeled.)

- **`PriceSeriesPoint` drops fields the web drill-down renders.** Web SkuHistoryPage renders `run_id` (`page.jsx:192`), `pack_price` (`:191`), `pack_size`/`pack_unit` (`:189`), and the current-row `pack_unit` fallback (`:152`). The plan's `PriceSeriesPoint` has `unitPrice/packPrice/packSize/packUnit` but NO `runId` — the "run #N" snapshot label cannot be reproduced. The repo `series` SELECT (Task 4 Step 5) selects `run_id` but the record has nowhere to put it. Add `runId: Int?` (or state the native drill-down omits run labels).

- **The drill-down "current vendor_prices row" subhead query is unmodeled.** Web `SkuHistoryPage` runs a second query (`page.jsx:103-110`) for `ingredient, category, pack_size, pack_unit, pack_price, unit_price` from `vendor_prices` for the subhead + `pack_unit` fallback, plus a history-fallback ingredient query (`:113-119`). The native plan's `PriceShockRow` already carries `ingredient`, and the sheet is driven off the selected row, so the ingredient/category header may be covered — but "Current" KPI uses the *live* `vendor_prices.unit_price`, not the series last point, and `per {pack_unit}` needs the live pack unit. Task 5 says the header shows only `deltaPct`; the "Current / Earliest / Change / N snapshots" KPI block (`page.jsx:148-176`) is not in the plan. Either descope explicitly or model it.

- **Missing test: "returns 200 with empty rows when history is empty" (`test-price-shocks.mjs:203-210`).** The native analog is `historyCount()` + zero-state, and Task 4 has `testHistoryCount`, but nothing asserts that `load` on empty tables returns `[]` (count 0) — the empty-history path (no rows, `window_days 7`, `min_pct 5` defaults) has no repo test. Add an empty-DB `load → []` case.

- **A0 registration / tier relocation gaps:**
  - The plan adds `case costing = "Costing"` "after `.manager`" but never confirms the existing `FeatureTier` enum's current cases/order or that `manager.costing` is the only descriptor moving — verify `FeatureCatalog.swift` actually has a `manager.costing` descriptor (the plan asserts its removal in `testCostingTierRelocation` but cites no line). If `manager.costing` is registered in more than one place (e.g. a Command tile or `RollupSnapshot`), the relocation blast radius is understated.
  - `costing.prices` correctly NOT a catalog tile — the plan asserts `descriptor(id:"costing.prices") == nil` (Task 5 Step 1). Good, no gap.
  - `PriceShockRow` `Identifiable` conformance for `.sheet(item:)` is flagged as conditional ("add `id` if not already") — but `PriceShockRow` is newly created in Task 2 and is NOT declared `Identifiable` there. This is an inconsistency: Task 2's interface omits `Identifiable`/`id`, Task 5 requires it. Make `PriceShockRow: Identifiable` in Task 2.

- **Live-overlay category rule parity is described but not tested.** Plan Task 2 Step 4 correctly notes the overlay category rule differs (`vendorPricesRepo.ts:570`: set only `if r.category != null && g.category == null`) vs the union pass (`:535`: most-recent-non-null). Neither `PriceShockComputeTests` nor `PriceShockRepositoryTests` has a case asserting category carry-through (union most-recent-non-null vs overlay fill-only-if-nil). No oracle test exists for this either, but since the plan adds `category` as a new output field (dropped by the summary), it should have at least one category-propagation test; none is listed.

- **`latest_at` overlay fallback (`imported_at || g.latest_at`, `vendorPricesRepo.ts:569`) is modeled** (`latestAt = live.importedAt ?? group.latestAt`) — correct. But `PriceShockLive.importedAt` is `String?` and `testLiveOverridesStaleLatest`/`testFreshIngestViaLive` always pass a non-nil `importedAt`; there is no test for a live row with nil `imported_at` falling back to the history `latestAt`. Minor coverage gap (no web oracle for it either).

- **`historyCount` location scoping.** Plan implements `SELECT COUNT(*) FROM vendor_prices_history WHERE location_id = ?` matching `page.jsx:154-156`. `testHistoryCount` asserts "2" but the fixture seeds multiple locations elsewhere (`testLocationScoping`, `testImpactRecipesLocationScoped` use kitchen-a/kitchen-b). The placeholder count "2" is unverified against the actual per-location seed — flag as a placeholder value to pin down when writing the fixture.

- **Placeholder text in interfaces.** Multiple `public init(...)` bodies in Task 2/3 interface blocks are literal `(...)` placeholders (`PriceShockLive.init(...)`, `PriceShockRow.init(...)`, `PriceSeriesPoint.init(...)`, `PriceSeriesResult.init(points:)`), and comment `/* seeded row count for loc */` / `/* kitchen-a 100->200 … */` remain in the test snippets. These are plan-level placeholders that must be fully written; the `PriceSeriesResult.init(points:)` computing `deltaPct` internally conflicts with `PriceSeriesCompute.summarize(points:)` being the delta owner — decide whether the init or the enum computes it (the plan has both).

---


I have everything I need. I've verified the web behavior against the source (all rules confirmed: the two-recent-period default, `from>=to` guard, per-section SECTION_LIMIT=60, the price-move pct rounded to 1dp via `Math.round(pct*10)/10`, delta rounding via `Math.round(x*100)/100`, composition change_kind via `slice(0,10)` window recheck, count_corrections union of closed-counts-first then audits, the date-like GLOB fallback with note, and normalizeDishName being the only import from dishCostBridge). One correction to the prompt's framing to flag: the count_corrections output ordering is `[...closedItems, ...auditItems]` (closed counts first), not audits-first — I'll reflect that in the plan.

Here is the plan section.

## Board: costing.varianceAttribution (Variance Attribution — 4 evidence sections)

Read-only board. Ports `lib/varianceAttribution.ts#buildVarianceAttribution` + `listRecentVariancePeriods` + `thresholdColorFor` + the `normalizeDishName` string normalizer from `lib/dishCostBridge.ts:49-55`. Oracle: `tests/js/test-variance-attribution.mjs`. No PIN sheet (manager-tier read). No native migration — fixtures create the six web-owned tables. Money is `Double` dollars throughout; the ONLY rounding calls are `Math.round(pct*10)/10` (price-move pct, 1dp) and `Math.round(x*100)/100` (delta amount/pct, 2dp) — both mapped to a `jsRound` floor(x+0.5) helper (ties on positive deltas ARE reachable, e.g. 2.5→3, so half-up matters).

**Reuse of existing native symbols:**
- `ThresholdColor` enum + `colorFor(_:)` in `CostingCompute.swift:43-47,354-360` are byte-identical to `thresholdColorFor` (abs≥5 red, ≥2 yellow, else green). Reuse `colorFor` directly; do NOT re-derive. Since `colorFor` is `private`, Task 1 promotes it to `internal`/`public` OR wraps a `VarianceAttributionCompute.thresholdColor(_:)` that calls it — plan uses the latter to avoid touching the file's existing surface.
- Fixture DDL, temp-WAL-then-reopen-read-only harness (`makeDB(seed:)`), and in-Swift-normalize precedent all come from `MarginDeltasRepositoryTests.swift:18-55` and `MarginDeltasRepository.swift`.
- App layer mirrors `CostingViewModel`/`CostingView` (`CostingView.swift:13-89`) — 3s polling `@Observable` VM + section-card content.

What remains to build: the four evidence-section algorithms (price grouping, composition change_kind, count-correction union, unresolved-depletion normalize+filter), the window-selection state machine, four record structs, the repository (5 SELECTs + in-Swift JOIN), the VM+View, and A0 registration under a NEW `.costing` tier (relocating `manager.costing` → `costing.overview`).

---

### Task 1: `VarianceAttributionCompute` — window selection + threshold color + delta rounding (pure)

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/VarianceAttributionCompute.swift`
- Create: `LariatNative/Sources/LariatModel/VarianceAttributionRecords.swift`
- Test: `LariatNative/Tests/LariatModelTests/VarianceAttributionComputeTests.swift`

**Interfaces produced:**
```swift
public struct VarianceAttrPeriod: Sendable, Equatable {
    public let periodStart: String?
    public let periodEnd: String
    public let theoreticalCogs: Double?
    public let actualCogs: Double?
    public let varianceAmount: Double?
    public let variancePct: Double?
    public let thresholdColor: ThresholdColor          // reuse existing enum
}
public struct VarianceAttrWindow: Sendable, Equatable { public let from: String?; public let to: String? }
public struct VarianceAttrDelta: Sendable, Equatable {
    public let baseline: VarianceAttrPeriod?
    public let current: VarianceAttrPeriod?
    public let deltaAmount: Double?
    public let deltaPct: Double?
}
// Raw variance row the repository hands in (period_end + the four numeric cols).
public struct VarianceAttrRow: Sendable, Equatable {
    public let periodStart: String?; public let periodEnd: String
    public let theoreticalCogs: Double?; public let actualCogs: Double?
    public let varianceAmount: Double?; public let variancePct: Double?
}
public enum VarianceAttrWindowResult: Sendable, Equatable {
    case ok(window: VarianceAttrWindow, delta: VarianceAttrDelta)   // window.from/to non-nil
    case failed(reason: String)
}
public enum VarianceAttributionCompute {
    public static func thresholdColor(_ pct: Double?) -> ThresholdColor        // wraps colorFor
    public static func selectWindow(baseline: VarianceAttrRow?, current: VarianceAttrRow?,
                                    hasFrom: Bool, hasTo: Bool,
                                    from: String?, to: String?,
                                    recentCount: Int) -> VarianceAttrWindowResult
}
```
**Interfaces consumed:** `ThresholdColor`, `colorFor(_:)` from `CostingCompute.swift` (same module).

Design: `selectWindow` reproduces `buildVarianceAttribution` lines 489-544's decision logic WITHOUT the DB. The repository (Task 3) resolves `recentCount` (= count from `listRecentVariancePeriods(loc,2)`) and the two `VarianceAttrRow`s (baseline/current already fetched by period_end), then calls `selectWindow`. This keeps the branch logic pure and oracle-testable. The `from>=to` string comparison, "both required", "no variance period found with period_end X", "need at least two variance periods" reasons are all mirrored verbatim from lines 497-528.

Steps (strict TDD):
- [ ] Step 1: Write failing tests. Real values from oracle `buildVarianceAttribution() window selection` cases:
```swift
import XCTest
@testable import LariatModel

final class VarianceAttributionComputeTests: XCTestCase {
    private func row(_ end: String, amt: Double, pct: Double) -> VarianceAttrRow {
        VarianceAttrRow(periodStart: nil, periodEnd: end, theoreticalCogs: 1000, actualCogs: 1000 + amt,
                        varianceAmount: amt, variancePct: pct)
    }

    // Oracle: "defaults to the two most recent periods" — baseline 2026-05-01 pct2 amt20,
    // current 2026-05-15 pct5.5 amt55 → delta_pct 3.5, delta_amount 35, colors yellow/red.
    func testDefaultWindowDeltaAndColors() {
        let base = row("2026-05-01", amt: 20, pct: 2)
        let cur  = row("2026-05-15", amt: 55, pct: 5.5)
        guard case let .ok(window, delta) =
            VarianceAttributionCompute.selectWindow(baseline: base, current: cur,
                hasFrom: false, hasTo: false, from: nil, to: nil, recentCount: 2)
        else { return XCTFail("expected ok") }
        XCTAssertEqual(window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(delta.deltaPct, 3.5)
        XCTAssertEqual(delta.deltaAmount, 35)
        XCTAssertEqual(delta.baseline?.thresholdColor, .yellow)   // pct 2 → yellow
        XCTAssertEqual(delta.current?.thresholdColor, .red)       // pct 5.5 → red
    }

    // Oracle: "returns coherent ok:false when explicit period missing" — from 2026-01-01 absent.
    func testExplicitMissingBaselineFails() {
        let cur = row("2026-05-15", amt: 55, pct: 5.5)
        guard case let .failed(reason) =
            VarianceAttributionCompute.selectWindow(baseline: nil, current: cur,
                hasFrom: true, hasTo: true, from: "2026-01-01", to: "2026-05-15", recentCount: 2)
        else { return XCTFail("expected failed") }
        XCTAssertTrue(reason.contains("2026-01-01"))
    }

    // from >= to guard (lib line 501).
    func testFromNotBeforeToFails() {
        guard case let .failed(reason) =
            VarianceAttributionCompute.selectWindow(baseline: nil, current: nil,
                hasFrom: true, hasTo: true, from: "2026-05-15", to: "2026-05-01", recentCount: 2)
        else { return XCTFail("expected failed") }
        XCTAssertTrue(reason.contains("earlier period_end"))
    }

    // only one of from/to (lib line 496).
    func testOneOfFromToFails() {
        guard case .failed = VarianceAttributionCompute.selectWindow(
            baseline: nil, current: nil, hasFrom: true, hasTo: false,
            from: "2026-05-01", to: nil, recentCount: 2) else { return XCTFail() }
    }

    // Oracle: "empty DB" — fewer than two recent periods.
    func testEmptyDbNeedsTwoPeriods() {
        guard case let .failed(reason) = VarianceAttributionCompute.selectWindow(
            baseline: nil, current: nil, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 0) else { return XCTFail() }
        XCTAssertTrue(reason.contains("two variance periods"))
    }

    // Delta half-up tie: 2.5 → 3 not 2 (jsRound floor(x+0.5)).
    func testDeltaRoundingHalfUp() {
        let base = row("2026-05-01", amt: 0, pct: 0)
        let cur  = row("2026-05-15", amt: 2.5, pct: 2.5)
        guard case let .ok(_, delta) = VarianceAttributionCompute.selectWindow(
            baseline: base, current: cur, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 2) else { return XCTFail() }
        // Math.round(2.5*100)/100 = 2.5; but Math.round(2.5)=3 at 1s place — here 2.5 rounds to 2.5.
        XCTAssertEqual(delta.deltaAmount, 2.5)
    }

    func testThresholdColorBuckets() {
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(nil), .green)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(-5.0), .red)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(2.0), .yellow)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(1.99), .green)
    }
}
```
- [ ] Step 2: Run `swift test --filter VarianceAttributionComputeTests` → fail (symbols undefined).
- [ ] Step 3: Implement `VarianceAttributionRecords.swift` (the structs above) and `VarianceAttributionCompute.swift`:
```swift
import Foundation

public enum VarianceAttributionCompute {
    /// JS Math.round = floor(x + 0.5); ties on positive deltas (e.g. 0.5→1) go up.
    private static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
    private static func round2(_ x: Double) -> Double { jsRound(x * 100) / 100 }

    public static func thresholdColor(_ pct: Double?) -> ThresholdColor { colorFor(pct) }

    public static func selectWindow(
        baseline: VarianceAttrRow?, current: VarianceAttrRow?,
        hasFrom: Bool, hasTo: Bool, from: String?, to: String?, recentCount: Int
    ) -> VarianceAttrWindowResult {
        if hasFrom || hasTo {
            guard hasFrom, hasTo else {
                return .failed(reason: "both from and to are required to pick an explicit window")
            }
            let f = from ?? "", t = to ?? ""
            if f >= t { return .failed(reason: "from must be an earlier period_end than to") }
            guard let base = baseline else { return .failed(reason: "no variance period found with period_end \(f)") }
            guard let cur = current else { return .failed(reason: "no variance period found with period_end \(t)") }
            return finish(base, cur)
        }
        if recentCount < 2 {
            return .failed(reason: "need at least two variance periods for this location to attribute a move")
        }
        guard let base = baseline, let cur = current else {
            return .failed(reason: "variance periods disappeared mid-read")
        }
        return finish(base, cur)
    }

    private static func toPeriod(_ r: VarianceAttrRow) -> VarianceAttrPeriod {
        VarianceAttrPeriod(periodStart: r.periodStart, periodEnd: r.periodEnd,
            theoreticalCogs: r.theoreticalCogs, actualCogs: r.actualCogs,
            varianceAmount: r.varianceAmount, variancePct: r.variancePct,
            thresholdColor: thresholdColor(r.variancePct))
    }

    private static func finish(_ base: VarianceAttrRow, _ cur: VarianceAttrRow) -> VarianceAttrWindowResult {
        let b = toPeriod(base), c = toPeriod(cur)
        let dAmt: Double? = (b.varianceAmount != nil && c.varianceAmount != nil)
            ? round2(c.varianceAmount! - b.varianceAmount!) : nil
        let dPct: Double? = (b.variancePct != nil && c.variancePct != nil)
            ? round2(c.variancePct! - b.variancePct!) : nil
        return .ok(window: VarianceAttrWindow(from: base.periodEnd, to: cur.periodEnd),
                   delta: VarianceAttrDelta(baseline: b, current: c, deltaAmount: dAmt, deltaPct: dPct))
    }
}
```
- [ ] Step 4: Run `swift test --filter VarianceAttributionComputeTests` → pass.
- [ ] Step 5: `swift build && swift test` (full) green; stage; commit `feat(native): A4.2 variance-attribution window+delta compute`.

**Parity oracle cases covered:** `buildVarianceAttribution() window selection` → "defaults to the two most recent periods", "returns a coherent ok:false payload when an explicit period is missing", "returns a coherent ok:false payload on an empty DB", plus the `from>=to` and one-of-from/to guards (author fresh vs `lib/varianceAttribution.ts:496-528`). Threshold buckets author-fresh vs `lib/varianceAttribution.ts:113-119`.

**Risks:** delta rounding MUST be `jsRound(x*100)/100` — do NOT use Swift `.rounded()` (half-away-from-zero differs on negative ties like `-0.5`). `finish` compares `from >= to` as STRING (YYYY-MM-DD lexical == chronological), matching JS `>=` on strings. `recentCount` must be the row count of `listRecentVariancePeriods(loc, 2)`, not a fetch of all periods.

---

### Task 2: `VarianceAttributionCompute` — four evidence-section algorithms (pure)

**Files:**
- Modify: `LariatNative/Sources/LariatModel/Compute/VarianceAttributionCompute.swift`
- Modify: `LariatNative/Sources/LariatModel/VarianceAttributionRecords.swift`
- Test: `LariatNative/Tests/LariatModelTests/VarianceAttributionComputeTests.swift` (append)

**Interfaces produced:**
```swift
public struct PriceMoveItem: Sendable, Equatable {
    public let vendor, sku, ingredient: String
    public let firstPrice, lastPrice, pctMove: Double?
    public let firstAt, lastAt: String
    public let snapshots: Int
    public let linkedToMenu: Bool
}
public struct CompositionChangeItem: Sendable, Equatable {
    public let dishName, component, componentType, changeKind, changedAt: String  // changeKind: "created"|"updated"
}
public struct CountCorrectionItem: Sendable, Equatable {
    public let kind: String                 // "audit" | "count_closed"
    public let entity, action, transition, actorCookId: String?
    public let entityId, countId, lines: Int?
    public let label, countDate: String?
    public let at: String
}
public struct UnresolvedDepletionItem: Sendable, Equatable {
    public let itemName: String; public let periodLabel: String?
    public let qtySold, netSales: Double?
}
// Raw rows the repository hands in:
public struct PriceSnapRow: Sendable { public let vendor, sku, ingredient: String; public let unitPrice: Double?; public let snapshotAt: String }
public struct CompRow: Sendable { public let dishName, componentType: String; public let recipeSlug, vendorIngredient: String?; public let qtyPerServing: Double?; public let unit: String?; public let createdAt, updatedAt: String? }
public struct AuditRow: Sendable { public let entity: String; public let entityId: Int?; public let action: String; public let actorCookId, payloadJson: String?; public let createdAt: String }
public struct ClosedCountRow: Sendable { public let id: Int; public let label, countDate: String?; public let closedAt: String; public let lines: Int }
public struct SalesLineRow: Sendable { public let itemName: String; public let periodLabel: String?; public let quantitySold, netSales: Double? }

extension VarianceAttributionCompute {
    static func priceMoves(snaps: [PriceSnapRow], linkedIngredients: Set<String>) -> [PriceMoveItem]
    static func compositionChanges(rows: [CompRow], from: String, to: String) -> [CompositionChangeItem]
    static func countCorrections(audits: [AuditRow], closed: [ClosedCountRow]) -> [CountCorrectionItem]
    static func unresolvedDepletions(sales: [SalesLineRow], components: [CompRow],
                                     from: String, to: String,
                                     dateLikeCount: Int, totalCount: Int) -> (items: [UnresolvedDepletionItem], note: String?)
    static func normalizeDishName(_ s: String?) -> String   // port of dishCostBridge.ts:49-55
}
```
**Interfaces consumed:** the raw-row structs above (repository populates them).

Notes on the port:
- `priceMoves`: repository does the windowed SQL (`date(snapshot_at) > from AND <= to`, ORDER BY `snapshot_at ASC, rowid ASC`) so snaps arrive in-order. Compute groups by `"\(vendor)|\(sku)|\(ingredient)"` preserving insertion order (lib:235-241), skips groups with `<2` snapshots or `first.unitPrice == last.unitPrice` (lib:247-248), computes `pct = ((last-first)/first)*100` only when both non-nil and `first != 0`, rounds `jsRound(pct*10)/10` (lib:259). Sort by `abs(pctMove ?? 0)` DESC then `.prefix(60)` (lib:266-269). `linkedToMenu = linkedIngredients.contains(first.ingredient)`.
- `compositionChanges`: repository SQL already windowed + `ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 60`. Compute re-derives `changeKind` per row: `createdInWindow = createdAt != nil && createdAt.prefix(10) > from && createdAt.prefix(10) <= to` (lib:303-306 uses `slice(0,10)`), `component = "\(target ?? "(unknown)")\(qty)"` where `target = componentType=="recipe" ? recipeSlug : vendorIngredient` and `qty = qtyPerServing != nil ? " × \(jsNum(qty)) \(unit ?? "")".trimEnd : ""` (lib:307-309), `changedAt = createdInWindow ? createdAt : (updatedAt ?? createdAt) ?? ""` (lib:315).
- `countCorrections`: repository hands both lists (both SQL-windowed + capped 60). Compute maps audits → parse `payloadJson` for `transition` (JSON decode, on failure leave nil — lib:353-361), maps closed → `count_closed` items, returns **`closedItems + auditItems` then `.prefix(60)`** (lib:411 — closed counts come FIRST; note this corrects the prompt's "audits parse ... union" ordering).
- `unresolvedDepletions`: `windowed = dateLikeCount > 0 || totalCount == 0` (lib:444). Build a `Set` of `normalizeDishName(dc.dishName)` for components scoped to same location (repository already location-scoped). Filter sales where `normalizeDishName(sl.itemName)` NOT in the set (the `dc.id IS NULL` LEFT-JOIN). If `windowed`, additionally require `periodLabel` matches the date GLOB `^\d{4}-\d{2}-\d{2}$` AND `periodLabel > from && periodLabel <= to`. Then GROUP BY `(itemName, periodLabel)` summing `quantitySold` and `jsRound(netSales*100)/100` (the SQL `ROUND(SUM(net_sales),2)`), ORDER BY `netSales DESC, itemName ASC`, `.prefix(60)`. `note = windowed ? nil : "period_label values for this location are not date-like; showing all-time unresolved depletions instead of the window."` (lib:470-473).
- `normalizeDishName`: `s.lowercased()`, replace runs of `[^a-z0-9]+` with single space, trim.

Steps:
- [ ] Step 1: Append failing tests using oracle inputs:
```swift
    // Oracle price_moves: Avocado 10→12 (+20%), linked; Lime flat (excluded);
    // Tomato out-of-window (repository won't hand it in). Here we hand only in-window snaps.
    func testPriceMovesFirstToLastAndLinkFlag() {
        let snaps = [
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 10, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 12, snapshotAt: "2026-05-10 12:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "LIM-1", ingredient: "Lime", unitPrice: 5, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "LIM-1", ingredient: "Lime", unitPrice: 5, snapshotAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.priceMoves(snaps: snaps, linkedIngredients: ["Avocado"])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].ingredient, "Avocado")
        XCTAssertEqual(out[0].firstPrice, 10); XCTAssertEqual(out[0].lastPrice, 12)
        XCTAssertEqual(out[0].pctMove, 20); XCTAssertEqual(out[0].snapshots, 2)
        XCTAssertTrue(out[0].linkedToMenu)
    }

    // Oracle composition_changes: New Dish created-in-window; Edited Dish (created 2026-01,
    // updated in-window) → "updated" + component contains salsa-verde; Old Dish excluded by repo.
    func testCompositionChangeKind() {
        let rows = [
            CompRow(dishName: "New Dish", componentType: "vendor_item", recipeSlug: nil, vendorIngredient: "Halibut",
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-05-10 12:00:00", updatedAt: "2026-05-10 12:00:00"),
            CompRow(dishName: "Edited Dish", componentType: "recipe", recipeSlug: "salsa-verde", vendorIngredient: nil,
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-01-01 00:00:00", updatedAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.compositionChanges(rows: rows, from: "2026-05-01", to: "2026-05-15")
        let byDish = Dictionary(uniqueKeysWithValues: out.map { ($0.dishName, $0) })
        XCTAssertEqual(byDish["New Dish"]?.changeKind, "created")
        XCTAssertEqual(byDish["Edited Dish"]?.changeKind, "updated")
        XCTAssertTrue(byDish["Edited Dish"]!.component.contains("salsa-verde"))
    }

    // Oracle count_corrections: 1 closed + 2 audits (reopen + line update), closed first.
    func testCountCorrectionsUnionClosedFirst() {
        let audits = [
            AuditRow(entity: "inventory_counts", entityId: 1, action: "update",
                     actorCookId: "cook-1", payloadJson: "{\"transition\":\"reopen\"}", createdAt: "2026-05-10 12:00:00"),
            AuditRow(entity: "inventory_count_lines", entityId: 1, action: "update",
                     actorCookId: "cook-2", payloadJson: nil, createdAt: "2026-05-10 12:00:00"),
        ]
        let closed = [ClosedCountRow(id: 7, label: "Weekly walk-in", countDate: "2026-05-09", closedAt: "2026-05-10 12:00:00", lines: 3)]
        let out = VarianceAttributionCompute.countCorrections(audits: audits, closed: closed)
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out[0].kind, "count_closed")            // closed first
        XCTAssertEqual(out[0].label, "Weekly walk-in"); XCTAssertEqual(out[0].lines, 3)
        XCTAssertEqual(out.first { $0.transition == "reopen" }?.entity, "inventory_counts")
    }

    // Oracle unresolved: Mystery Burger in-window unresolved; Guac Bowl resolved (has component).
    func testUnresolvedDepletionsWindowed() {
        let sales = [
            SalesLineRow(itemName: "Mystery Burger", periodLabel: "2026-05-08", quantitySold: 4, netSales: 60),
            SalesLineRow(itemName: "Mystery Burger", periodLabel: "2026-04-15", quantitySold: 9, netSales: 135),
            SalesLineRow(itemName: "Guac Bowl", periodLabel: "2026-05-08", quantitySold: 2, netSales: 24),
        ]
        let comps = [CompRow(dishName: "Guac Bowl", componentType: "vendor_item", recipeSlug: nil,
                             vendorIngredient: "Avocado", qtyPerServing: 1, unit: "ea",
                             createdAt: "2026-01-01 00:00:00", updatedAt: "2026-01-01 00:00:00")]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: comps,
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 3, totalCount: 3)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].itemName, "Mystery Burger")
        XCTAssertEqual(r.items[0].periodLabel, "2026-05-08")
        XCTAssertEqual(r.items[0].qtySold, 4); XCTAssertEqual(r.items[0].netSales, 60)
        XCTAssertNil(r.note)
    }

    // Oracle: "treats punctuation and casing variants as resolved" — GUAC---BOWL!!! resolves to Guac Bowl.
    func testUnresolvedNormalizationResolvesVariants() {
        let sales = [SalesLineRow(itemName: "GUAC---BOWL!!!", periodLabel: "2026-05-08", quantitySold: 2, netSales: 24)]
        let comps = [CompRow(dishName: "Guac Bowl", componentType: "vendor_item", recipeSlug: nil,
                             vendorIngredient: "Avocado", qtyPerServing: 1, unit: "ea", createdAt: nil, updatedAt: nil)]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: comps,
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 1, totalCount: 1)
        XCTAssertEqual(r.items.count, 0)
    }

    // Oracle: "falls back to all-time with honest note" — non-date-like labels.
    func testUnresolvedAllTimeFallbackNote() {
        let sales = [SalesLineRow(itemName: "Legacy Item", periodLabel: "Lunch FY26", quantitySold: 7, netSales: 70)]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: [],
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 0, totalCount: 1)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].itemName, "Legacy Item")
        XCTAssertTrue(r.note!.contains("not date-like"))
    }

    func testNormalizeDishName() {
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("GUAC---BOWL!!!"), "guac bowl")
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName(nil), "")
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("  Mtn  Mac & Cheese "), "mtn mac cheese")
    }
```
- [ ] Step 2: `swift test --filter VarianceAttributionComputeTests` → fail.
- [ ] Step 3: Implement the extension. Key pieces:
```swift
extension VarianceAttributionCompute {
    static let sectionLimit = 60

    static func normalizeDishName(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        var out = "", lastWasSep = false
        for ch in s.lowercased() {
            if ch.isLetter && ch.isASCII || (ch.isNumber && ch.isASCII) {
                out.append(ch); lastWasSep = false
            } else if !lastWasSep { out.append(" "); lastWasSep = true }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    static func priceMoves(snaps: [PriceSnapRow], linkedIngredients: Set<String>) -> [PriceMoveItem] {
        var order: [String] = []; var groups: [String: [PriceSnapRow]] = [:]
        for s in snaps {
            let key = "\(s.vendor)|\(s.sku)|\(s.ingredient)"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(s)
        }
        var moves: [PriceMoveItem] = []
        for key in order {
            let arr = groups[key]!
            guard arr.count >= 2, let first = arr.first, let last = arr.last else { continue }
            if first.unitPrice == last.unitPrice { continue }
            let pct: Double?
            if let f = first.unitPrice, let l = last.unitPrice, f != 0 {
                pct = jsRound(((l - f) / f) * 100 * 10) / 10
            } else { pct = nil }
            moves.append(PriceMoveItem(vendor: first.vendor, sku: first.sku, ingredient: first.ingredient,
                firstPrice: first.unitPrice, lastPrice: last.unitPrice, pctMove: pct,
                firstAt: first.snapshotAt, lastAt: last.snapshotAt, snapshots: arr.count,
                linkedToMenu: linkedIngredients.contains(first.ingredient)))
        }
        // Stable sort by |pctMove| DESC (JS Array.sort is stable; equal keys keep insertion order).
        return Array(moves.enumerated().sorted {
            let a = abs($0.element.pctMove ?? 0), b = abs($1.element.pctMove ?? 0)
            if a != b { return a > b }
            return $0.offset < $1.offset
        }.map(\.element).prefix(sectionLimit))
    }
    // compositionChanges, countCorrections, unresolvedDepletions per the notes above;
    // unresolvedDepletions builds Set(components.map { normalizeDishName($0.dishName) }),
    // groups by "\(itemName)\u{0}\(periodLabel ?? "")", sums qty + round2(netSales),
    // sorts netSales DESC then itemName ASC (stable), prefix(60).
}
```
For the JS `first.unit_price === last.unit_price` when both are `nil`: `Optional<Double> ==` treats `nil == nil` as `true`, matching JS `null === null`. For unresolved GROUP-BY ordering, use a stable sort mirroring `ORDER BY net_sales DESC, item_name ASC` — since SUM already groups, sort the grouped items.
- [ ] Step 4: `swift test --filter VarianceAttributionComputeTests` → pass.
- [ ] Step 5: `swift build && swift test` full green; commit `feat(native): A4.2 variance-attribution evidence-section compute`.

**Parity oracle cases covered:** `price_moves section` → "reports first→last unit price inside the window and flags menu-linked items"; `composition_changes section` → "includes rows created or updated in-window and excludes older edits"; `count_corrections section` → "includes in-window count lifecycle audits and closed counts, excludes older ones"; `unresolved_depletions section` → all three ("windows on date-like period_labels...", "treats punctuation and casing variants as resolved", "falls back to all-time with an honest note"). `normalizeDishName` author-fresh vs `lib/dishCostBridge.ts:49-55`.

**Risks:** (1) count_corrections output order is closed-first (`lib:411`) — the prompt's phrasing implied audits-parse-first; the oracle's `count_closed` finder is order-agnostic but the display's implicit ordering must match. (2) `netSales` rounding uses `round2` = `jsRound(x*100)/100` to mirror SQL `ROUND(...,2)` (SQLite ROUND is half-away-from-zero, but positive money sums make this equivalent to jsRound here; document if a negative net_sales tie ever appears). (3) `normalizeDishName` must collapse `[^a-z0-9]+` AFTER lowercasing — do NOT include Unicode letters (JS regex `[^a-z0-9]` is ASCII-only), hence the `ch.isASCII` guard. (4) price `pctMove` rounds to 1dp (`*10)/10`), NOT 2dp — distinct from the delta rounding.

---

### Task 3: `VarianceAttributionRepository` — 5 SELECTs + in-Swift JOIN, assembles payload

**Files:**
- Create: `LariatNative/Sources/LariatDB/VarianceAttributionRepository.swift`
- Modify: `LariatNative/Sources/LariatModel/VarianceAttributionRecords.swift` (add `VarianceAttributionResult` payload struct)
- Test: `LariatNative/Tests/LariatDBTests/VarianceAttributionRepositoryTests.swift`

**Interfaces produced:**
```swift
public struct VarianceAttributionResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?
    public let locationId: String
    public let window: VarianceAttrWindow
    public let variance: VarianceAttrDelta
    public let priceMoves: [PriceMoveItem]
    public let compositionChanges: [CompositionChangeItem]
    public let countCorrections: [CountCorrectionItem]
    public let unresolvedDepletions: [UnresolvedDepletionItem]
    public let unresolvedNote: String?
    public let unattributed: Bool
    public let caveat: String
}
public struct VarianceAttributionRepository {
    public init(database: LariatDatabase, locationId: String = LocationScope.resolve())
    public func load(from: String? = nil, to: String? = nil) async throws -> VarianceAttributionResult
}
```
**Interfaces consumed:** `LariatDatabase` (read-only pool), `VarianceAttributionCompute.*`, all record/raw-row structs, `VarianceAttrWindowResult`.

Design (mirrors `MarginDeltasRepository.load`, single `pool.read`):
1. Fetch `recentCount` = row count of `SELECT period_start, period_end FROM accounting_variance WHERE location_id=? AND period_end IS NOT NULL ORDER BY period_end DESC, id DESC LIMIT 2` (lib:174-178) — pass its `.count` and the two rows.
2. Determine baseline/current `VarianceAttrRow` via `variancePeriodByEnd` SQL (lib:191-200: `SELECT ... WHERE location_id=? AND period_end=? ORDER BY id DESC LIMIT 1`) — for default path use the two recent `period_end`s (index 1 = baseline/previous, index 0 = current/latest); for explicit path fetch each of `from`/`to`.
3. Call `VarianceAttributionCompute.selectWindow(...)`. On `.failed(reason)`, return the empty payload (all sections empty, `window`=(nil,nil), `unattributed: true`, `ok: false`, `caveat`) — mirror `emptyPayload` (lib:150-164).
4. On `.ok(window, delta)`, run the four section SELECTs with `from=window.from!, to=window.to!`:
   - price snaps SQL (lib:205-211) + linked-ingredient SQL (lib:227-231, `component_type='vendor_item' AND vendor_ingredient IS NOT NULL DISTINCT`) → `priceMoves`.
   - dish_components windowed SQL (lib:279-289) → `compositionChanges`.
   - audit_events SQL (lib:333-341) + closed-counts SQL (lib:378-387, with the `(SELECT COUNT(*) FROM inventory_count_lines...)` subquery) → `countCorrections`.
   - unresolved: fetch ALL location-scoped `dish_components(dish_name)` for the JOIN set, `dateLikeCount` = `SELECT COUNT(*) ... WHERE period_label GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'` (lib:432-434), `totalCount` = `SELECT COUNT(*) FROM sales_lines WHERE location_id=?`, all sales rows (item_name, period_label, quantity_sold, net_sales) → `unresolvedDepletions` (in-Swift normalize+filter, NO GRDB custom function, per MarginDeltas precedent).
5. Assemble `VarianceAttributionResult` with `unattributed = priceMoves.isEmpty && composition.isEmpty && corrections.isEmpty && unresolved.isEmpty` (lib:561-565) and the fixed `caveat` string (lib:121-123).

Steps:
- [ ] Step 1: Write failing repository tests. Use the `makeDB(seed:)` harness copied from `MarginDeltasRepositoryTests.swift:18-55`, extended to CREATE all six tables with the EXACT columns from `lib/db.ts` (DDL below). Reproduce the oracle's `seedTwoPeriods` + cross-location isolation:
```swift
import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class VarianceAttributionRepositoryTests: XCTestCase {
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-vattr-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE accounting_variance (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  period_start TEXT, period_end TEXT, theoretical_cogs REAL, actual_cogs REAL,
                  variance_amount REAL, variance_pct REAL,
                  snapshot_at TEXT DEFAULT (datetime('now')), location_id TEXT DEFAULT 'default');
                CREATE TABLE vendor_prices_history (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT, vendor TEXT, sku TEXT, pack_size REAL, pack_unit TEXT,
                  pack_price REAL, unit_price REAL, category TEXT,
                  location_id TEXT NOT NULL DEFAULT 'default', snapshot_at TEXT,
                  snapshot_reason TEXT, run_id INTEGER);
                CREATE TABLE dish_components (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default', dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe','vendor_item')),
                  recipe_slug TEXT, vendor_ingredient TEXT, qty_per_serving REAL NOT NULL,
                  unit TEXT NOT NULL, notes TEXT,
                  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL, location_id TEXT DEFAULT 'default', actor_cook_id TEXT,
                  actor_source TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
                  action TEXT NOT NULL CHECK(action IN ('insert','update','delete','correction','view')),
                  replaces_id INTEGER, payload_json TEXT, note TEXT,
                  created_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE inventory_counts (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  count_date TEXT NOT NULL, label TEXT, opened_at TEXT DEFAULT (datetime('now')),
                  closed_at TEXT, cook_id TEXT, location_id TEXT NOT NULL DEFAULT 'default');
                CREATE TABLE inventory_count_lines (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  count_id INTEGER NOT NULL, vendor TEXT, ingredient TEXT NOT NULL,
                  sku TEXT NOT NULL DEFAULT '', on_hand_qty REAL, unit TEXT, par_qty REAL,
                  par_unit TEXT, note TEXT, counted_by TEXT,
                  counted_at TEXT DEFAULT (datetime('now')), location_id TEXT NOT NULL DEFAULT 'default');
                CREATE TABLE sales_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, period_label TEXT,
                  item_name TEXT NOT NULL, quantity_sold REAL, net_sales REAL, source TEXT,
                  location_id TEXT DEFAULT 'default', imported_at TEXT DEFAULT (datetime('now')));
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }

    private func seedTwoPeriods(_ db: Database, loc: String = "default") throws {
        try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,theoretical_cogs,actual_cogs,variance_amount,variance_pct,location_id) VALUES ('2026-04-18','2026-05-01',1000,1020,20,2,?)", arguments: [loc])
        try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,theoretical_cogs,actual_cogs,variance_amount,variance_pct,location_id) VALUES ('2026-05-02','2026-05-15',1000,1055,55,5.5,?)", arguments: [loc])
    }

    // Oracle GET happy path: Avocado 10→12 in-window → price_moves.count == 1, window (05-01,05-15].
    func testDefaultWindowWithPriceMove() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db)
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('default','sysco','AVO-1','Avocado',10,'2026-05-03 08:00:00')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('default','sysco','AVO-1','Avocado',12,'2026-05-10 12:00:00')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(r.priceMoves.count, 1)
        XCTAssertEqual(r.priceMoves[0].ingredient, "Avocado")
        XCTAssertEqual(r.variance.deltaPct, 3.5)
        XCTAssertFalse(r.caveat.isEmpty)
    }

    // Oracle: explicit missing period → ok:false, reason mentions the date, sections empty.
    func testExplicitMissingPeriodFails() async throws {
        let (db, dir) = try makeDB { db in try self.seedTwoPeriods(db) }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let repo = VarianceAttributionRepository(database: db, locationId: "default")
        let r = try await repo.load(from: "2026-01-01", to: "2026-05-15")
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason!.contains("2026-01-01"))
        XCTAssertEqual(r.priceMoves.count, 0)
        XCTAssertTrue(r.unattributed)
    }

    // Oracle cross-location isolation (kitchen-a) — window and every section scoped.
    func testCrossLocationIsolation() async throws {
        let (db, dir) = try makeDB { db in
            try self.seedTwoPeriods(db, loc: "kitchen-a")
            try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,variance_amount,variance_pct,location_id) VALUES ('2026-05-02','2026-05-20',90,9,'kitchen-b')")
            try db.execute(sql: "INSERT INTO accounting_variance (period_start,period_end,variance_amount,variance_pct,location_id) VALUES ('2026-04-18','2026-05-01',10,1,'kitchen-b')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('kitchen-a','sysco','AVO-1','Avocado',10,'2026-05-03 08:00:00')")
            try db.execute(sql: "INSERT INTO vendor_prices_history (location_id,vendor,sku,ingredient,unit_price,snapshot_at) VALUES ('kitchen-a','sysco','AVO-1','Avocado',12,'2026-05-10 12:00:00')")
            try db.execute(sql: "INSERT INTO sales_lines (item_name,period_label,quantity_sold,net_sales,location_id) VALUES ('A Burger','2026-05-08',2,20,'kitchen-a')")
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let r = try await VarianceAttributionRepository(database: db, locationId: "kitchen-a").load()
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(r.priceMoves.count, 1)
        XCTAssertEqual(r.unresolvedDepletions.count, 1)
        XCTAssertEqual(r.unresolvedDepletions[0].itemName, "A Burger")
    }
}
```
- [ ] Step 2: `swift test --filter VarianceAttributionRepositoryTests` → fail (repo undefined).
- [ ] Step 3: Implement `VarianceAttributionRepository.swift`. Single `try await database.pool.read { db in ... }`; use `Row.fetchAll(db, sql:arguments:)` and map into the raw-row structs (mirror `MarginDeltasRepository:27-57`), assemble via the compute functions, return `VarianceAttributionResult`. Include the `emptyPayload` helper for `.failed`. GLOB literal for `period_label` and date filters embedded exactly as `lib:127,432-434,456`.
- [ ] Step 4: `swift test --filter VarianceAttributionRepositoryTests` → pass.
- [ ] Step 5: `swift build && swift test` full green; commit `feat(native): A4.2 variance-attribution repository`.

**Parity oracle cases covered:** `GET /api/costing/variance-attribution` → "returns the attribution payload" (the payload half, minus HTTP headers); `buildVarianceAttribution() window selection` → "honors explicit from/to overrides", "returns a coherent ok:false payload when an explicit period is missing"; `cross-location isolation` → "scopes every section (and the window itself) to the requested location".

**Risks:** (1) `variancePeriodByEnd` uses `ORDER BY id DESC LIMIT 1` — if a location has duplicate period_end rows, pick the highest id (matches lib:198). (2) `snapshot_at` window uses `date(snapshot_at) > ? AND date(snapshot_at) <= ?` — the SQL `date()` truncation must be preserved (do NOT compare raw timestamps). (3) The linked-ingredient SQL is a SEPARATE query, not part of the price-snap query. (4) `net_sales`/`ROUND(SUM,2)` is done in-Swift via `round2` since the JOIN + GROUP moved into Swift; the SQL no longer runs `ROUND`. (5) No `Cache-Control`/400-date validation lives here — that is the middleware/route concern (web-only), NOT ported (documented as N/A for native).

---

### Task 4: App layer — `VarianceAttributionView` + `@Observable` VM + A0 registration (NEW `.costing` tier)

**Files:**
- Create: `LariatNative/Sources/LariatApp/VarianceAttributionView.swift` (View + `VarianceAttributionViewModel`)
- Create: `LariatNative/Sources/LariatApp/CostingFeatures.swift` (the new tier's `FeatureModule`s)
- Modify: `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (add `.costing` tier case; relocate `manager.costing` → `costing.overview`; add `costing.varianceAttribution` descriptor)
- Modify: `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (move `.managerCosting` → `.costingOverview`; add `.costingVarianceAttribution`)
- Modify: `LariatNative/Sources/LariatApp/ManagerFeatures.swift` (rename `managerCosting` module → `costingOverview` with id `"costing.overview"`)
- Test: `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` (append A4.2 assertions)

**Interfaces produced:**
```swift
@Observable @MainActor final class VarianceAttributionViewModel {
    var result: VarianceAttributionResult?
    var errorText: String?
    init(database: LariatDatabase)
    func start()   // 3s poll via VarianceAttributionRepository (mirror CostingViewModel:26-53)
    func stop()
}
struct VarianceAttributionView: View { init(database: LariatDatabase) }
extension FeatureModule {
    static let costingOverview: FeatureModule            // id "costing.overview" — the relocated aggregate
    static let costingVarianceAttribution: FeatureModule // id "costing.varianceAttribution"
}
```
**Interfaces consumed:** `VarianceAttributionRepository`, `VarianceAttributionResult`, `AppContext`, `FeatureCatalog`, `FeatureModule`, `TileDegrade`.

Steps:
- [ ] Step 1: Write the failing registry test (append to `FeatureRegistryTests.swift`):
```swift
    /// A4.2 costing wave: NEW .costing tier; the old manager.costing aggregate is
    /// relocated to costing.overview; the variance-attribution board is registered.
    func testCostingTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
        // Relocated aggregate.
        let overview = FeatureCatalog.descriptor(id: "costing.overview")
        XCTAssertNotNil(overview, "costing.overview must be registered")
        XCTAssertEqual(overview?.tier, .costing)
        XCTAssertEqual(overview?.title, "Costing")
        // The old manager.costing id must be gone (moved, not duplicated).
        XCTAssertNil(FeatureCatalog.descriptor(id: "manager.costing"),
                     "manager.costing must be relocated to costing.overview")
        // New board.
        let va = FeatureCatalog.descriptor(id: "costing.varianceAttribution")
        XCTAssertNotNil(va, "costing.varianceAttribution must be registered")
        XCTAssertEqual(va?.tier, .costing)
        XCTAssertEqual(va?.title, "Variance attribution")
        XCTAssertEqual(va?.enabled, true)
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }
```
- [ ] Step 2: `swift test --filter FeatureRegistryTests` → fail (`.costing` case missing).
- [ ] Step 3: Edit `FeatureCatalog.swift`:
  - Add `case costing = "Costing"` to `FeatureTier` (append after `.manager` so sidebar order puts Costing last; confirm ordering intent with the wave lead if Costing should sit near Manager).
  - Remove `FeatureDescriptor(id: "manager.costing", tier: .manager, title: "Costing")`.
  - Add to `all`: `FeatureDescriptor(id: "costing.overview", tier: .costing, title: "Costing")` and `FeatureDescriptor(id: "costing.varianceAttribution", tier: .costing, title: "Variance attribution")`.
  Edit `ManagerFeatures.swift`: rename `managerCosting` → move its body into `CostingFeatures.swift` as `costingOverview` with `FeatureModule(id: "costing.overview") { ctx in AnyView(CostingView(database: ctx.database)) }`. Create `CostingFeatures.swift`:
```swift
import SwiftUI
extension FeatureModule {
    static let costingOverview = FeatureModule(id: "costing.overview") { ctx in
        AnyView(CostingView(database: ctx.database))
    }
    static let costingVarianceAttribution = FeatureModule(id: "costing.varianceAttribution") { ctx in
        AnyView(VarianceAttributionView(database: ctx.database))
    }
}
```
  Edit `FeatureRegistry.swift`: replace `.managerCosting` with a new `// Costing` block: `.costingOverview, .costingVarianceAttribution`. Implement `VarianceAttributionView.swift` (VM + section-card content mirroring `CostingView`; header shows baseline→current badge with `thresholdColor`, delta, caveat, `unattributed` note; four `SectionCard`s; no PIN sheet).
- [ ] Step 4: `swift test --filter FeatureRegistryTests` → pass; `swift build` (compiles app target).
- [ ] Step 5: `swift build && swift test` full green; commit `feat(native): A4.2 costing tier + variance-attribution board (relocate costing.overview)`.

**Parity oracle cases covered:** author-fresh registration assertions (no web oracle for tier structure). View rendering mirrors `app/costing/variance-attribution/page.jsx` sections/labels (Price moves / Dish composition changes / Count corrections / Unresolved depletions) — visual parity, not asserted by tests.

**Risks:** (1) Relocation must MOVE not DUPLICATE `manager.costing` — `testIdsAreUnique` (existing) fails if both ids coexist; the new test asserts `manager.costing` is nil. (2) `manager` tier must still have ≥1 module after removal (Command/Analytics/Management remain) so `testEveryTierHasAtLeastOneModule` stays green. (3) `CostingView`'s `.navigationTitle` stays "Cost checks"; the sidebar title comes from the descriptor "Costing" — unchanged behavior. (4) Adding a `FeatureTier` case is exhaustive-switch-safe here (enum switches over tiers in the sidebar use `allCases`, not literal switches) — verify `swift build` catches any non-exhaustive switch introduced elsewhere.

---

Sources cited: `lib/varianceAttribution.ts` (all rules), `lib/dishCostBridge.ts:49-55` (normalizeDishName), `app/api/costing/variance-attribution/route.js` (route contract — not ported), `tests/js/test-variance-attribution.mjs` (oracle values), `lib/db.ts:1052-1079,1396-1406,1564-1602,2910-2924,1298` (DDL), native `CostingCompute.swift:43-47,354-360` (ThresholdColor/colorFor reuse), `MarginDeltasRepository.swift` + `MarginDeltasRepositoryTests.swift:18-55` (in-Swift-normalize + fixture-harness precedent), `InventoryShrinkage.swift:86` (jsRound helper), `FeatureCatalog.swift`/`FeatureRegistry.swift`/`ManagerFeatures.swift`/`FeatureRegistryTests.swift` (A0 registration + tier machinery), `CostingView.swift:13-89` (App-layer VM+View precedent).

One correction to the prompt to flag: count_corrections output order is closed-counts-first (`[...closedItems, ...auditItems]`, lib:411), not audits-first.

#### Gap-fixes for varianceAttribution (fold into the tasks above during execution)

Now I have the full source. Let me cross-check the plan against every oracle test and lib rule.

Key things to verify against the plan's claims — particularly around the delta-rounding tie test, the composition-changes `date()` vs `slice(0,10)` inconsistency, the `count_corrections` window filter, and the route contract.

Let me look closely at a couple of details in the plan tests versus oracle behavior.

The oracle `count_corrections` test uses `action: 'update'` for all audits, but the lib SQL filters `action IN ('update','correction','delete')`. The plan's `countCorrections` compute signature takes `audits: [AuditRow]` already-filtered by the repository — but the plan's repository SQL description (Task 3 step, "audit_events SQL (lib:333-341)") needs that action filter. Let me confirm the plan reflects it.

Also checking the delta-rounding test in Task 1 (`testDeltaRoundingHalfUp`) — its own comment admits `Math.round(2.5*100)/100 = 2.5`, so it does NOT actually exercise a half-up tie. And the `jsRound` on negative ties is flagged as a risk but has no test.

I have everything needed to produce the gap list.

GAPS for varianceAttribution:

- **Oracle test NOT covered: `honors explicit from/to period_end overrides`** (test-variance-attribution.mjs:158-170). This is the happy-path explicit-override case (from `2026-04-17`, to `2026-05-01`, both present) that asserts `ok:true` and `window`/`baseline`/`current` period_ends. Task 1's `testExplicitMissingBaselineFails` only covers the *missing* explicit path; Task 3 lists this case under "covered" but writes NO test for it (its `testExplicitMissingPeriodFails` is the failure case). No `.ok` explicit-window test exists in any task.

- **Oracle test NOT covered: route contract tests** `GET /api/costing/variance-attribution` → `returns the attribution payload with no-store caching` (200 + `Cache-Control: no-store`, lines 401-415), `passes explicit from/to through to the builder` (417-428), and `400s on malformed from/to` (430-438). Plan declares these web-only/N/A (Task 3 Risk 5), which is defensible for the HTTP layer — but the 400-on-malformed-date validation (`from=05-01-2026`, `to=not-a-date`) has NO native equivalent and no test asserting the native layer rejects/handles non-`YYYY-MM-DD` input. If the SwiftUI VM ever accepts free-text date input this is an unported guard; at minimum flag the date-format validation as an explicit N/A with rationale, which the plan does not do.

- **Delta half-up rounding is claimed but NEVER tested.** Task 1 `testDeltaRoundingHalfUp` (its own inline comment) admits `Math.round(2.5*100)/100 = 2.5` — 2.5 is exact at 2dp, so this asserts `deltaAmount == 2.5` and does NOT exercise a `floor(x+0.5)` tie. The Risk note says negative ties like `-0.5` differ between `jsRound` and Swift `.rounded()`, but no test feeds a value where `x*100` lands on a `.5` tie (e.g. delta `0.005` → `0.5` → jsRound `1` → `0.01`, or a negative tie). The parity claim for the rounding helper is unverified by the provided tests.

- **`jsRound` on negative ties is WRONG for `net_sales`/delta.** lib uses JS `Math.round` = `floor(x+0.5)`, which for `-0.5` gives `0` (rounds toward +∞), NOT away from zero. The plan's `jsRound(_ x:) { (x + 0.5).rounded(.down) }` matches that. BUT for `net_sales` the lib does NOT use `Math.round` — it uses SQL `ROUND(SUM(net_sales),2)` (lib:450), and SQLite `ROUND` is half-**away-from-zero**. The plan (Task 2 Risk 2) maps `net_sales` to `round2`=`jsRound` and only hand-waves "positive money sums make this equivalent." For any negative `net_sales` sum with a `.5` tie at 2dp, `jsRound` (toward +∞) and SQLite `ROUND` (away from zero) diverge — this is a latent parity defect, not merely documented. The plan should either replicate SQLite's away-from-zero rounding for `net_sales` or keep `ROUND` in SQL.

- **`count_corrections` audit `action` filter is dropped from the compute contract and under-specified in the repository.** lib SQL filters `action IN ('update','correction','delete')` (lib:338). The plan's `countCorrections(audits:closed:)` compute takes pre-filtered audits and has NO test asserting a non-matching action (e.g. `insert`/`view`) is excluded, and the Task 3 repository step only cites "audit_events SQL (lib:333-341)" without calling out the action allow-list. The oracle's `eighty_six` row (line 281) tests the *entity* filter, but nothing tests the action filter. Also the entity filter (`IN ('inventory_counts','inventory_count_lines')`) lives only in the repo SQL — Task 2's `countCorrections` will happily emit any audit handed to it, so the entity/action scoping is entirely repo-SQL-dependent with no compute-level or oracle-mirrored test for the `eighty_six` exclusion.

- **`compositionChanges` uses `slice(0,10)` (string prefix) for `createdInWindow` but the repository SQL WHERE-clause uses `date(created_at)` truncation** (lib:285-287 vs 303-306). The plan's Task 2 correctly ports `createdAt.prefix(10)` for the change_kind re-derivation, but the Task 3 repository description for the compositionChanges SQL says "windowed SQL (lib:279-289)" without noting the WHERE filter uses `date(...)` (which strips a trailing `Z`/fractional seconds differently than a raw `slice(0,10)`). For a timestamp like `2026-05-10T12:00:00` the two agree, but the plan never states that the repo must use `date()` in the WHERE and `prefix(10)` in the compute — a subtle two-function-must-match constraint that is unstated.

- **`compositionChanges` `updated_at` window branch is not fully mirrored in compute.** lib re-derives `changedAt = createdInWindow ? created_at : (updated_at ?? created_at) ?? ''` (lib:315) AND `change_kind` from `createdInWindow` alone. A row created out-of-window but updated in-window yields `change_kind:'updated'` with `changed_at = updated_at`. The plan's `testCompositionChangeKind` covers the "Edited Dish" updated case, but no test asserts `changedAt` equals `updated_at` (not `created_at`) for that row, nor the fallback `updated_at ?? created_at`. Field-level parity of `changed_at` is untested.

- **Record field-name/casing divergence not flagged as a deliberate mapping.** The web `CountCorrectionItem` (lib:59-74) uses `kind: 'audit' | 'count_closed'`; the plan's Swift `CountCorrectionItem.kind` is a plain `String` with no enum, and comments `"audit" | "count_closed"`. Similarly `CompositionChangeItem.changeKind` is `String` not an enum despite lib's `'created' | 'updated'` union. These are placeholder-ish `String` types where the source has closed unions — no test pins the exact string values beyond `"created"`/`"updated"`/`"count_closed"` appearing incidentally. Minor, but the plan claims "byte-identical" parity elsewhere and should either use enums or note the intentional stringly-typed choice.

- **`unattributed`/section `count` fields: native `VarianceAttributionResult` drops the web `AttributionSection<T>{count,items}` wrapper.** Web payload nests each section as `{count, items}` (lib:104-107) and `unresolved_depletions` adds `note` (lib:88-91). The native struct flattens to bare arrays + a separate `unresolvedNote`. That's a reasonable native shape, but the plan's `unattributed` computation must use `unresolved.count === 0` semantics (lib:565 uses `unresolved.count`, which is `items.length`); the plan's Task 3 step 5 writes `unresolved.isEmpty` — equivalent, but the plan never states the section `count` values are intentionally dropped (a consumer/UI parity question for the four SectionCard headers, which likely display counts).

- **Missing A0 tier-ordering / `manager` tier residual verification.** Task 4 adds a `.costing` tier and relocates `manager.costing`→`costing.overview`, and Risk 2 asserts "Command/Analytics/Management remain" in `manager`. This is NOT verified against the actual `FeatureCatalog.swift` — the plan never Read the file to confirm those three `manager.*` descriptors exist, so `testEveryTierHasAtLeastOneModule` staying green is an unverified assumption. Likewise the `FeatureTier` `allCases` sidebar-ordering claim ("append after `.manager`") and the raw-value string `"Costing"` collision with the existing `manager.costing` title are asserted without reading the enum.

- **`priceMoves` `pct_move` null-branch sort is untested.** lib sorts by `Math.abs(b.pct_move ?? 0)` (lib:266-267) — a move with `pct=null` (when `first.unit_price==null` or `first==0`, lib:249-252) sorts as `0`. The plan ports this (`abs($0.element.pctMove ?? 0)`) but has NO test for a null-pct move (e.g. a group where `first.unit_price` is NULL but `last` differs → passes the `!==` move check, `pct=null`, still emitted). Since `null !== 5` is a "move," such a row IS emitted with `pctMove=nil`; no oracle or plan test covers the `unit_price==null` first-snapshot case, and the `Optional<Double> ==` `nil==nil` claim (Task 2) is likewise untested.

- **`normalizeDishName` empty-vs-whitespace parity untested for the all-separators case.** lib `''.replace(...).trim()` on an all-punctuation input like `"---"` yields `""` (JS: `"---"`→`" "`→`""`). The plan's Swift impl emits a leading space then trims — fine — but `testNormalizeDishName` doesn't cover the all-separator input, nor a leading/trailing-separator collapse to empty. The `!s.isEmpty` guard also short-circuits `""` but JS `!s` also treats `"0"`? No — JS `!"0"` is false, so `normalizeDishName("0")` returns `"0"`; the plan's `guard let s, !s.isEmpty` returns `""` for `nil`/`""` only, which matches, but this edge (numeric-string truthiness) is unstated and untested.

---


I now have full fidelity on every source and native convention. I have confirmed:

- No native unit-dimension/convert helper exists (grep returned nothing under `Sources/`) — the `cross_dim_unit_mismatch` / same-dim branch needs a ported `UnitConvert` helper as its own task.
- `bom_lines.loss_factor` is added by migration (lib/db.ts:3714), so fixtures must recreate it.
- The `.costing` tier and `costing.overview` relocation are prerequisites (assumed landed by the A4.2 wave's A0 task, per the wave conventions), so this board only appends its own descriptor/module/registry line/test assertion under `.costing`.
- `MarginDeltasRepository` is the exact read-only + in-Swift-normalize precedent; `InventoryShrinkage.applyShrinkage` + `jsRound` already exist and must be reused.

Here is the plan section.

---

## Board: costing.depletionExceptions (Depletion Exceptions — full 5-reason resolver)

**Prereqs from the A4.2 A0 wave (NOT this board's tasks — assert only):** the `FeatureTier.costing = "Costing"` case exists, the old `manager.costing` descriptor/module has been relocated to `costing.overview`, and `CostingFeatures.swift` + a `.costing` block in `FeatureRegistry.all` exist. This board appends into those.

**Reuse from existing native code (do NOT re-port):**
- `InventoryShrinkage.applyShrinkage(cookedQty:lossFactor:unit:)` and its `ShrinkageMath` (LariatModel/Compute/InventoryShrinkage.swift:37) — the raw-qty math. We only read `.rawQty`/`.applied` here; the exception resolver never emits depletions, but the recipe branch must still run shrinkage-free (`quantity_sold=1`, we discard depletions), so `applyShrinkage` is only pulled in indirectly if we choose to compute depletions. **Decision:** the exception replay only needs `unresolved[0]`, so the recipe-line loop does NOT need shrinkage at all — see Task 3.
- `IngredientKey.normalize` (LariatModel/Compute/IngredientKey.swift) — NOT used here (dish-name matching is `LOWER(TRIM())`, not the ingredient-key normalizer). Do not reuse it.
- `ManagementRollupRepository.loadDepletionExceptionCount` (~L234) — the count-only baseline. This board does NOT extend it; it builds a richer repository. Leave the count method untouched (it still powers a Management tile).

**Baseline correction vs the prompt:** the prompt says the SQL limits "after filtering" — confirmed, but note the web applies `limit` as a *break inside the per-dish replay loop* (depletionExceptions.ts:162 `if (exceptions.length >= limit) break`), NOT a SQL `LIMIT`. The aggregation SQL has NO `LIMIT` clause. The port must mirror this: full aggregation, then stop pushing once `exceptions.count >= limit`. The "limit [1,1000] default 200" clamp is `Math.max(1, Math.min(1000, opts.limit ?? 200))` (depletionExceptions.ts:76).

---

### Task 1: Port the unit-dimension/convert helper (`UnitConvert`) — same-dim + dimension only

The `cross_dim_unit_mismatch` reason and the same-dim ratio both depend on `normalizeUnit` / `unitDimension` / `convertQty`. No native equivalent exists. Port ONLY the three functions `computeRecipeRatio` transitively needs: `normalizeUnit`, `unitDimension`, and same-dim + cross-dim `convertQty` (cross-dim density path returns nil when density is nil, which is always the case here — but port it faithfully for parity and future reuse). `bridgeCount` / `convertPackSizeToLineUnit` are OUT of scope (count-bridge is T4/T5 costing, not depletion-exception territory).

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/UnitConvert.swift`
- Test: `LariatNative/Tests/LariatModelTests/UnitConvertTests.swift`

**Interfaces produced:**
```swift
public enum UnitConvert {
    public static func normalizeUnit(_ raw: String?) -> String
    public static func unitDimension(_ canon: String) -> String?   // "weight"|"volume"|"count"|nil
    public static func convertQty(_ qty: Double, from fromUnit: String?, to toUnit: String?, gPerMl: Double?) -> Double?
}
```
**Consumes:** nothing (leaf helper).

- [ ] **Step 1: Write failing test.** Mirror `lib/unitConvert.mjs` exact tables + `test-sales-depletion.mjs::computeRecipeRatio` cases that flow through convert:
```swift
import XCTest
@testable import LariatModel

final class UnitConvertTests: XCTestCase {
    func testNormalizeSynonyms() {
        XCTAssertEqual(UnitConvert.normalizeUnit("Pounds"), "lb")
        XCTAssertEqual(UnitConvert.normalizeUnit(" TSP "), "tsp")
        XCTAssertEqual(UnitConvert.normalizeUnit("fl oz"), "floz")
        XCTAssertEqual(UnitConvert.normalizeUnit(nil), "")
        XCTAssertEqual(UnitConvert.normalizeUnit("cups"), "cup")
    }
    func testUnitDimension() {
        XCTAssertEqual(UnitConvert.unitDimension("oz"), "weight")
        XCTAssertEqual(UnitConvert.unitDimension("cup"), "volume")
        XCTAssertEqual(UnitConvert.unitDimension("ea"), "count")
        XCTAssertNil(UnitConvert.unitDimension("furlong"))
    }
    func testConvertIdentity() {
        XCTAssertEqual(UnitConvert.convertQty(5, from: "ea", to: "each", gPerMl: nil), 5)
        XCTAssertEqual(UnitConvert.convertQty(0, from: "cup", to: "cup", gPerMl: nil), 0)
    }
    func testConvertSameDimVolume() {
        // 1 tsp → cup: tsp=4.92892159 ml, cup=236.5882365 ml → 0.0208333...
        let r = UnitConvert.convertQty(1, from: "tsp", to: "cup", gPerMl: nil)
        XCTAssertNotNil(r)
        XCTAssertEqual(r!, 4.92892159 / 236.5882365, accuracy: 1e-12)
    }
    func testConvertCrossDimWithoutDensityIsNil() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "oz", to: "cup", gPerMl: nil))
    }
    func testConvertCountRefusesBeyondIdentity() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "ea", to: "oz", gPerMl: nil))
    }
    func testConvertUnknownUnitIsNil() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "furlong", to: "oz", gPerMl: nil))
    }
    func testNonFiniteIsNil() {
        XCTAssertNil(UnitConvert.convertQty(.nan, from: "oz", to: "g", gPerMl: nil))
    }
}
```
- [ ] **Step 2: Run to fail** — `swift test --filter UnitConvertTests` (compile error: no `UnitConvert`).
- [ ] **Step 3: Minimal implementation.** Byte-exact port of the three constant tables + functions from `lib/unitConvert.mjs` (lines 32–63, 65–90, 92–148, 156–248). Real Swift:
```swift
import Foundation

/// Byte-exact port of the subset of `lib/unitConvert.mjs` that `computeRecipeRatio`
/// needs: normalizeUnit + unitDimension + convertQty (identity, same-dim, cross-dim).
/// Python (scripts/lib/units.py) is authoritative; JS mirrors it and we mirror JS.
/// bridgeCount / convertPackSizeToLineUnit are intentionally NOT ported (T4/T5).
public enum UnitConvert {
    static let weightToG: [String: Double] = [
        "mg": 0.001, "g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0,
        "oz": 28.3495231, "lb": 453.59237, "lbs": 453.59237,
        "pound": 453.59237, "pounds": 453.59237,
    ]
    static let volumeToMl: [String: Double] = [
        "ml": 1.0, "l": 1000.0, "liter": 1000.0, "litre": 1000.0,
        "tsp": 4.92892159, "tbsp": 14.78676478, "floz": 29.5735296,
        "fl_oz": 29.5735296, "fl oz": 29.5735296, "cup": 236.5882365,
        "cups": 236.5882365, "pt": 473.176473, "pint": 473.176473,
        "qt": 946.352946, "quart": 946.352946, "gal": 3785.411784, "gallon": 3785.411784,
    ]
    static let countToEa: [String: Double] = [
        "ea": 1.0, "each": 1.0, "pc": 1.0, "pcs": 1.0, "ct": 1.0, "count": 1.0,
        "pk": 1.0, "pack": 1.0, "cs": 1.0, "case": 1.0, "bag": 1.0, "bottle": 1.0,
        "btl": 1.0, "can": 1.0, "cn": 1.0, "jar": 1.0, "bunch": 1.0, "box": 1.0,
        "slice": 1.0, "sprig": 1.0, "clove": 1.0, "doz": 12.0, "dozen": 12.0,
    ]
    static let synonyms: [String: String] = [
        "": "", "pound": "lb", "pounds": "lb", "lbs": "lb", "ounce": "oz", "ounces": "oz",
        "gram": "g", "grams": "g", "kilogram": "kg", "kilograms": "kg",
        "milligram": "mg", "milligrams": "mg", "liter": "l", "litre": "l", "liters": "l",
        "millilitre": "ml", "milliliter": "ml", "milliliters": "ml",
        "teaspoon": "tsp", "teaspoons": "tsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
        "fluid_ounce": "floz", "fluid ounce": "floz", "fl_oz": "floz", "fl oz": "floz",
        "cups": "cup", "pint": "pt", "pints": "pt", "quart": "qt", "quarts": "qt",
        "gallon": "gal", "gallons": "gal", "each": "ea", "pcs": "pc", "count": "ct",
        "pack": "pk", "packs": "pk", "case": "cs", "cases": "cs", "bags": "bag",
        "bottles": "bottle", "btl": "bottle", "cans": "can", "#10 can": "can",
        "#10_can": "can", "jars": "jar", "bunches": "bunch", "boxes": "box",
        "slices": "slice", "sprigs": "sprig", "cloves": "clove", "dozen": "doz", "dozens": "doz",
    ]

    public static func normalizeUnit(_ raw: String?) -> String {
        guard let raw else { return "" }
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if s.isEmpty { return "" }
        return synonyms[s] ?? s
    }

    public static func unitDimension(_ canon: String) -> String? {
        if weightToG[canon] != nil { return "weight" }
        if volumeToMl[canon] != nil { return "volume" }
        if countToEa[canon] != nil { return "count" }
        return nil
    }

    public static func convertQty(_ qty: Double, from fromUnit: String?, to toUnit: String?, gPerMl: Double?) -> Double? {
        guard qty.isFinite else { return nil }
        let from = normalizeUnit(fromUnit)
        let to = normalizeUnit(toUnit)
        if from.isEmpty || to.isEmpty { return nil }
        if from == to { return qty }                                  // identity (incl. count)
        guard let fromDim = unitDimension(from), let toDim = unitDimension(to) else { return nil }
        if fromDim == "count" || toDim == "count" { return nil }
        if fromDim == toDim {
            if fromDim == "weight" {
                guard let fg = weightToG[from], let tg = weightToG[to], fg > 0, tg > 0 else { return nil }
                return (qty * fg) / tg
            }
            guard let fm = volumeToMl[from], let tm = volumeToMl[to], fm > 0, tm > 0 else { return nil }
            return (qty * fm) / tm
        }
        guard let d = gPerMl, d.isFinite, d > 0 else { return nil }
        if fromDim == "volume", toDim == "weight" {
            let g = qty * volumeToMl[from]! * d
            guard let tg = weightToG[to], tg > 0 else { return nil }
            return g / tg
        }
        if fromDim == "weight", toDim == "volume" {
            let ml = (qty * weightToG[from]!) / d
            guard let tm = volumeToMl[to], tm > 0 else { return nil }
            return ml / tm
        }
        return nil
    }
}
```
- [ ] **Step 4: Run to pass** — `swift test --filter UnitConvertTests`.
- [ ] **Step 5: Build** — `swift build` (from `LariatNative/`), confirm green.

**Parity oracle cases covered:** author fresh vs `lib/unitConvert.mjs:32-248` (no dedicated native oracle file; the conversion values are pinned to the mjs constants). The volume/count/identity/cross-dim branches also back the `computeRecipeRatio` cases in `tests/js/test-sales-depletion.mjs:74-108`.

**Risks:** Swift `Dictionary` keys with a literal space (`"fl oz"`, `"fluid ounce"`, `"#10 can"`) are legal — do not drop them; they are reachable via `normalizeUnit` synonyms. `trimmingCharacters(in: .whitespaces)` vs JS `String.trim()`: JS trims a wider whitespace set, but unit strings are ASCII in this corpus; note the divergence but it is unreachable in practice. Float order-of-operations must match JS exactly: `(qty * fg) / tg`, NOT `qty * (fg/tg)` — keep the parenthesization identical to preserve bit-for-bit parity with the oracle deltas.

---

### Task 2: `DepletionReason` + `computeRecipeRatio` + the pure exception classifier (`DepletionExceptionResolver`)

The 5-reason classifier is pure over caller-supplied rows. The repository (Task 3) does the SELECTs and passes value types in; this enum decides `unresolved[0]`. Port `computeRecipeRatio` (salesDepletion.ts:298-320) and a `classify(...)` that mirrors `resolveDepletionsForSale`'s unresolved-emission order (salesDepletion.ts:170-285), returning ONLY the first reason (the page/repo only ever read `unresolved[0]`).

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/DepletionExceptionResolver.swift`
- Test: `LariatNative/Tests/LariatModelTests/DepletionExceptionResolverTests.swift`

**Interfaces produced:**
```swift
public enum DepletionReason: String, Sendable, Equatable {
    case noDishComponents = "no_dish_components"
    case recipeMissingYield = "recipe_missing_yield"
    case crossDimUnitMismatch = "cross_dim_unit_mismatch"
    case unknownUnit = "unknown_unit"
    case invalidQty = "invalid_qty"
}

public struct DishComponentRow: Sendable {
    public let componentType: String   // "recipe"|"vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double
    public let unit: String
    public init(componentType: String, recipeSlug: String?, vendorIngredient: String?, qtyPerServing: Double, unit: String)
}
public struct RecipeYield: Sendable {
    public let yieldQty: Double?
    public let yieldUnit: String?
    public init(yieldQty: Double?, yieldUnit: String?)
}
public struct BomLineRow: Sendable {
    public let ingredient: String?
    public let qty: Double?
    public let unit: String?
    public let lossFactor: Double?
    public init(ingredient: String?, qty: Double?, unit: String?, lossFactor: Double?)
}

public struct DepletionUnresolved: Sendable, Equatable {
    public let reason: DepletionReason
    public let detail: String?
}

public enum DepletionExceptionResolver {
    public static func computeRecipeRatio(portionQty: Double, portionUnit: String?, yieldQty: Double, yieldUnit: String) -> Double?
    /// `yieldFor`/`bomFor` are lazy fetch closures the repo backs with SQL; the classifier
    /// stops at the first unresolved reason so it needn't fetch more than necessary.
    public static func firstUnresolved(
        quantitySold: Double,
        components: [DishComponentRow],
        yieldFor: (_ slug: String) -> RecipeYield?,
        bomFor: (_ slug: String) -> [BomLineRow]
    ) -> DepletionUnresolved?
}
```
**Consumes:** `UnitConvert.normalizeUnit` / `unitDimension` / `convertQty` (Task 1).

- [ ] **Step 1: Write failing test.** Cases lifted verbatim from `tests/js/test-sales-depletion.mjs` (computeRecipeRatio + the four unresolved emitters) and `test-depletion-exceptions.mjs` (recipe_missing_yield):
```swift
import XCTest
@testable import LariatModel

final class DepletionExceptionResolverTests: XCTestCase {
    typealias R = DepletionExceptionResolver

    // ── computeRecipeRatio (oracle: test-sales-depletion.mjs:74-108) ──
    func testRatioIdentity() {
        XCTAssertEqual(R.computeRecipeRatio(portionQty: 1, portionUnit: "cup", yieldQty: 4, yieldUnit: "cup"), 0.25)
    }
    func testRatioTspToCup() {
        let r = R.computeRecipeRatio(portionQty: 1, portionUnit: "tsp", yieldQty: 2, yieldUnit: "cup")
        XCTAssertNotNil(r)
        XCTAssertEqual(r!, 0.0104167, accuracy: 1e-4)
    }
    func testRatioCrossDimIsNil() {
        XCTAssertNil(R.computeRecipeRatio(portionQty: 1, portionUnit: "oz", yieldQty: 2, yieldUnit: "cup"))
    }
    func testRatioRejectsBadInputs() {
        XCTAssertNil(R.computeRecipeRatio(portionQty: 0, portionUnit: "tsp", yieldQty: 2, yieldUnit: "cup"))
        XCTAssertNil(R.computeRecipeRatio(portionQty: 1, portionUnit: "tsp", yieldQty: -1, yieldUnit: "cup"))
    }

    // ── firstUnresolved reason ladder ──
    func testInvalidQty() {
        let u = R.firstUnresolved(quantitySold: 0, components: [], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .invalidQty)
        XCTAssertEqual(u?.detail, "quantity_sold=0")
    }
    func testNoDishComponents() {
        let u = R.firstUnresolved(quantitySold: 1, components: [], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .noDishComponents)
        XCTAssertNil(u?.detail)
    }
    func testVendorItemResolvesCleanly() {   // omits from queue
        let c = DishComponentRow(componentType: "vendor_item", recipeSlug: nil,
                                 vendorIngredient: "cabbage slaw mix", qtyPerServing: 2, unit: "oz")
        XCTAssertNil(R.firstUnresolved(quantitySold: 1, components: [c], yieldFor: { _ in nil }, bomFor: { _ in [] }))
    }
    func testRecipeMissingYield() {   // test-depletion-exceptions.mjs "flags recipe_missing_yield"
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "mystery_aioli",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "tsp")
        let u = R.firstUnresolved(quantitySold: 1, components: [c], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .recipeMissingYield)
        XCTAssertEqual(u?.detail, "mystery_aioli")
    }
    func testCrossDimMismatch() {   // test-sales-depletion.mjs "cross-dimension unit mismatch"
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "mystery_jus",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "oz")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 1, yieldUnit: "cup") },
            bomFor: { _ in [BomLineRow(ingredient: "beef stock", qty: 1, unit: "cup", lossFactor: nil)] })
        XCTAssertEqual(u?.reason, .crossDimUnitMismatch)
        XCTAssertEqual(u?.detail, "1oz → cup for mystery_jus")
    }
    func testRecipeZeroBomLines() {   // salesDepletion.ts:255-259
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "empty_recipe",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "cup")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 2, yieldUnit: "cup") },
            bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .noDishComponents)
        XCTAssertEqual(u?.detail, "recipe=empty_recipe has zero bom_lines")
    }
    func testCleanRecipeResolves() {   // aioli happy path → not an exception
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "jal_chipotle_aioli",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "tsp")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 2, yieldUnit: "cup") },
            bomFor: { _ in [BomLineRow(ingredient: "mayonnaise", qty: 1, unit: "cup", lossFactor: nil)] })
        XCTAssertNil(u)
    }
}
```
- [ ] **Step 2: Run to fail** — `swift test --filter DepletionExceptionResolverTests`.
- [ ] **Step 3: Minimal implementation.** Faithful port of salesDepletion.ts:170-320. The classifier iterates components in order and returns the FIRST unresolved emission; a `recipe` component that fully resolves does not short-circuit (matches JS `continue`), so it keeps scanning. Real Swift:
```swift
import Foundation

public enum DepletionReason: String, Sendable, Equatable {
    case noDishComponents = "no_dish_components"
    case recipeMissingYield = "recipe_missing_yield"
    case crossDimUnitMismatch = "cross_dim_unit_mismatch"
    case unknownUnit = "unknown_unit"
    case invalidQty = "invalid_qty"
}
// ... the four row structs + DepletionUnresolved as in Interfaces ...

public enum DepletionExceptionResolver {
    public static func computeRecipeRatio(portionQty: Double, portionUnit: String?, yieldQty: Double, yieldUnit: String) -> Double? {
        guard portionQty.isFinite, portionQty > 0 else { return nil }
        guard yieldQty.isFinite, yieldQty > 0 else { return nil }
        let pn = UnitConvert.normalizeUnit(portionUnit ?? "")
        let yn = UnitConvert.normalizeUnit(yieldUnit)
        if pn == yn { return portionQty / yieldQty }
        guard let pd = UnitConvert.unitDimension(pn), let yd = UnitConvert.unitDimension(yn), pd == yd else { return nil }
        guard let portionInYield = UnitConvert.convertQty(portionQty, from: pn, to: yn, gPerMl: nil) else { return nil }
        return portionInYield / yieldQty
    }

    public static func firstUnresolved(
        quantitySold: Double,
        components: [DishComponentRow],
        yieldFor: (_ slug: String) -> RecipeYield?,
        bomFor: (_ slug: String) -> [BomLineRow]
    ) -> DepletionUnresolved? {
        guard quantitySold.isFinite, quantitySold > 0 else {
            // JS renders 0 as "0" and non-integers with their JS Number string;
            // the exceptions replay always passes 1, so only "quantity_sold=1"
            // (never reached) or seeded ints appear. jsNum-style rendering:
            return DepletionUnresolved(reason: .invalidQty, detail: "quantity_sold=\(jsNum(quantitySold))")
        }
        if components.isEmpty {
            return DepletionUnresolved(reason: .noDishComponents, detail: nil)
        }
        for c in components {
            if c.componentType == "vendor_item" { continue }     // always resolves (vendor path)
            guard let slug = c.recipeSlug else { continue }
            let y = yieldFor(slug)
            if y == nil || y?.yieldQty == nil || y?.yieldUnit == nil || (y?.yieldQty ?? 0) <= 0 {
                return DepletionUnresolved(reason: .recipeMissingYield, detail: slug)
            }
            let yq = y!.yieldQty!, yu = y!.yieldUnit!
            let ratio = computeRecipeRatio(portionQty: c.qtyPerServing, portionUnit: c.unit, yieldQty: yq, yieldUnit: yu)
            if ratio == nil {
                return DepletionUnresolved(reason: .crossDimUnitMismatch,
                    detail: "\(jsNum(c.qtyPerServing))\(c.unit) → \(yu) for \(slug)")
            }
            let bom = bomFor(slug)
            if bom.isEmpty {
                return DepletionUnresolved(reason: .noDishComponents, detail: "recipe=\(slug) has zero bom_lines")
            }
            // Recipe fully resolves — mirror JS `continue`; keep scanning later components.
        }
        return nil
    }

    /// JS Number→string: integer-valued renders without ".0". Mirrors the detail
    /// strings the web builds via template literals (e.g. "1oz", "quantity_sold=0").
    private static func jsNum(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(.towardZero), abs(d) < 9.007e15 { return String(Int64(d)) }
        return "\(d)"
    }
}
```
- [ ] **Step 4: Run to pass** — `swift test --filter DepletionExceptionResolverTests`.
- [ ] **Step 5: Build** — `swift build`.

**Parity oracle cases covered:** `tests/js/test-sales-depletion.mjs` — `computeRecipeRatio` describe (`identity unit`, `tsp portion → cup yield`, `cross-dimension volume↔weight returns null`, `rejects bad inputs`); resolver describe (`reports unresolved when dish has no dish_components`, `reports unresolved when recipe lacks a yield`, `reports unresolved on cross-dimension unit mismatch`, `rejects non-positive quantity_sold`). `tests/js/test-depletion-exceptions.mjs` — `flags recipe_missing_yield`, and the `recipe=<slug> has zero bom_lines` detail is fresh vs `lib/salesDepletion.ts:258`.

**Risks:** (1) The `unknown_unit` reason exists in the enum + REASON_LABELS but is NOT emitted by `resolveDepletionsForSale` — `computeRecipeRatio` folds an unknown unit into `cross_dim_unit_mismatch` (dimension nil → nil ratio). Do NOT invent an `unknown_unit` emission path; it stays in the enum only to satisfy `REASON_LABELS` coverage (Task 4). (2) Detail-string parity: JS builds `` `${c.qty_per_serving}${c.unit} → ${yieldRow.yield_unit} for ${c.recipe_slug}` `` using the RAW `c.unit`/`yield_unit` (not normalized) — the port must use `c.unit` and `yu` verbatim, and render `qty_per_serving` with `jsNum` (an integer `1` → `"1oz"`, not `"1.0oz"`). (3) Money/qty are `Double` — `quantitySold` is `Double` here even though it is always 1 in the replay; keep it `Double` for the `invalid_qty` finite/≤0 check parity.

---

### Task 3: `DepletionExceptionsRepository` — aggregation SQL + per-dish replay

Ports `listDepletionExceptions` (depletionExceptions.ts:72-165): the CTE aggregation over `sales_lines`, then per-dish replay through Task 2's classifier with SQL-backed `yieldFor`/`bomFor` closures, keeping only dishes with a first unresolved reason, capped at `limit` AFTER the resolve loop.

**Files:**
- Create: `LariatNative/Sources/LariatDB/DepletionExceptionsRepository.swift`
- Create: `LariatNative/Sources/LariatModel/DepletionExceptionRecords.swift` (the `DepletionException` output record — placed in LariatModel so the View can consume it without importing GRDB, mirroring `MarginDeltaRow`)
- Test: `LariatNative/Tests/LariatDBTests/DepletionExceptionsRepositoryTests.swift`

**Interfaces produced:**
```swift
// LariatModel/DepletionExceptionRecords.swift
public struct DepletionException: Sendable, Equatable, Identifiable {
    public var id: String { dishName }
    public let dishName: String
    public let reason: DepletionReason
    public let detail: String?
    public let affectedSalesCount: Int
    public let totalQuantitySold: Double
    public let totalNetSales: Double?
    public let latestImportedAt: String?
    public let samplePeriodLabels: [String]
    public init(dishName: String, reason: DepletionReason, detail: String?, affectedSalesCount: Int, totalQuantitySold: Double, totalNetSales: Double?, latestImportedAt: String?, samplePeriodLabels: [String])
}

// LariatDB/DepletionExceptionsRepository.swift
public struct DepletionExceptionsRepository {
    public init(database: LariatDatabase, locationId: String = LocationScope.resolve())
    public func list(periodLabel: String? = nil, limit: Int = 200) async throws -> [DepletionException]
    /// Command/Management tile parity: count only (matches loadDepletionExceptionCount behavior
    /// but via the full resolver so recipe-side reasons are counted too — see Risks).
    public func count(periodLabel: String? = nil) async throws -> Int
}
```
**Consumes:** `DepletionExceptionResolver.firstUnresolved`, `DishComponentRow`/`RecipeYield`/`BomLineRow`/`DepletionReason` (Task 2); `LariatDatabase.pool` (existing).

- [ ] **Step 1: Write failing test.** Mirrors `test-depletion-exceptions.mjs` cases that exercise the SQL (aggregation, casing dedupe, ordering, location/period scoping, limit-after-filter). Use the temp-WAL fixture idiom from `MarginDeltasRepositoryTests.makeDB`, recreating the 4 web-owned tables from the REAL DDL (dish_components incl. its CHECK; entities_recipes; bom_lines WITH the migration-added `loss_factor REAL`; sales_lines with `quantity_sold REAL`/`net_sales REAL`):
```swift
import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class DepletionExceptionsRepositoryTests: XCTestCase {
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-depl-exc-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE sales_lines (
                  id INTEGER PRIMARY KEY, period_label TEXT, item_name TEXT, quantity_sold REAL,
                  net_sales REAL, source TEXT, location_id TEXT, imported_at TEXT);
                CREATE TABLE dish_components (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug TEXT, vendor_ingredient TEXT,
                  qty_per_serving REAL NOT NULL, unit TEXT NOT NULL,
                  CHECK ((component_type='recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL)
                      OR (component_type='vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)));
                CREATE TABLE entities_recipes (
                  uuid TEXT PRIMARY KEY, slug TEXT NOT NULL, display_name TEXT NOT NULL,
                  yield_qty REAL, yield_unit TEXT, category TEXT,
                  active INTEGER NOT NULL DEFAULT 1, location_id TEXT NOT NULL DEFAULT 'default',
                  UNIQUE(slug, location_id));
                CREATE TABLE bom_lines (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL,
                  ingredient TEXT, qty REAL, unit TEXT, loss_factor REAL,
                  location_id TEXT DEFAULT 'default');
                """)
            try seed(db)
        }
        return (try LariatDatabase(path: path), dir)
    }
    private func sale(_ db: Database, _ item: String, _ qty: Double, _ net: Double?, _ period: String = "2026-W17", loc: String = "default") throws {
        try db.execute(sql: "INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id) VALUES (?,?,?,?, 'toast', ?)",
                       arguments: [period, item, qty, net, loc])
    }
    private func mappedVendorDish(_ db: Database, _ dish: String, _ ing: String) throws {
        try db.execute(sql: "INSERT INTO dish_components (location_id, dish_name, component_type, vendor_ingredient, qty_per_serving, unit) VALUES ('default', ?, 'vendor_item', ?, 2, 'oz')",
                       arguments: [dish, ing])
    }

    func testEmptyWhenNoSales() async throws {
        let (db, dir) = try makeDB { _ in }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out, [])
    }
    func testNoDishComponents() async throws {   // test-depletion-exceptions.mjs "flags a sold dish with no mapping"
        let (db, dir) = try makeDB { try self.sale($0, "Mystery Plate", 3, 27) }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].dishName, "Mystery Plate")
        XCTAssertEqual(out[0].reason, .noDishComponents)
        XCTAssertEqual(out[0].affectedSalesCount, 1)
        XCTAssertEqual(out[0].totalQuantitySold, 3)
        XCTAssertEqual(out[0].totalNetSales, 27)
        XCTAssertEqual(out[0].samplePeriodLabels, ["2026-W17"])
    }
    func testMappedDishOmitted() async throws {
        let (db, dir) = try makeDB { try self.mappedVendorDish($0, "Baja Taco", "cabbage slaw mix"); try self.sale($0, "Baja Taco", 4, 56) }
        defer { try? FileManager.default.removeItem(atPath: dir) }
        XCTAssertEqual(try await DepletionExceptionsRepository(database: db, locationId: "default").list().count, 0)
    }
    func testAggregatesRows() async throws {   // "aggregates multiple sales rows"
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery Plate", 2, 18, "2026-W17")
            try self.sale($0, "Mystery Plate", 5, 45, "2026-W18")
            try self.sale($0, "Mystery Plate", 1, 9, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].affectedSalesCount, 3)
        XCTAssertEqual(out[0].totalQuantitySold, 8)
        XCTAssertEqual(out[0].totalNetSales, 72)
        XCTAssertEqual(out[0].samplePeriodLabels.sorted(), ["2026-W17", "2026-W18"])
    }
    func testCasingDedupeKeepsHighestVolumeDisplay() async throws {   // "aggregates casing variants"
        let (db, dir) = try makeDB {
            try self.sale($0, "Baja Taco", 5, 50, "2026-W17")
            try self.sale($0, "BAJA TACO", 2, 20, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].dishName, "Baja Taco")   // higher quantity_sold wins display
        XCTAssertEqual(out[0].affectedSalesCount, 2)
        XCTAssertEqual(out[0].totalQuantitySold, 7)
        XCTAssertEqual(out[0].totalNetSales, 70)
    }
    func testOrderByNetThenQty() async throws {   // "orders by net_sales DESC then quantity DESC"
        let (db, dir) = try makeDB {
            try self.sale($0, "Cheap Item", 100, 50)
            try self.sale($0, "Expensive Item", 5, 500)
            try self.sale($0, "Mid Item", 10, 200)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.map(\.dishName), ["Expensive Item", "Mid Item", "Cheap Item"])
    }
    func testLocationScoping() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery Plate", 3, 27)
            try self.sale($0, "Other Mystery", 9, 99, "2026-W17", loc: "satellite")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let def = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(def.map(\.dishName), ["Mystery Plate"])
        let sat = try await DepletionExceptionsRepository(database: db, locationId: "satellite").list()
        XCTAssertEqual(sat.map(\.dishName), ["Other Mystery"])
    }
    func testPeriodFilter() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Mystery A", 1, 10, "2026-W17")
            try self.sale($0, "Mystery B", 1, 12, "2026-W18")
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list(periodLabel: "2026-W17")
        XCTAssertEqual(out.map(\.dishName), ["Mystery A"])
    }
    func testIgnoresZeroNegQty() async throws {
        let (db, dir) = try makeDB {
            try self.sale($0, "Refund Plate", 0, 0)
            try self.sale($0, "Voided Plate", -1, -10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        XCTAssertEqual(try await DepletionExceptionsRepository(database: db, locationId: "default").list().count, 0)
    }
    func testLimitAfterFiltering() async throws {   // "applies limit after filtering out clean dishes"
        let (db, dir) = try makeDB {
            try self.mappedVendorDish($0, "Mapped Top Seller A", "cabbage slaw mix")
            try self.mappedVendorDish($0, "Mapped Top Seller B", "pickled onion")
            try self.sale($0, "Mapped Top Seller A", 50, 1000)
            try self.sale($0, "Mapped Top Seller B", 40, 900)
            try self.sale($0, "Mystery Low Seller A", 2, 20)
            try self.sale($0, "Mystery Low Seller B", 1, 10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list(limit: 2)
        XCTAssertEqual(out.map(\.dishName), ["Mystery Low Seller A", "Mystery Low Seller B"])
    }
    func testRecipeMissingYieldViaSQL() async throws {   // "flags recipe_missing_yield"
        let (db, dir) = try makeDB {
            try $0.execute(sql: "INSERT INTO dish_components (location_id, dish_name, component_type, recipe_slug, qty_per_serving, unit) VALUES ('default', 'Aioli Plate', 'recipe', 'mystery_aioli', 1, 'tsp')")
            try self.sale($0, "Aioli Plate", 1, 10)
        }; defer { try? FileManager.default.removeItem(atPath: dir) }
        let out = try await DepletionExceptionsRepository(database: db, locationId: "default").list()
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].reason, .recipeMissingYield)
    }
}
```
- [ ] **Step 2: Run to fail** — `swift test --filter DepletionExceptionsRepositoryTests`.
- [ ] **Step 3: Minimal implementation.** The aggregation CTE is a byte-faithful copy of depletionExceptions.ts:88-135 (no SQL `LIMIT`); the display-name `ROW_NUMBER()` window and `GROUP_CONCAT(DISTINCT period_label)` are preserved. Then the Swift-side replay + limit-break. Real Swift:
```swift
import Foundation
import GRDB
import LariatModel

public struct DepletionExceptionsRepository {
    let database: LariatDatabase
    let locationId: String
    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database; self.locationId = locationId
    }

    public func list(periodLabel: String? = nil, limit: Int = 200) async throws -> [DepletionException] {
        let cap = max(1, min(1000, limit))
        return try await database.pool.read { db in
            var whereClause = """
                location_id = ?
                    AND quantity_sold > 0
                    AND item_name IS NOT NULL
                    AND TRIM(item_name) != ''
                """
            var args: [DatabaseValueConvertible] = [locationId]
            if let p = periodLabel, !p.isEmpty {
                whereClause += " AND period_label = ?"; args.append(p)
            }
            let aggSql = """
                WITH sales AS (
                  SELECT LOWER(TRIM(item_name)) AS item_key, TRIM(item_name) AS item_name,
                         quantity_sold, net_sales, imported_at, period_label
                    FROM sales_lines WHERE \(whereClause)),
                display_names AS (
                  SELECT item_key, item_name FROM (
                    SELECT item_key, item_name,
                           ROW_NUMBER() OVER (PARTITION BY item_key
                             ORDER BY quantity_sold DESC, COALESCE(net_sales,0) DESC, item_name ASC) AS display_rank
                      FROM sales) WHERE display_rank = 1),
                aggregates AS (
                  SELECT item_key, COUNT(*) AS affected_sales_count,
                         SUM(quantity_sold) AS total_quantity_sold, SUM(net_sales) AS total_net_sales,
                         MAX(imported_at) AS latest_imported_at,
                         GROUP_CONCAT(DISTINCT period_label) AS sample_period_labels
                    FROM sales GROUP BY item_key)
                SELECT display_names.item_name, aggregates.affected_sales_count,
                       aggregates.total_quantity_sold, aggregates.total_net_sales,
                       aggregates.latest_imported_at, aggregates.sample_period_labels
                  FROM aggregates JOIN display_names ON display_names.item_key = aggregates.item_key
                 ORDER BY COALESCE(aggregates.total_net_sales,0) DESC, aggregates.total_quantity_sold DESC
                """
            let rows = try Row.fetchAll(db, sql: aggSql, arguments: StatementArguments(args))

            var out: [DepletionException] = []
            for r in rows {
                let dishName: String = r["item_name"]
                let components = try Self.fetchComponents(db, dishName: dishName, locationId: locationId)
                let unresolved = DepletionExceptionResolver.firstUnresolved(
                    quantitySold: 1,
                    components: components,
                    yieldFor: { slug in try? Self.fetchYield(db, slug: slug, locationId: locationId) ?? nil },
                    bomFor: { slug in (try? Self.fetchBom(db, slug: slug, locationId: locationId)) ?? [] })
                guard let first = unresolved else { continue }
                let concat: String? = r["sample_period_labels"]
                out.append(DepletionException(
                    dishName: dishName,
                    reason: first.reason,
                    detail: first.detail,
                    affectedSalesCount: r["affected_sales_count"],
                    totalQuantitySold: Self.decodeQty(r["total_quantity_sold"]),
                    totalNetSales: (r["total_net_sales"] as DatabaseValue).isNull ? nil : (Double.fromDatabaseValue(r["total_net_sales"]) ?? nil),
                    latestImportedAt: r["latest_imported_at"],
                    samplePeriodLabels: concat.map { Array($0.split(separator: ",").prefix(5).map(String.init)) } ?? []))
                if out.count >= cap { break }
            }
            return out
        }
    }

    public func count(periodLabel: String? = nil) async throws -> Int {
        try await list(periodLabel: periodLabel, limit: 1000).count
    }

    private static func fetchComponents(_ db: Database, dishName: String, locationId: String) throws -> [DishComponentRow] {
        try Row.fetchAll(db, sql: """
            SELECT component_type, recipe_slug, vendor_ingredient, qty_per_serving, unit
              FROM dish_components
             WHERE LOWER(TRIM(dish_name)) = LOWER(TRIM(?)) AND location_id = ?
            """, arguments: [dishName, locationId]).map {
            DishComponentRow(componentType: $0["component_type"], recipeSlug: $0["recipe_slug"],
                             vendorIngredient: $0["vendor_ingredient"],
                             qtyPerServing: decodeQty($0["qty_per_serving"]), unit: $0["unit"] ?? "")
        }
    }
    private static func fetchYield(_ db: Database, slug: String, locationId: String) throws -> RecipeYield? {
        guard let row = try Row.fetchOne(db, sql: """
            SELECT yield_qty, yield_unit FROM entities_recipes WHERE slug = ? AND location_id = ? LIMIT 1
            """, arguments: [slug, locationId]) else { return nil }
        let yq = (row["yield_qty"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue(row["yield_qty"])
        return RecipeYield(yieldQty: yq, yieldUnit: row["yield_unit"])
    }
    private static func fetchBom(_ db: Database, slug: String, locationId: String) throws -> [BomLineRow] {
        try Row.fetchAll(db, sql: """
            SELECT ingredient, qty, unit, loss_factor FROM bom_lines
             WHERE recipe_id = ? AND location_id = ? AND ingredient IS NOT NULL AND TRIM(ingredient) != ''
            """, arguments: [slug, locationId]).map {
            BomLineRow(ingredient: $0["ingredient"],
                       qty: ($0["qty"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue($0["qty"]),
                       unit: $0["unit"], lossFactor: ($0["loss_factor"] as DatabaseValue).isNull ? nil : Double.fromDatabaseValue($0["loss_factor"]))
        }
    }
    private static func decodeQty(_ v: DatabaseValue) -> Double {
        if let d = Double.fromDatabaseValue(v) { return d }
        if let i = Int.fromDatabaseValue(v) { return Double(i) }
        return .nan
    }
}
```
- [ ] **Step 4: Run to pass** — `swift test --filter DepletionExceptionsRepositoryTests`.
- [ ] **Step 5: Build** — `swift build`.

**Parity oracle cases covered:** `tests/js/test-depletion-exceptions.mjs` — `returns empty when sales_lines is empty`, `flags a sold dish with no dish_components mapping`, `omits dishes whose mapping resolves cleanly`, `aggregates multiple sales rows for the same unmapped dish`, `aggregates casing variants under one unmapped dish exception`, `orders by net_sales DESC then quantity DESC`, `respects location scoping`, `respects period_label filter`, `ignores zero/negative quantity_sold rows`, `honors limit cap`, `applies limit after filtering out dishes that resolve cleanly`, `flags recipe_missing_yield when sub-recipe has no yield`. The route-level cases (`test-depletion-exceptions-route.mjs`) are covered indirectly — the native board has NO HTTP route (reads aren't PIN-gated in native, and `count()` handles the `?limit=` clamp semantics), so the route's `clampLimit` [1,1000] is folded into `list(limit:)`.

**Risks:** (1) The `bom_lines.loss_factor` column exists only via migration (lib/db.ts:3714) — the fixture MUST include it or `fetchBom` throws "no such column". This board never USES `lossFactor` (exception replay stops before shrinkage), but the SELECT column list must match the web resolver's for parity; keep it. (2) `net_sales` NULL handling: the web returns `null` when EVERY row was NULL (`SUM` over all-NULL = NULL), else a number. Mirror with the `DatabaseValue.isNull` guard, NOT `?? 0` — a genuine all-NULL group must surface `nil` (drives the page's `—` net display). (3) `quantity_sold`/`net_sales` are `REAL` (Double) in the real DDL — decode as Double, never Int; the `testAggregatesRows` expected `8`/`72` compare exactly because SQLite `SUM` of integer-valued reals is exact. (4) `GROUP_CONCAT(DISTINCT period_label)` ordering is unspecified by SQLite, so the oracle sorts before comparing (`samplePeriodLabels.sorted()`); the single-period test (`["2026-W17"]`) is order-stable. Do NOT sort inside the repo — the web takes `.split(',').slice(0,5)` verbatim (insertion/scan order), so preserve raw split order and only `.prefix(5)`. (5) The per-dish replay issues N+1 queries exactly like the web (`resolveDepletionsForSale` per dish) — this is intentional parity, not a perf bug to "fix"; the whole read runs inside one `pool.read` block so it is a single snapshot.

---

### Task 4: View + `@Observable` ViewModel + A0 registration under `.costing`

Ports the page (page.jsx) to SwiftUI: a read-only list with reason-tone left borders (red / blue / yellow) and the `REASON_LABELS` map. Registers the board under the `.costing` tier (created by the wave's A0 task).

**Files:**
- Create: `LariatNative/Sources/LariatApp/DepletionExceptionsView.swift` (View + VM)
- Create: `LariatNative/Sources/LariatModel/DepletionReasonLabels.swift` (the `REASON_LABELS` + tone map, UI-free so it's testable in LariatModel)
- Modify: `LariatNative/Sources/LariatApp/CostingFeatures.swift` (add `.costingDepletionExceptions` module — created by A0; if A0 has not landed, this file plus the tier are a hard dependency, flag it)
- Modify: `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (append one descriptor under the `.costing` block)
- Modify: `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (append `.costingDepletionExceptions` to `all`)
- Test: `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` (add assertion); `LariatNative/Tests/LariatModelTests/DepletionReasonLabelsTests.swift` (labels + tone coverage)

**Interfaces produced:**
```swift
// LariatModel/DepletionReasonLabels.swift
public enum DepletionReasonTone: String, Sendable { case red, blue, yellow }
public enum DepletionReasonLabels {
    public static func label(_ r: DepletionReason) -> String
    public static func tone(_ r: DepletionReason) -> DepletionReasonTone
}
// LariatApp
@Observable @MainActor final class DepletionExceptionsViewModel { ... func start(); func stop() }
struct DepletionExceptionsView: View { init(database: LariatDatabase) }
// LariatApp/CostingFeatures.swift
extension FeatureModule { static let costingDepletionExceptions: FeatureModule }
```
**Consumes:** `DepletionExceptionsRepository` (Task 3), `DepletionException` / `DepletionReason` (Tasks 2-3), `FeatureTier.costing` + `costing.overview` relocation (A0).

- [ ] **Step 1: Write failing tests.** REASON_LABELS coverage (mirrors `test-depletion-exceptions.mjs` "REASON_LABELS covers every UnresolvedDish reason") + tone map (mirrors page.jsx:49-57 `reasonTone`) + registration:
```swift
// DepletionReasonLabelsTests.swift
import XCTest
@testable import LariatModel
final class DepletionReasonLabelsTests: XCTestCase {
    func testEveryReasonHasLabel() {
        for r: DepletionReason in [.noDishComponents, .recipeMissingYield, .crossDimUnitMismatch, .unknownUnit, .invalidQty] {
            XCTAssertFalse(DepletionReasonLabels.label(r).isEmpty, "missing label for \(r.rawValue)")
        }
    }
    func testToneMapping() {
        XCTAssertEqual(DepletionReasonLabels.tone(.noDishComponents), .red)
        XCTAssertEqual(DepletionReasonLabels.tone(.invalidQty), .red)
        XCTAssertEqual(DepletionReasonLabels.tone(.crossDimUnitMismatch), .blue)
        XCTAssertEqual(DepletionReasonLabels.tone(.recipeMissingYield), .yellow)
        XCTAssertEqual(DepletionReasonLabels.tone(.unknownUnit), .yellow)
    }
}
```
Add to `FeatureRegistryTests.swift`:
```swift
    func testCostingTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
        // A0 relocation: the old manager.costing aggregate now lives at costing.overview.
        let overview = FeatureCatalog.descriptor(id: "costing.overview")
        XCTAssertNotNil(overview, "costing.overview must be registered")
        XCTAssertEqual(overview?.tier, .costing)
        // This board:
        let de = FeatureCatalog.descriptor(id: "costing.depletionExceptions")
        XCTAssertNotNil(de, "costing.depletionExceptions must be registered")
        XCTAssertEqual(de?.tier, .costing)
        XCTAssertEqual(de?.title, "Depletion exceptions")
        XCTAssertEqual(de?.enabled, true)
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }
```
- [ ] **Step 2: Run to fail** — `swift test --filter DepletionReasonLabelsTests --filter FeatureRegistryTests` (label/tone symbol + descriptor missing).
- [ ] **Step 3: Minimal implementation.**
  - `DepletionReasonLabels.swift` — labels byte-exact from depletionExceptions.ts:168-176, tone from page.jsx:54-56:
```swift
public enum DepletionReasonTone: String, Sendable { case red, blue, yellow }
public enum DepletionReasonLabels {
    public static func label(_ r: DepletionReason) -> String {
        switch r {
        case .noDishComponents: return "No dish_components mapping — add ingredients for this dish"
        case .recipeMissingYield: return "Sub-recipe missing yield — set yield_qty / yield_unit on the recipe"
        case .crossDimUnitMismatch: return "Volume↔weight conversion needs a density — fill in ingredient_densities"
        case .unknownUnit: return "Unknown unit — fix the unit on dish_components or bom_lines"
        case .invalidQty: return "Invalid quantity — qty_per_serving must be > 0"
        }
    }
    public static func tone(_ r: DepletionReason) -> DepletionReasonTone {
        switch r {
        case .noDishComponents, .invalidQty: return .red
        case .crossDimUnitMismatch: return .blue
        case .recipeMissingYield, .unknownUnit: return .yellow
        }
    }
}
```
  - Append to `FeatureCatalog.all` under a new `// Costing` block (the A0 task owns the block header + `costing.overview`; this board adds one line):
```swift
        FeatureDescriptor(id: "costing.depletionExceptions", tier: .costing, title: "Depletion exceptions"),
```
  - `CostingFeatures.swift` module + `FeatureRegistry.all` line:
```swift
    static let costingDepletionExceptions = FeatureModule(id: "costing.depletionExceptions") { ctx in
        AnyView(DepletionExceptionsView(database: ctx.database))
    }
```
```swift
        // Costing
        .costingOverview,
        .costingDepletionExceptions,
```
  - `DepletionExceptionsView.swift` — VM polling every 3 s (mirrors CostingViewModel start/stop; NO PinEntrySheet — reads aren't PIN-gated in native), View renders `List`/`ScrollView` with a left border colored by `DepletionReasonLabels.tone`, `label` + `detail`, `affectedSalesCount`/`totalQuantitySold`/`totalNetSales`/`latestImportedAt`, and the period labels; empty state distinguishes "no sales ingested" vs "everything maps cleanly" (page.jsx:117-122). Tone `.red/.blue/.yellow` map to `Color` (mirror the web `--red/--blue/--yellow` tokens; use the app's existing semantic colors).
- [ ] **Step 4: Run to pass** — `swift test --filter DepletionReasonLabelsTests --filter FeatureRegistryTests`.
- [ ] **Step 5: Full build + test + commit.** `swift build && swift test` (both green). Commit on the wave's `feat/*` branch (npm lint + tsc run on commit — Swift-only changes pass trivially; NO `--no-verify`).

**Parity oracle cases covered:** `tests/js/test-depletion-exceptions.mjs` — `REASON_LABELS covers every UnresolvedDish reason`. Tone map: author fresh vs `app/costing/depletion-exceptions/page.jsx:49-57`. Registration: fresh vs the `.costing` tier convention (no web oracle).

**Risks:** (1) `unknownUnit` label + tone must exist even though the resolver never emits that reason (Task 2 risk 1) — the `REASON_LABELS` coverage test demands it; keep the enum case and its label/tone. (2) The web page links to `/menu-engineering/components?dish=...` (the fix-it editor); native has no such route yet — render the dish name as plain text (no navigation) and note the fix-it deep-link as deferred; do NOT invent a native editor here (scope boundary). (3) A0 dependency: `FeatureTier.costing` and the `costing.overview` relocation are NOT this board's work — if the A0 task hasn't landed, the `FeatureCatalog`/`FeatureRegistry`/`CostingFeatures.swift` edits won't compile. Sequence this board AFTER A0; the `testCostingTierBoardsRegistered` assertion also guards that the relocation happened. (4) No idempotency/audit concerns — this is a pure read board (the wave's single audited write is on a DIFFERENT board, ingredientMasters); do not add `AuditedWriteRunner` here.

---

**Cross-task summary:** 4 tasks, strict layer order (LariatModel leaf helper → LariatModel classifier+records → LariatDB repository → LariatApp view+VM+A0). Task 1 (`UnitConvert`) is the flagged new-helper task the prompt asked to scope separately — it is genuinely absent from `LariatNative/Sources/` and is a hard prerequisite for the `cross_dim_unit_mismatch` / same-dim ratio branch. All money/qty stay `Double` (dollars). No rounding ties are reachable in this board (the exception replay emits no formatted deltas — `InventoryShrinkage.jsRound`/`formatDepletionDelta` are NOT invoked here), so no `floor(x+0.5)` helper is needed; the only JS-Number-string parity concern is the `detail` strings (integer `qty_per_serving` rendered without `.0`), handled by the local `jsNum` in Task 2.

#### Gap-fixes for depletionExceptions (fold into the tasks above during execution)

I have all the fidelity needed. Line 3714 confirms `loss_factor` is added by migration (matches the plan). The margin precedent exists at `MarginDeltasCompute.swift:64` (`MarginDeltaRow`). Now compiling the gap list against every oracle case and lib rule.

GAPS for depletionExceptions:

- **Task 3 misses two `test-depletion-exceptions.mjs` cases as distinct tests.** The plan's `testLimitAfterFiltering` covers the "applies limit after filtering" case, but the plain **`honors limit cap`** case (test-depletion-exceptions.mjs:153-159 — 5 unmapped dishes, `limit: 2` → `length === 2`) has NO corresponding Swift test; the plan only ports the "after filtering" variant. Add it.

- **`total_quantity_sold` NULL coalescing is not mirrored (semantic bug).** JS uses `Number(r.total_quantity_sold ?? 0)` (depletionExceptions.ts:154) — NULL qty → **0**. The plan's `decodeQty` (Task 3) returns `.nan` when `Double.fromDatabaseValue` and `Int.fromDatabaseValue` both fail, and does not coalesce a NULL DatabaseValue to 0. For `total_quantity_sold` specifically the port must emit `0`, not `NaN` (though the `quantity_sold > 0` WHERE filter makes an all-NULL SUM unreachable in practice, the coalesce still diverges from the oracle). Cite depletionExceptions.ts:154.

- **`sample_period_labels` slice vs prefix order (partial).** JS is `r.sample_period_labels.split(',').slice(0, 5)` (depletionExceptions.ts:158-159). The plan Task 3 uses `.split(separator: ",").prefix(5)` — correct order, but note Swift `String.split` **drops empty subsequences by default** whereas JS `String.split(',')` keeps them; a `GROUP_CONCAT` value with an empty label between commas would diverge. Pass `omittingEmptySubsequences: false` for byte parity. Cite depletionExceptions.ts:159.

- **PIN-gating claim is FALSE for the source route.** The plan (Task 3 "Parity oracle cases covered" and Task 4 risk 2) asserts "reads aren't PIN-gated in native" and that the web route is not PIN-gated — but route.js:32-34 calls `await requirePin(req)` and returns `pinFail` first, and the header explicitly says "PIN-gated via the /api/costing matcher in middleware.js". The plan should acknowledge the web read IS PIN-gated and justify why native drops it (rather than mis-stating the source).

- **Route response envelope fields not ported/asserted.** `test-depletion-exceptions-route.mjs` asserts the GET body shape: `location_id`, `period_label`, `total`, `exceptions` (route.js:47-51). The plan folds the route into `list()`/`count()` but `count()` returns `list(...).count` — it does NOT expose `period_label` echo or the `location_id` field, and there is no test mirroring `returns empty queue when no sales` (`total===0`, `exceptions===[]`), `flags an unmapped dish` (`total===1`), `respects ?location=`, `respects ?period=`, or **`clamps absurd ?limit=`** (route.js clampLimit `999999`→3 rows returned, `limit=1`→1 row; test lines 90-106). The `?limit=1` clamp semantics (does the SQL-less cap return the single highest-ranked exception?) is asserted in the route test and only loosely covered by `testLimitAfterFiltering`. Cite test-depletion-exceptions-route.mjs:36-106.

- **`count()` semantics diverge from the Management baseline (flagged in plan but unreconciled).** The plan's `count()` = `list(limit: 1000).count`, which caps at 1000; the web has no `count()` — the count baseline is `ManagementRollupRepository.loadDepletionExceptionCount`. The plan says count "matches loadDepletionExceptionCount behavior but via the full resolver so recipe-side reasons are counted too" — this is an intentional behavior CHANGE from the existing native count tile, not parity; either reconcile with the existing method or drop `count()` from scope. No test asserts `count()`.

- **`clampLimit` uses `Math.floor(n)` — fractional limits not handled.** route.js:29 `Math.max(1, Math.min(1000, Math.floor(n)))`. The plan's `list(limit:)` clamp is `max(1, min(1000, limit))` on an `Int` param — fine for Int, but if the route layer is folded in, a fractional `?limit=2.9` must floor to 2. Since native drops the route, this is only a note, but the `Math.floor` step is unreflected. Cite route.js:29.

- **`fetchDishComponents` unit NULL/empty handling.** JS `DishComponentRow.unit` is typed `string` (non-null; column is `NOT NULL`), used raw in the `cross_dim_unit_mismatch` detail. The plan's `fetchComponents` maps `unit: $0["unit"] ?? ""`. Harmless given `NOT NULL`, but note the JS never coalesces — a divergence only if the column were nullable (it isn't per the DDL CHECK). No gap, just confirm the `?? ""` is dead.

- **A0 registration edits and the `.costing` tier / `manager.costing → costing.overview` relocation are asserted-only, never verified to exist.** The plan hard-depends on FeatureTier.costing, `costing.overview`, `CostingFeatures.swift`, and a `.costing` block in `FeatureRegistry.all`, all "assumed landed by the A4.2 A0 task." I confirmed **none of Task 4's target files were checked against the tree** — the plan does not verify whether A0 has landed. If A0 has not landed, Task 4's `FeatureCatalog`/`FeatureRegistry`/`CostingFeatures.swift` edits and the `testCostingTierBoardsRegistered` assertion will not compile. This must be gated on A0 as an explicit hard prerequisite with a verification step, not an assumption.

- **The prompt's "prices drill-down is NOT a standalone catalog tile" check is not applicable / not addressed.** This board is `costing.depletionExceptions`, not a prices drill-down; the plan registers it as a standalone `.costing` catalog tile (`FeatureDescriptor(id: "costing.depletionExceptions", ...)` + `FeatureRegistry.all` line). No prices drill-down concern exists here, but the plan does not state whether depletion-exceptions should be a top-level tile vs a sub-view of `costing.overview` — the web has it at `/costing/depletion-exceptions` (a standalone route), so a standalone tile is defensible; flag that this decision is unstated.

- **`invalid_qty` detail-string parity uses `jsNum`, but JS renders `quantity_sold` via template literal `${quantity_sold}` (salesDepletion.ts:185) which for the replay is always the literal `1`.** The plan's `firstUnresolved` hardcodes `quantitySold: 1` at the call site (Task 3), so the `invalid_qty` branch is unreachable in the repository path — yet the plan's `DepletionExceptionResolverTests.testInvalidQty` expects `detail == "quantity_sold=0"`. That is correct for the pure unit test, but note the `jsNum` rounding guard (`abs(d) < 9.007e15`) is untested and the resolver's `invalid_qty` reason is dead in the actual board flow (only reachable via the standalone unit test). Not a defect; document that `invalid_qty` is unreachable through `DepletionExceptionsRepository`.

- **Placeholder / signature note:** Task 3's `list()` inline closure `yieldFor: { slug in try? Self.fetchYield(...) ?? nil }` double-optionalizes (`try?` on a throwing func returning `RecipeYield?` yields `RecipeYield??`, then `?? nil` flattens) — this compiles but is fragile; and `firstUnresolved`'s `yieldFor`/`bomFor` are non-throwing closures while `fetchYield`/`fetchBom` are `throws`, so errors are silently swallowed by `try?` (a real SQL error becomes "recipe missing yield" rather than propagating). JS's `resolveDepletionsForSale` runs the SELECTs directly inside the same synchronous call and would throw. This is a behavior divergence on DB error, not just style. Cite salesDepletion.ts:132-137, 148-155.

---


I now have everything needed to write the plan section with exact code and parity oracle references. Producing the plan section now.

## Board: costing.ingredientMasters (Ingredient Masters — the ONE audited write; build last)

Source of truth: `lib/ingredientMastersRepo.ts` (listMasters L80–130, getMaster L132–160, validateMasterUpdates L196–220, updateMaster L222–292), `app/api/costing/ingredient-masters/route.js` (GET L46–68 default `filter='all'`; PATCH validation matrix L84–172), `app/costing/ingredient-masters/page.jsx` (GET default `filter='needs_review'`, L49–65), `app/costing/ingredient-masters/MarkReviewedButton.jsx` (sends `{master_id, updates:{last_reviewed:'now'}, cook_id}`).

Native precedents reused verbatim: `AuditedWriteRunner.perform(db:)`, `AuditEventWriter.post(db:input:)`, `AuditEventInput`, `AuditEventAction.correction`, `RegulatedWriteContext.nativeMac(...)` (actorSource `"native_mac"`), `WriteErrorMapper.message(for:)`, `LariatWriteDatabase.write`, `LariatDatabase.pool.read`. **Write ordering pattern is copied from `WageNoticeRepository.sign` (L100–159): validate → `throw` BEFORE `AuditedWriteRunner.perform`, then inside the txn `UPDATE` → `AuditEventWriter.post`.** Fixture-seed pattern copied from `WageNoticeRepositoryTests.seedWageNoticeDatabase` (L154–193).

**Divergences from web to assert in tests:** native audit `actor_source = "native_mac"` (web PATCH passes `'manager_ui'`, route.js L156); NO idempotency layer (web wraps PATCH in `withIdempotency`, route.js L73 — document as deferred); reads are NOT PIN-gated in native (web `requirePin`, route.js L47/L71 — do NOT port).

---

### Task 1: LariatModel — `IngredientMaster` records + `IngredientMasterUpdates` + `validateMasterUpdates` (pure)

**Files:**
- Create: `LariatNative/Sources/LariatModel/IngredientMasterRecords.swift`
- Create: `LariatNative/Sources/LariatModel/Compute/IngredientMastersCompute.swift`
- Test: `LariatNative/Tests/LariatModelTests/IngredientMastersComputeTests.swift`

**Interfaces produced:**
```swift
public struct IngredientMasterRow: Decodable, FetchableRecord, Sendable, Identifiable {
    public var id: String { masterId }
    public let masterId: String            // master_id  (TEXT PK)
    public let canonicalName: String       // canonical_name (NOT NULL)
    public let category: String?           // category
    public let preferredVendor: String?    // preferred_vendor
    public let qualityLocked: Int          // quality_locked (INTEGER NOT NULL DEFAULT 0)
    public let qualityLockReason: String?  // quality_lock_reason
    public let lastReviewed: String?       // last_reviewed
    public let vendorPriceCount: Int       // COALESCE(vp.cnt,0)
    public let bomLineCount: Int           // COALESCE(bl.cnt,0)
    enum CodingKeys: String, CodingKey {
        case masterId = "master_id", canonicalName = "canonical_name",
             category, preferredVendor = "preferred_vendor",
             qualityLocked = "quality_locked", qualityLockReason = "quality_lock_reason",
             lastReviewed = "last_reviewed",
             vendorPriceCount = "vendor_price_count", bomLineCount = "bom_line_count"
    }
}

public enum IngredientMasterFilter: String, Sendable { case all, needsReview = "needs_review", reviewed }

/// One field-set partial update. `.absent` means "not present in updates" (skipped);
/// distinguished from `.set(nil)` which clears the column. Mirrors JS hasOwnProperty gate.
public enum FieldChange<T: Sendable>: Sendable { case absent; case set(T) }

public struct IngredientMasterUpdates: Sendable {
    public var canonicalName: FieldChange<String> = .absent        // non-empty when present
    public var category: FieldChange<String?> = .absent
    public var preferredVendor: FieldChange<String?> = .absent
    public var qualityLocked: FieldChange<Bool> = .absent
    public var qualityLockReason: FieldChange<String?> = .absent
    public var lastReviewed: FieldChange<LastReviewedChange> = .absent
    public var isEmpty: Bool { /* all cases == .absent */ }
    public init() {}
}
public enum LastReviewedChange: Sendable { case now; case iso(String); case clear }

public enum IngredientMasterWriteError: Error, LocalizedError, Sendable {
    case rejected(String)          // validateMasterUpdates rule failures (web 422 / MasterUpdateRejectedError)
    case notFound                  // web 404
    case persistenceFailed
    public var errorDescription: String? { /* .rejected(let m): m ; .notFound: "Ingredient master not found" ; ... */ }
}

public enum IngredientMastersCompute {
    public static let staleAfterDays = 90
    /// Mirror lib/ingredientMastersRepo.ts:196-220 validateMasterUpdates. Throws .rejected BEFORE any write.
    public static func validateMasterUpdates(before: IngredientMasterRow, updates: IngredientMasterUpdates) throws
}
```

**Steps (strict TDD):**
- [ ] Step 1: Write failing tests `IngredientMastersComputeTests.swift` reproducing `validateMasterUpdates` (repo L204–219) and the API quality-lock cases (api test L238–258). Real values:
```swift
import XCTest
@testable import LariatModel

final class IngredientMastersComputeTests: XCTestCase {
    private func row(vendor: String? = nil, locked: Int = 0) -> IngredientMasterRow {
        IngredientMasterRow(masterId: "a", canonicalName: "Chicken Breast", category: nil,
            preferredVendor: vendor, qualityLocked: locked, qualityLockReason: nil,
            lastReviewed: nil, vendorPriceCount: 0, bomLineCount: 0)
    }
    // repo L204: lock true, no vendor present, before has no vendor → reject "Pick a vendor before locking for quality."
    func testCannotLockWithoutVendor() {
        var u = IngredientMasterUpdates(); u.qualityLocked = .set(true)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: nil), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail() }
            XCTAssertEqual(m, "Pick a vendor before locking for quality.")
        }
    }
    // api test L238-251: lock+vendor in one request → allowed (before had no vendor, but preferred_vendor present)
    func testLockWithVendorInOneRequestAllowed() throws {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(true); u.qualityLockReason = .set("quality")
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: nil), updates: u))
    }
    // repo L208-215 / api test L253-258: change vendor while locked (not unlocking) → reject
    func testCannotChangeVendorWhileLocked() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock")
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail() }
            XCTAssertEqual(m, "Quality lock is on — unlock before changing vendor.")
        }
    }
    // repo L208-215: changing vendor WHILE ALSO unlocking (quality_locked:false) → allowed
    func testChangeVendorWhileUnlockingAllowed() throws {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(false)
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u))
    }
    // repo L217-219: clear vendor while (still) locked → reject
    func testCannotClearVendorWhileLocked() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set(nil)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail() }
            XCTAssertEqual(m, "Cannot clear preferred vendor while quality lock is on.")
        }
    }
    // repo: setting the SAME vendor while locked is not a change → allowed (updates.preferred_vendor === before.preferred_vendor)
    func testSameVendorWhileLockedAllowed() throws {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("sysco")
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u))
    }
}
```
- [ ] Step 2: Run to fail (`swift test --filter IngredientMastersComputeTests`) — types/func don't exist.
- [ ] Step 3: Implement records + compute. `validateMasterUpdates` mirrors the three rules exactly (repo L200–219):
```swift
public static func validateMasterUpdates(before: IngredientMasterRow, updates: IngredientMasterUpdates) throws {
    let nextLocked: Bool?   // asBoolFlag(updates.quality_locked): .absent→nil, .set(b)→b
    if case .set(let b) = updates.qualityLocked { nextLocked = b } else { nextLocked = nil }
    let lockedNow = before.qualityLocked != 0
    let willBeLocked = nextLocked ?? lockedNow

    // vendor "present" == updates.preferredVendor != .absent ; value is String? via .set
    var vendorPresent = false; var vendorValue: String? = nil
    if case .set(let v) = updates.preferredVendor { vendorPresent = true; vendorValue = v }

    // repo L204: nextLocked===true && preferred_vendor undefined && !before.preferred_vendor
    if nextLocked == true, !vendorPresent, (before.preferredVendor?.isEmpty ?? true) {
        throw IngredientMasterWriteError.rejected("Pick a vendor before locking for quality.")
    }
    // repo L208-215: lockedNow && vendor present && vendor != before && !(nextLocked===false)
    if lockedNow, vendorPresent, vendorValue != before.preferredVendor, nextLocked != false {
        throw IngredientMasterWriteError.rejected("Quality lock is on — unlock before changing vendor.")
    }
    // repo L217-219: willBeLocked && updates.preferred_vendor === null
    if willBeLocked, vendorPresent, vendorValue == nil {
        throw IngredientMasterWriteError.rejected("Cannot clear preferred vendor while quality lock is on.")
    }
}
```
- [ ] Step 4: Run to pass.
- [ ] Step 5: `swift build && swift test` from `LariatNative/`; commit `feat(native): A4.2 costing — IngredientMaster records + validateMasterUpdates (T1)` on a `feat/*` branch.

**Parity oracle cases covered:** `test-ingredient-masters-repo.mjs` has NO direct validate test — author fresh vs `lib/ingredientMastersRepo.ts:196-220`; API-level equivalents: `test-ingredient-masters-api.mjs` "locks with preferred vendor in one request" (L239) and "422 when changing vendor while locked" (L253).

**Risks:** No money/rounding here. The `!before.preferred_vendor` JS falsy check must map to `nil OR ""` (empty string is falsy in JS) — use `(before.preferredVendor?.isEmpty ?? true)`, not `== nil`. The `!(nextLocked === false)` guard: if the same request unlocks (`.set(false)`) a vendor change is permitted — must use `nextLocked != false` (nil passes), NOT `willBeLocked`. `FieldChange` MUST distinguish `.absent` from `.set(nil)` to mirror JS `hasOwnProperty` vs `null`.

---

### Task 2: LariatDB — `IngredientMastersRepository.list` / `.getMaster` (read-only, `listMasters` parity)

**Files:**
- Create: `LariatNative/Sources/LariatDB/IngredientMastersRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/IngredientMastersRepositoryTests.swift`

**Interfaces produced:**
```swift
public struct IngredientMastersRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase? = nil)
    public func list(q: String? = nil, filter: IngredientMasterFilter = .all, limit: Int = 200) async throws -> [IngredientMasterRow]
    public func getMaster(_ masterId: String) throws -> IngredientMasterRow?   // sync; reused inside the write txn's read leg + by list callers
}
```
(consumes `IngredientMasterRow`, `IngredientMasterFilter` from Task 1)

**Steps:**
- [ ] Step 1: Write failing `IngredientMastersRepositoryTests.swift`. Fixture seeds the REAL DDL (db.ts L1445–1453 for `ingredient_masters`, plus minimal `vendor_prices`/`bom_lines`/`audit_events`). Seed helper mirrors `test-ingredient-masters-repo.mjs` seeders (L32–60). Reproduce these exact repo tests:
```swift
import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class IngredientMastersRepositoryTests: XCTestCase {
    // ── seed helpers (mirror test-ingredient-masters-repo.mjs L32-60) ──
    private func seedMaster(_ db: Database, _ id: String, _ name: String,
                            category: String? = nil, vendor: String? = nil, lastReviewed: String? = nil,
                            locked: Int = 0, lockReason: String? = nil) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters
              (master_id, canonical_name, category, preferred_vendor, quality_locked, quality_lock_reason, last_reviewed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, arguments: [id, name, category, vendor, locked, lockReason, lastReviewed])
    }
    private func seedVendorPrice(_ db: Database, _ masterId: String) throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
            VALUES ('thing','sysco',?,1,'ea',1.0,1.0,'default',?)
            """, arguments: ["sku-\(UUID().uuidString.prefix(6))", masterId])
    }
    private func seedBomLine(_ db: Database, _ masterId: String) throws {
        try db.execute(sql: """
            INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, location_id, master_id)
            VALUES ('recipe-a','thing',1.0,'ea','default',?)
            """, arguments: [masterId])
    }

    // repo L67-74
    func testZeroCountsWhenNothingMaps() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "ketchup_heinz_1gal", "Ketchup — Heinz 1gal") }
        let rows = try await r.repo.list()
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].masterId, "ketchup_heinz_1gal")
        XCTAssertEqual(rows[0].vendorPriceCount, 0)
        XCTAssertEqual(rows[0].bomLineCount, 0)
    }
    // repo L76-86
    func testCountsVendorPricesAndBomLines() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in try seedMaster(db, "a", "A")
            try seedVendorPrice(db, "a"); try seedVendorPrice(db, "a"); try seedVendorPrice(db, "a")
            try seedBomLine(db, "a"); try seedBomLine(db, "a") }
        let rows = try await r.repo.list()
        XCTAssertEqual(rows[0].vendorPriceCount, 3)
        XCTAssertEqual(rows[0].bomLineCount, 2)
    }
    // repo L88-93: needs-review (NULL last_reviewed) sorts before reviewed
    func testSortsNeedsReviewFirst() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try seedMaster(db, "reviewed", "B", lastReviewed: "2099-01-01T00:00:00Z")
            try seedMaster(db, "unreviewed", "A") }
        XCTAssertEqual(try await r.repo.list().map(\.masterId), ["unreviewed", "reviewed"])
    }
    // repo L95-103: within needs-review, vendor_price_count DESC
    func testWithinNeedsReviewSortsByVendorCountDesc() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try seedMaster(db, "low", "L"); try seedMaster(db, "high", "H")
            try seedVendorPrice(db, "high"); try seedVendorPrice(db, "high"); try seedVendorPrice(db, "low") }
        XCTAssertEqual(try await r.repo.list().map(\.masterId), ["high", "low"])
    }
    // repo L105-110
    func testFilterNeedsReviewExcludesRecentlyReviewed() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try seedMaster(db, "reviewed", "B", lastReviewed: isoNow())
            try seedMaster(db, "unreviewed", "A") }
        XCTAssertEqual(try await r.repo.list(filter: .needsReview).map(\.masterId), ["unreviewed"])
    }
    // repo L112-118: reviewed excludes unreviewed(null) AND stale(2020)
    func testFilterReviewedExcludesUnreviewedAndStale() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try seedMaster(db, "fresh", "F", lastReviewed: isoNow())
            try seedMaster(db, "stale", "S", lastReviewed: "2020-01-01T00:00:00Z")
            try seedMaster(db, "null", "N") }
        XCTAssertEqual(try await r.repo.list(filter: .reviewed).map(\.masterId), ["fresh"])
    }
    // repo L120-127: q matches master_id OR canonical_name, case-insensitive
    func testQMatchesIdAndNameCaseInsensitive() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try seedMaster(db, "ketchup_heinz_1gal", "Ketchup — Heinz 1gal")
            try seedMaster(db, "mayo_kraft_1gal", "Mayonnaise — Kraft 1gal") }
        XCTAssertEqual(try await r.repo.list(q: "ketch").count, 1)
        XCTAssertEqual(try await r.repo.list(q: "KETCH").count, 1)   // id match, upcased
        XCTAssertEqual(try await r.repo.list(q: "heinz").count, 1)   // name match
        XCTAssertEqual(try await r.repo.list(q: "xyz").count, 0)
    }
    // repo L129-136
    func testLimitClampsTo1To1000() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in try seedMaster(db, "a","A"); try seedMaster(db, "b","B"); try seedMaster(db, "c","C") }
        XCTAssertEqual(try await r.repo.list(limit: 1).count, 1)
        XCTAssertEqual(try await r.repo.list(limit: 0).count, 1)        // < 1 clamps to 1
        XCTAssertEqual(try await r.repo.list(limit: 999_999).count, 3)  // > 1000 still returns all three
    }
    // repo L140-153
    func testGetMasterNullThenRow() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        XCTAssertNil(try r.repo.getMaster("missing"))
        try r.writeSeed { db in try seedMaster(db, "a", "A", category: "sauce"); try seedVendorPrice(db, "a") }
        let row = try r.repo.getMaster("a")
        XCTAssertEqual(row?.canonicalName, "A"); XCTAssertEqual(row?.category, "sauce")
        XCTAssertEqual(row?.vendorPriceCount, 1); XCTAssertEqual(row?.bomLineCount, 0)
    }
    // helpers: isoNow() → ISO8601 of Date(); makeRepos()/cleanup() mirror WageNoticeRepositoryTests L143-193.
}
```
- [ ] Step 2: Run to fail — repo type absent.
- [ ] Step 3: Implement `list`/`getMaster`. Port the SQL verbatim from repo L99–127 / L133–156, using GRDB param binding. The needs_review/reviewed WHERE and the `CASE ... AS needs_review` ORDER key are copied exactly:
```swift
public func list(q: String? = nil, filter: IngredientMasterFilter = .all, limit: Int = 200) async throws -> [IngredientMasterRow] {
    let capped = max(1, min(1000, limit))          // clampLimit repo L64-69 (default arg 200)
    var wheres: [String] = []; var args: [DatabaseValueConvertible] = []
    if let t = q?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
        wheres.append("(lower(im.master_id) LIKE lower(?) OR lower(im.canonical_name) LIKE lower(?))")
        args.append("%\(t)%"); args.append("%\(t)%")
    }
    switch filter {
    case .needsReview: wheres.append("(im.last_reviewed IS NULL OR julianday('now') - julianday(im.last_reviewed) > 90)")
    case .reviewed:    wheres.append("(im.last_reviewed IS NOT NULL AND julianday('now') - julianday(im.last_reviewed) <= 90)")
    case .all: break
    }
    let whereSql = wheres.isEmpty ? "" : "WHERE \(wheres.joined(separator: " AND "))"
    let sql = """
      SELECT im.master_id, im.canonical_name, im.category, im.preferred_vendor,
             im.quality_locked, im.quality_lock_reason, im.last_reviewed,
             COALESCE(vp.cnt,0) AS vendor_price_count,
             COALESCE(bl.cnt,0) AS bom_line_count,
             CASE WHEN im.last_reviewed IS NULL THEN 1
                  WHEN julianday('now') - julianday(im.last_reviewed) > 90 THEN 1
                  ELSE 0 END AS needs_review
        FROM ingredient_masters im
        LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM vendor_prices WHERE master_id IS NOT NULL GROUP BY master_id) vp
          ON vp.master_id = im.master_id
        LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM bom_lines WHERE master_id IS NOT NULL GROUP BY master_id) bl
          ON bl.master_id = im.master_id
        \(whereSql)
       ORDER BY needs_review DESC, vendor_price_count DESC, im.canonical_name ASC
       LIMIT ?
    """
    args.append(capped)
    return try await readDB.pool.read { db in try IngredientMasterRow.fetchAll(db, sql: sql, arguments: StatementArguments(args)) }
}
```
`getMaster` uses the L133–156 single-row SQL (no `needs_review` key). Note `IngredientMasterRow` decodes `needs_review` is not a field — either strip it (alias out) via a distinct fetch struct, OR add `needs_review` to CodingKeys and drop it; simplest is a private `Row.fetchAll` mapping like `PackChangesRepository.list` (L114–131) which reads columns explicitly and ignores `needs_review`. Prefer the explicit-Row mapping to keep `IngredientMasterRow` clean.
- [ ] Step 4: Run to pass.
- [ ] Step 5: `swift build && swift test`; commit `feat(native): A4.2 costing — IngredientMastersRepository read layer (T2)`.

**Parity oracle cases covered:** `test-ingredient-masters-repo.mjs` — "returns empty list when table empty" (L63), "returns row with zero counts" (L67), "counts vendor_prices and bom_lines" (L76), "sorts needs-review masters first" (L88), "within needs-review tier, sorts by vendor_price_count DESC" (L95), "filter=needs_review excludes recently-reviewed rows" (L105), "filter=reviewed excludes unreviewed and stale rows" (L112), "q matches master_id and canonical_name case-insensitively" (L120), "limit clamps to [1, 1000]" (L129), getMaster L140/L144. Plus GET-parity from `test-ingredient-masters-api.mjs`: "unknown filter falls back to all" is enforced at the View layer (Task 4), not the repo (repo default is `.all`, matching route.js L52–53).

**Risks:** No money. `julianday('now')` is time-relative — seeds use `isoNow()` (Swift `ISO8601DateFormatter` / `Date()`), matching JS `new Date().toISOString()` in the oracle. The `> 90` / `<= 90` boundary must stay strict-greater / less-or-equal (repo L93/L95) — off-by-one flips the reviewed/needs_review split. Fixture must seed `ingredient_masters` WITHOUT a `location_id` column (masters are global — db.ts L1445–1453); `vendor_prices`/`bom_lines` DO carry `location_id` + `master_id` per the mjs seeders. No native migration — only the fixture creates tables.

---

### Task 3: LariatDB — `IngredientMastersRepository.updateMaster` (the ONE audited write)

**Files:**
- Modify: `LariatNative/Sources/LariatDB/IngredientMastersRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/IngredientMastersRepositoryTests.swift` (append)

**Interfaces produced:**
```swift
public struct UpdateMasterResult: Sendable {
    public let found: Bool
    public let changed: Bool
    public let after: IngredientMasterRow?
}
extension IngredientMastersRepository {
    /// Partial update + one audit_events row (action=correction, actor_source=native_mac) in ONE txn.
    /// validateMasterUpdates throws BEFORE the txn. Empty updates → changed=false, no audit. Missing id → found=false, no write.
    public func updateMaster(_ masterId: String, updates: IngredientMasterUpdates,
                             context: RegulatedWriteContext) throws -> UpdateMasterResult
}
```
(consumes `IngredientMasterUpdates`, `IngredientMastersCompute.validateMasterUpdates`, `RegulatedWriteContext`, `AuditedWriteRunner`, `AuditEventWriter`, `AuditEventInput`, `.correction`)

**Steps:**
- [ ] Step 1: Append failing tests. Real values from `test-ingredient-masters-repo.mjs` updateMaster block (L156–221) + the native-divergence assertions:
```swift
    private func macContext() -> RegulatedWriteContext {
        RegulatedWriteContext(actorCookId: "cook-x", actorSource: RegulatedWriteContext.nativeMacActorSource,
                              locationId: "default", shiftDate: "2026-07-02")
    }
    private func set(_ u: inout IngredientMasterUpdates) {}  // convenience-free; build updates inline

    // repo L157-163: missing id → found=false, no audit
    func testNotFoundNoWrite() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        var u = IngredientMasterUpdates(); u.category = .set("sauce")
        let res = try r.repo.updateMaster("missing", updates: u, context: macContext())
        XCTAssertFalse(res.found); XCTAssertFalse(res.changed)
        try w.pool.read { db in XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0) }
    }
    // repo L165-172: empty updates → changed=false, no audit
    func testEmptyUpdatesNoAudit() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "A") }
        let res = try r.repo.updateMaster("a", updates: IngredientMasterUpdates(), context: macContext())
        XCTAssertTrue(res.found); XCTAssertFalse(res.changed)
        try w.pool.read { db in XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0) }
    }
    // repo L174-188: writes only named field, preserves others, ONE audit (action=correction), payload {master_id, updates}
    // DIVERGENCE from api test L191 ('manager_ui'): assert actor_source == 'native_mac'
    func testWritesNamedFieldAndOneAuditNativeMac() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "A", category: "sauce", vendor: "sysco") }
        var u = IngredientMasterUpdates(); u.category = .set("condiment")
        let res = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertTrue(res.changed)
        XCTAssertEqual(res.after?.category, "condiment")
        XCTAssertEqual(res.after?.preferredVendor, "sysco")   // unspecified preserved
        try w.pool.read { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='ingredient_masters'"), "correction")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events LIMIT 1"), "cook-x")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events LIMIT 1"), "native_mac")
            XCTAssertNil(try Int64.fetchOne(db, sql: "SELECT entity_id FROM audit_events LIMIT 1"))  // master_id is TEXT → entity_id NULL (repo L281)
            let payload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events LIMIT 1")
            XCTAssertTrue(payload!.contains("\"master_id\":\"a\""))
        }
    }
    // repo L190-199: last_reviewed:'now' → datetime('now') within 5s
    func testLastReviewedNowStamps() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "A") }
        let before = Date()
        var u = IngredientMasterUpdates(); u.lastReviewed = .set(.now)
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        let stampStr = try r.repo.getMaster("a")?.lastReviewed
        XCTAssertNotNil(stampStr)
        let f = ISO8601DateFormatter(); let stamped = f.date(from: stampStr!.replacingOccurrences(of: " ", with: "T") + "Z")!
        XCTAssertLessThan(abs(stamped.timeIntervalSince(before)), 5)
    }
    // repo L201-205: last_reviewed:null clears
    func testLastReviewedClear() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "A", lastReviewed: "2024-01-01T00:00:00Z") }
        var u = IngredientMasterUpdates(); u.lastReviewed = .set(.clear)
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertNil(try r.repo.getMaster("a")?.lastReviewed)
    }
    // repo L207-221: multi-field → all persisted + ONE audit row
    func testMultiFieldOneAudit() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "A") }
        var u = IngredientMasterUpdates()
        u.canonicalName = .set("Better Name"); u.category = .set("sauce"); u.preferredVendor = .set("shamrock")
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        let after = try r.repo.getMaster("a")
        XCTAssertEqual(after?.canonicalName, "Better Name"); XCTAssertEqual(after?.category, "sauce"); XCTAssertEqual(after?.preferredVendor, "shamrock")
        try w.pool.read { db in XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 1) }
    }
    // DIVERGENCE: rule failure throws BEFORE audit — nothing written (repo L234 order; api test L253-258 → 422)
    func testRejectionThrowsBeforeAudit() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in try seedMaster(db, "a", "Chicken Breast", vendor: "sysco", locked: 1) }
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock")
        XCTAssertThrowsError(try r.repo.updateMaster("a", updates: u, context: macContext())) {
            guard case IngredientMasterWriteError.rejected = $0 else { return XCTFail() }
        }
        try w.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)         // no audit
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT preferred_vendor FROM ingredient_masters WHERE master_id='a'"), "sysco")  // unchanged
        }
    }
    // lock with vendor in one request persists (api test L239-251)
    func testLockWithVendorPersists() async throws {
        let (r, w, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try seedMaster($0, "a", "Chicken Breast") }
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(true); u.qualityLockReason = .set("quality")
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        try w.pool.read { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT preferred_vendor FROM ingredient_masters WHERE master_id='a'"), "shamrock")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT quality_locked FROM ingredient_masters WHERE master_id='a'"), 1)
        }
    }
```
- [ ] Step 2: Run to fail — `updateMaster` absent.
- [ ] Step 3: Implement, mirroring repo L222–292 order and `WageNoticeRepository.sign` L100–159 structure exactly:
```swift
public func updateMaster(_ masterId: String, updates: IngredientMasterUpdates,
                         context: RegulatedWriteContext) throws -> UpdateMasterResult {
    guard let writeDB else { throw IngredientMasterWriteError.persistenceFailed }
    guard let before = try getMaster(masterId) else {                     // repo L229-232
        return UpdateMasterResult(found: false, changed: false, after: nil)
    }
    try IngredientMastersCompute.validateMasterUpdates(before: before, updates: updates)  // repo L234 — BEFORE any write

    // Build SET from present fields (repo L237-267). clip lengths mirror route.js L33-44:
    //   canonical_name ≤200 non-empty, category/preferred_vendor/quality_lock_reason ≤80.
    var sets: [String] = []; var args: [DatabaseValueConvertible?] = []
    if case .set(let v) = updates.canonicalName    { sets.append("canonical_name = ?"); args.append(String(v.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))) }
    if case .set(let v) = updates.category         { sets.append("category = ?"); args.append(clip80(v)) }
    if case .set(let v) = updates.preferredVendor  { sets.append("preferred_vendor = ?"); args.append(clip80(v)) }
    if case .set(let b) = updates.qualityLocked    { sets.append("quality_locked = ?"); args.append(b ? 1 : 0) }
    if case .set(let v) = updates.qualityLockReason{ sets.append("quality_lock_reason = ?"); args.append(clip80(v)) }
    var stampNow = false
    if case .set(let lr) = updates.lastReviewed {
        switch lr {
        case .now:        sets.append("last_reviewed = datetime('now')"); stampNow = true   // repo L261-262 — SQL, not bound
        case .clear:      sets.append("last_reviewed = ?"); args.append(nil)
        case .iso(let s): sets.append("last_reviewed = ?"); args.append(s)
        }
    }
    if sets.isEmpty { return UpdateMasterResult(found: true, changed: false, after: before) }  // repo L268-270

    _ = try AuditedWriteRunner.perform(db: writeDB) { db in
        try db.execute(sql: "UPDATE ingredient_masters SET \(sets.joined(separator: ", ")) WHERE master_id = ?",
                       arguments: StatementArguments(args + [masterId]))
        _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
            entity: "ingredient_masters",
            entityId: nil,                                   // repo L281 — master_id is TEXT, payload carries it
            action: .correction,                             // repo L282
            actorCookId: context.actorCookId,
            actorSource: context.actorSource,                // "native_mac"
            payload: auditPayload(masterId: masterId, updates: updates),  // {"master_id": ..., "updates": ...} — see risks
            shiftDate: context.shiftDate,
            locationId: context.locationId))                 // audit row carries location_id (masters are global)
    }
    let after = try getMaster(masterId)
    return UpdateMasterResult(found: true, changed: true, after: after)
}
```
- [ ] Step 4: Run to pass.
- [ ] Step 5: `swift build && swift test`; commit `feat(native): A4.2 costing — IngredientMasters audited updateMaster (T3)`.

**Parity oracle cases covered:** `test-ingredient-masters-repo.mjs` — "reports not-found and skips any writes for missing id" (L157), "empty updates returns changed=false with no audit row" (L165), "writes only the named fields and posts one audit row" (L174), "last_reviewed: 'now' stamps datetime('now')" (L190), "last_reviewed: null clears the field" (L201), "multi-field update writes both + one audit row" (L207); `test-ingredient-masters-api.mjs` — "locks with preferred vendor in one request" (L239), "422 when changing vendor while locked" (L253). Audit `actor_source` intentionally asserted as `native_mac` (diverges from api test L191 `manager_ui`).

**Risks:** **Audited-write ordering** — `validateMasterUpdates` MUST throw before `AuditedWriteRunner.perform` (repo L234; test `testRejectionThrowsBeforeAudit` guards zero audit rows on rejection). `last_reviewed:'now'` MUST be the literal SQL `datetime('now')`, NOT a bound Swift `Date` (repo L261–262) — binding would drift from the web string format and the 5s-window oracle. `entity_id` is `nil` (repo L281). `location_id` comes from the write context (masters have no `location_id` column — db.ts L1445). **NO idempotency** — the web wraps PATCH in `withIdempotency` (route.js L73); document in the file header as deferred. **Payload shape:** `AuditEventInput.payload` is `[String:String]`; the web payload is `{master_id, updates:{...}}` where `updates` is a nested object. Encode the nested `updates` object via `payloadJSON:` (use `AuditEventWriter.encodePayload` on a small `Codable` `{master_id, updates}` struct) rather than flattening into `[String:String]`, so parity with repo L285–286 holds; assert only `master_id` substring presence in the test (as above) to avoid coupling to key order. No money/rounding on this board.

---

### Task 4: LariatApp — `IngredientMastersViewModel` + `IngredientMastersView` + A0 registration (new `.costing` tier)

**Files:**
- Create: `LariatNative/Sources/LariatApp/IngredientMastersViewModel.swift`
- Create: `LariatNative/Sources/LariatApp/IngredientMastersView.swift`
- Create: `LariatNative/Sources/LariatApp/CostingFeatures.swift` (new `*Features.swift` for the `.costing` tier modules)
- Modify: `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (add `.costing` tier case; add `costing.ingredientMasters` descriptor; RELOCATE `manager.costing` → `costing.overview`)
- Modify: `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (add `.costingIngredientMasters`; move `.managerCosting` → `.costingOverview`)
- Modify: `LariatNative/Sources/LariatApp/ManagerFeatures.swift` (rename `managerCosting` → `costingOverview`, id `"costing.overview"`) — OR relocate into `CostingFeatures.swift`
- Modify: `LariatNative/Sources/LariatModel/WriteErrorMapper.swift` (add `IngredientMasterWriteError` arm)
- Test: `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` (append `testCostingTierBoardsRegistered`)

**Interfaces produced:**
```swift
@Observable @MainActor final class IngredientMastersViewModel {
    var rows: [IngredientMasterRow] = []
    var query: String = ""
    var filter: IngredientMasterFilter = .needsReview   // View default mirrors page.jsx L49-53
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase?, pinUser: ManagerPinUser? = nil, locationId: String = LocationScope.resolve())
    func refresh() async
    func markReviewed(masterId: String) async   // MarkReviewedButton parity: updates.last_reviewed = .now
}
```

**Steps:**
- [ ] Step 1: Write failing `testCostingTierBoardsRegistered` in `FeatureRegistryTests.swift` (this is the A0-registration oracle — mirrors the existing `testLaborTierBoardsRegistered` L80):
```swift
func testCostingTierBoardsRegistered() {
    XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
    let masters = FeatureCatalog.descriptor(id: "costing.ingredientMasters")
    XCTAssertNotNil(masters, "costing.ingredientMasters must be registered")
    XCTAssertEqual(masters?.tier, .costing)
    XCTAssertEqual(masters?.title, "Ingredient masters")
    XCTAssertEqual(masters?.enabled, true)
    // aggregate relocated: manager.costing gone, costing.overview present under .costing
    XCTAssertNil(FeatureCatalog.descriptor(id: "manager.costing"), "manager.costing must be relocated")
    let overview = FeatureCatalog.descriptor(id: "costing.overview")
    XCTAssertNotNil(overview, "costing.overview must exist under the new tier")
    XCTAssertEqual(overview?.tier, .costing)
    XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)  // guards testEveryTierHasAtLeastOneModule
}
```
Also flip `testCoolingIsPresent`-style expectations if any existing test asserts `manager.costing`; grep confirms only this new test references it, but re-run the full `FeatureRegistryTests` to catch fallout from moving the descriptor.
- [ ] Step 2: Run to fail — `.costing` case + descriptors absent.
- [ ] Step 3: Implement. In `FeatureCatalog.swift`: add `case costing = "Costing"` to `FeatureTier` (after `.manager`, since sidebar renders in `allCases` order); remove the `manager.costing` descriptor line (L74) and add under a new `// Costing` block:
```swift
        // Costing
        FeatureDescriptor(id: "costing.overview", tier: .costing, title: "Costing"),
        FeatureDescriptor(id: "costing.ingredientMasters", tier: .costing, title: "Ingredient masters"),
```
In `CostingFeatures.swift`:
```swift
import SwiftUI
extension FeatureModule {
    static let costingOverview = FeatureModule(id: "costing.overview") { ctx in
        AnyView(CostingView(database: ctx.database))          // FeatureModule unchanged, new id
    }
    static let costingIngredientMasters = FeatureModule(id: "costing.ingredientMasters") { ctx in
        AnyView(IngredientMastersView(readDB: ctx.database, writeDB: ctx.writeDatabase))
    }
}
```
Remove `managerCosting` from `ManagerFeatures.swift` (L13–15) and drop `.managerCosting` from `FeatureRegistry.all` (L48), replacing with `.costingOverview, .costingIngredientMasters`. Implement the VM (`refresh` calls `IngredientMastersRepository.list(q:filter:)`; `markReviewed` builds `IngredientMasterUpdates` with `lastReviewed = .set(.now)`, calls `updateMaster` with `RegulatedWriteContext.nativeMac(pinUser:)`, maps errors via `WriteErrorMapper.message`). Add `if let im = error as? IngredientMasterWriteError { return im.localizedDescription }` to `WriteErrorMapper`. View: search field bound to `query`, filter Picker (`needs_review`/`reviewed`/`all`), table of rows (`master_id` mono, canonical name, category, pref vendor, VP, BOM, reviewed date, "Mark reviewed" button per row → `markReviewed`). Reads are NOT PIN-gated (do not add a PIN sheet).
- [ ] Step 4: Run to pass (`swift test --filter FeatureRegistryTests`).
- [ ] Step 5: `swift build && swift test` (full suite — confirms `CostingView`/aggregate relocation compiles and no dangling `manager.costing` refs); commit `feat(native): A4.2 costing — Ingredient Masters board + .costing tier + aggregate relocation (T4)`.

**Parity oracle cases covered:** A0 registration — author fresh `testCostingTierBoardsRegistered` vs `FeatureCatalog.swift` (new tier + 2 descriptors) and the relocation contract; VM defaults mirror `app/costing/ingredient-masters/page.jsx:49-53` (View default filter `needs_review`) and `MarkReviewedButton.jsx:22-26` (`{last_reviewed:'now'}`). GET default `all` (route.js L52) is the repo/API default, exercised in Task 2; the View deliberately overrides to `needs_review` per the page.

**Risks:** **Tier ordering** — appending `.costing` to `FeatureTier` after `.manager` keeps the sidebar deterministic (renders in `allCases` order); inserting it elsewhere reorders the sidebar. **Relocation blast radius** — `manager.costing` is referenced in `FeatureCatalog.swift` L74, `FeatureRegistry.swift` L48, `ManagerFeatures.swift` L13; all three must change together or `FeatureModule.init` `preconditionFailure`s at runtime (id must resolve to a descriptor). Grep for any other `"manager.costing"` string / `.managerCosting` symbol before committing (`grep -rn 'manager.costing\|managerCosting' Sources Tests`). The existing `CostingView` and its `managerCosting` module are REUSED unchanged except for the id/symbol rename — no CostingView code changes. No money/rounding on this board. `markReviewed` uses `RegulatedWriteContext.nativeMac` → `actor_source = native_mac` (assert once at repo layer, Task 3).

---

Read-only planning note: I did NOT write or edit any files. All Swift/test code above is proposed content for the implementer. Key files inspected (all under `/Users/seanburdges/Dev/hospitality/Lariat/worktrees/native-port/`): `lib/ingredientMastersRepo.ts`, `app/api/costing/ingredient-masters/route.js`, `app/costing/ingredient-masters/{page.jsx,MarkReviewedButton.jsx}`, `tests/js/test-ingredient-masters-{repo,api,ingest-lock}.mjs`, `lib/db.ts:1445-1453` (DDL), and native templates `LariatNative/Sources/LariatDB/{AuditedWriteRunner,AuditEventWriter,LariatWriteDatabase,PackChangesRepository,CostingRepository,WageNoticeRepository}.swift`, `LariatNative/Sources/LariatModel/{AuditEvent,FeatureCatalog,WriteErrorMapper}.swift`, `LariatNative/Sources/LariatApp/{FeatureModule,FeatureRegistry,ManagerFeatures,KdsPunchViewModel}.swift`, `LariatNative/Tests/LariatDBTests/WageNoticeRepositoryTests.swift`, `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift`.

One source correction worth flagging to the orchestrator: the prompt says "cannot change vendor while locked (unless unlocking)" — verified exact at `lib/ingredientMastersRepo.ts:208-215`; the guard is `!(nextLocked === false)`, i.e. a vendor change is permitted only when the *same* request also sets `quality_locked:false`. Setting the same vendor value while locked is also allowed (the `updates.preferred_vendor !== before.preferred_vendor` clause). Both are captured in Task 1 tests.

#### Gap-fixes for ingredientMasters (fold into the tasks above during execution)

I have enough to complete the audit. The plan's claims about FeatureCatalog (`manager.costing` at L74, tier list ends at `.manager`, `CostingView` reused, `FeatureRegistry.swift` L48 `.managerCosting`) are all accurate. Now let me verify the one remaining plan claim: whether "prices drill-down" is a concern here (the prompt mentions it), and confirm the `descriptor(id:)` API shape the test uses.

The plan's `FeatureRegistryTests` uses `FeatureCatalog.descriptor(id:)` and `FeatureCatalog.descriptors(for:)` — both exist (L82, L85). Good.

Now let me finalize. Cross-referencing each oracle test against tasks, and each rule/clamp/status-code against the plan.

GAPS for ingredientMasters:

- **Oracle test not covered — `listMasters` "returns empty list when table empty" (test-ingredient-masters-repo.mjs:63)**: Task 2's test list starts at `testZeroCountsWhenNothingMaps` (repo L67). The empty-table case (L63, `listMasters(db) == []`) is not reproduced. Plan's "cases covered" text claims L63 but no test asserts it.

- **Oracle test not covered — `getMaster` "returns null for unknown id" (test-ingredient-masters-repo.mjs:140)**: Task 2's `testGetMasterNullThenRow` merges the missing-id and row cases, but the plan's coverage line lists "getMaster L140/L144" — the merged test does assert `XCTAssertNil(getMaster("missing"))`, so this is covered. (No gap — noted for completeness.)

- **API-layer field-validation matrix entirely unmodeled (route.js L84-144)**: The plan explicitly moves field validation nowhere. These oracle tests in `test-ingredient-masters-api.mjs` have NO covering task:
  - "400 on missing body" (L131), "400 when master_id missing" (L141), "400 when updates missing" (L146), "400 when updates is empty" (L151) — route.js L81/L89/L94/L143.
  - "422 when canonical_name is empty string" (L156) — route.js L106 (`canonical_name` non-empty gate). Task 1's `IngredientMasterUpdates.canonicalName` comment says "non-empty when present" but no compute/VM rule enforces or tests it; the empty→422 rule is silently dropped.
  - "422 when last_reviewed is not null/'now'/string" (L162) — route.js L133-139. `LastReviewedChange` in Task 1 has no rejection path for bad types, and no task tests it.
  - `quality_locked` bad-type → 422 (route.js L120-124). `asBoolFlag` in the plan maps `.absent`/`.set(b)` only; the "reject non-bool" branch (route.js L122) is not modeled.
  The plan waves these off ("enforced at the View layer") but Task 4's View section adds no validation and no test for any 400/422 field-shape case. `IngredientMasterWriteError` has no `.invalidField`/400-equivalent case.

- **Clip-to-null coercion dropped (route.js L38-44 `clipOrNull`)**: `clipOrNull` returns `null` for whitespace-only strings (`if (!t) return null`), so `category:'  '`/`preferred_vendor:'  '`/`quality_lock_reason:'  '` clear the column. Task 3's `clip80(v)` helper is only described as "≤80" — the empty-string→null behavior is unspecified and untested. This also interacts with `validateMasterUpdates`: a whitespace `preferred_vendor` becomes `null`, which the "clear vendor while locked" rule (repo L217) must catch — but the plan's Task 1 validate runs on the raw `.set(v)` value before any clip, diverging from web ordering (web clips in the route BEFORE calling `updateMaster`→`validateMasterUpdates`, so `validate` sees the already-nulled value). This is a real parity divergence not flagged in Risks.

- **`canonical_name` trim+clip length (200) applied without the non-empty re-check (route.js L104-107)**: Task 3 clips canonical_name to 200 but does not reject empty-after-trim; web returns 422 (L106). Combined with the point above, native would write an empty canonical_name.

- **`cook_id` clip to 64 chars dropped (route.js L148 `.slice(0,64)`)**: Task 4's VM builds `RegulatedWriteContext.nativeMac(pinUser:)` for `actorCookId`; no task clips the cook id to 64 chars. Not tested anywhere.

- **`clampLimit` non-finite/NaN branch dropped (lib/ingredientMastersRepo.ts:64-68; route.js:26-31)**: Repo `clampLimit` handles `null → 200` and `!Number.isFinite → 200`. Task 2's Swift `max(1, min(1000, limit))` with a non-optional `Int limit=200` cannot express the null/NaN paths; acceptable for the typed Swift signature but the default-200 semantics for "absent" is only implicit. Minor, but the `Math.floor` step (fractional limit) is untested and unmentioned.

- **Missing record field `before` in `UpdateMasterResult` (lib/ingredientMastersRepo.ts:172-177)**: The web `UpdateMasterResult` carries `{found, changed, before, after}`. Task 3's `UpdateMasterResult` drops `before`. No oracle test reads `.before`, so behaviorally safe, but it is a signature inconsistency vs the named parity oracle interface.

- **A0 relocation blast radius under-specified — `LariatApp.swift:33` sidebar render**: The plan lists the three edit sites (FeatureCatalog L74, FeatureRegistry L48, ManagerFeatures L13) but the relocation also affects sidebar rendering via `LariatApp.swift:33` (`ForEach(FeatureTier.allCases)`). Appending `.costing` after `.manager` is correct per the plan, but the plan does not note that `manager.costing` was the last Manager-tier tile — no other Manager reference breaks. Confirmed accurate; no code gap, but `FeatureRegistry.swift:61 modules(for:)` is not called out and must still resolve the relocated module.

- **`testEveryTierHasAtLeastOneModule` interaction (FeatureRegistryTests.swift:13)**: Task 4 adds the guard assertion but the plan should confirm the new `.costing` tier gets BOTH modules registered in `FeatureRegistry.all` (L48 replacement `.costingOverview, .costingIngredientMasters`) or the existing loop test (L13, iterates `FeatureTier.allCases`) fails for an empty `.costing` tier. Plan covers this but only as an inline note; adequate.

- **Placeholder text in Task 3 interfaces**: `IngredientMasterWriteError.errorDescription` body is written as a comment placeholder (`/* .rejected(let m): m ; .notFound: ... */`) rather than concrete Swift; likewise `IngredientMasterUpdates.isEmpty` is `/* all cases == .absent */` and `asBoolFlag` mapping is prose in a Task 3 comment. These are unimplemented stubs the implementer must fill; the `.persistenceFailed` errorDescription string is never specified.

- **`private func set(_ u: inout IngredientMasterUpdates) {}` in Task 3 tests is a dead no-op** ("convenience-free; build updates inline") — leftover placeholder that should be removed.

- **`WriteErrorMapper` arm maps only `.rejected`/`.notFound` via `localizedDescription`, but `.notFound` should surface as the View's not-found path, not a generic error**: Task 4 says `updateMaster` returns `found=false` (no throw) for missing id, yet also adds `IngredientMasterWriteError.notFound` to the error enum — the `.notFound` case is defined but never thrown by `updateMaster` (which returns `UpdateMasterResult(found:false)`), so the enum case and its `WriteErrorMapper` arm are dead. Inconsistency between the Task 1 enum and the Task 3 implementation.

- **`quality_lock` "same vendor while locked allowed" relies on `!=` on `String?`**: Task 1 `testSameVendorWhileLockedAllowed` and the validate impl use `vendorValue != before.preferredVendor`; web uses `!==` (reference/strict). For the `.set(nil)` vs before `nil` case this is fine, but the plan never tests `preferred_vendor: null` set while `before.preferred_vendor` is already `null` and locked — web `willBeLocked && updates.preferred_vendor === null` (repo L217) throws even when it's a no-op clear. Untested edge (clearing an already-null vendor while locked → still rejected per web).

- **Prices drill-down**: The prompt asks to confirm the prices drill-down is NOT a standalone catalog tile. The plan correctly registers only `costing.overview` + `costing.ingredientMasters` under `.costing` and does not add a separate prices tile — consistent, no gap. (Confirmed: no `vendor_prices` drill-down surface exists in the web source read; nothing to port.)

---


## Task 19: `.costing` tier + registration + relocation consolidation

The tier enum case + the `manager.costing`→`costing.overview` relocation landed in the **first board's Task 1** (Price Shocks, above); each board's final App-layer task then added its own descriptor, module, `FeatureRegistry.all` line, and `FeatureRegistryTests` assertion under `.costing`. This task is the CONSOLIDATION pass that asserts the whole `.costing` group is coherent and that nothing regressed. (Per-board task numbers restart; this and Full-wave verification are the two wave-level tasks — run them last.)

**Files:**
- Modify `LariatNative/Tests/LariatModelTests/FeatureRegistryTests.swift` (one consolidated assertion).
- (No source edits expected — if any are needed, this task surfaces the gap.)

Steps:
- [ ] Step 1: Add a consolidated failing test `testCostingTierIsComplete`:
  ```swift
  func testCostingTierIsComplete() {
      // FeatureTier.costing case (Task 1).
      XCTAssertTrue(FeatureTier.allCases.contains(.costing))
      XCTAssertEqual(FeatureTier.costing.rawValue, "Costing")
      // manager.costing relocated, not duplicated.
      XCTAssertNil(FeatureCatalog.descriptor(id: "manager.costing"))
      // Exactly these five descriptors under .costing, all enabled.
      let ids = Set(FeatureCatalog.descriptors(for: .costing).map(\.id))
      XCTAssertEqual(ids, ["costing.overview", "costing.priceShocks",
                           "costing.varianceAttribution", "costing.depletionExceptions",
                           "costing.ingredientMasters"])
      for id in ids {
          XCTAssertEqual(FeatureCatalog.descriptor(id: id)?.tier, .costing)
          XCTAssertEqual(FeatureCatalog.descriptor(id: id)?.enabled, true)
          // Every descriptor resolves to a registered module (guards FeatureModule.init precondition).
          XCTAssertTrue(FeatureRegistry.all.contains { $0.id == id }, "no module for \(id)")
      }
      // costing.prices is a drill-down, NOT a tile.
      XCTAssertNil(FeatureCatalog.descriptor(id: "costing.prices"))
      // Manager tier still non-empty after the relocation.
      XCTAssertFalse(FeatureCatalog.descriptors(for: .manager).isEmpty)
      // Sidebar taxonomy invariants still hold.
      // (testIdsAreUnique / testEveryTierHasAtLeastOneModule are separate existing tests, re-run below.)
  }
  ```
- [ ] Step 2: Run — `swift test --filter FeatureRegistryTests`. Also re-run the pre-existing invariant tests `testIdsAreUnique` and `testEveryTierHasAtLeastOneModule` (they run as part of the class). If `testCostingTierIsComplete` fails on a missing id/module, the offending board task left a descriptor without a matching `FeatureRegistry.all` line (or vice versa) — fix that board's registration, do NOT special-case here.
- [ ] Step 3: Confirm `grep -rn 'manager\.costing\|managerCosting' LariatNative/Sources LariatNative/Tests` returns NOTHING (the relocation is complete and no dangling reference survives). If any survives, remove it.
- [ ] Step 4: `swift build && swift test` green; commit `test(native): A4.2 costing tier consolidation assertion`.

**Risks:** If a board task registered a descriptor but forgot the `FeatureRegistry.all` line, `FeatureModule.init` would `preconditionFailure` at runtime the moment the sidebar renders that tile; the `FeatureRegistry.all.contains` sub-assertion catches it at test time instead. The exact-set assertion also catches an accidental extra tile (e.g. someone wrongly adding a `costing.prices` descriptor).

---

## Task 20: Full-wave verification

Final gate. No new features — only whole-wave green + scope confirmation.

**Files:** none (verification only).

Steps:
- [ ] Step 1: From `LariatNative/`, run `swift build` and confirm it succeeds with no warnings introduced by the wave (build does NOT compile test targets).
- [ ] Step 2: From `LariatNative/`, run `swift test` and confirm ALL tests green — specifically the wave's new suites: `PriceShockComputeTests`, `PriceSeriesComputeTests`, `PriceShockRepositoryTests`, `VarianceAttributionComputeTests`, `VarianceAttributionRepositoryTests`, `UnitConvertTests`, `DepletionExceptionResolverTests`, `DepletionExceptionsRepositoryTests`, `DepletionReasonLabelsTests`, `IngredientMastersComputeTests`, `IngredientMastersRepositoryTests`, and the augmented `FeatureRegistryTests` (incl. `testIdsAreUnique`, `testEveryTierHasAtLeastOneModule`, `testCostingTierIsComplete`).
- [ ] Step 3: Confirm the diff scope is `LariatNative/` ONLY:
  ```
  git fetch origin
  git diff --name-only origin/main...HEAD
  ```
  Every changed path MUST be under `LariatNative/`. If any web file (`lib/`, `app/`, `tests/js/`, `lib/db.ts`) appears in the diff, STOP — the wave must not touch the web source or add a native migration. (The web files are read-only oracles.)
- [ ] Step 4: Confirm NO `loadPriceShocks` / `PriceShockSummary` / `loadDepletionExceptionCount` edits (the Command/Management tiles stay intact):
  ```
  git diff origin/main...HEAD -- LariatNative/Sources/LariatDB/ManagementRollupRepository.swift
  ```
  MUST be empty.
- [ ] Step 5: Commit-gate notes for each board commit (already on a `feat/*` branch): the pre-commit hook runs `npm run lint` + `tsc` — Swift-only commits pass these trivially (no JS/TS changed). Do NOT use `--no-verify`. If the hook fails on an UNRELATED pre-existing web lint/tsc error (not introduced by this wave), separate the environmental failure from a genuine defect per the root CLAUDE.md guidance, document it, and hand it to the user rather than bypassing the gate.
- [ ] Step 6: Final money/parity audit — confirm no Compute or Record introduced an `Int` cents type (grep `LariatNative/Sources` for the wave's new files); every price/variance/net_sales column is `Double`. Confirm the two rounding helpers are used correctly: `jsRound` (floor(x+0.5)) for the variance delta (`Math.round(x*100)/100`) and the price-move pct (`Math.round(pct*10)/10`); `roundAwayFromZero2` for `net_sales` (SQLite `ROUND`). Confirm the single audited write (`updateMaster`) is the ONLY `AuditedWriteRunner.perform` added by the wave and it posts `action='correction'`, `actor_source='native_mac'` with validation throwing before the audit post.
- [ ] Step 7: When all gates are green and scope is confirmed `LariatNative/`-only, the wave is ready for PR. (Open the PR only when the user asks, per the Git workflow rules.)

**Risks:** `swift build` succeeding does NOT imply tests compile — Step 2 must run `swift test` separately. A green build with a red test suite is NOT done. The scope diff is the guardrail against accidental web-source edits or a stray native migration.
