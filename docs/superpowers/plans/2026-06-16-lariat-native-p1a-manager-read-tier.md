# Lariat Native P1a — Manager read tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks are a **dependency chain — run sequentially, not in parallel.**

**Goal:** macOS 14 SwiftUI app reading live `lariat.db` and rendering the complete manager **read** tier — Command, Analytics, Costing, and all six Management rollup tiles — with numbers matching the web app and cross-process polling refresh.

**Architecture:** Extend P0's `LariatModel` / `LariatDB` / `LariatApp` split. Ported business logic lives in **`LariatModel/Compute/`** (GRDB-free pure functions). Repositories fetch rows only. Reads only; web app owns schema and migrations.

**Tech Stack:** Swift 6.3, GRDB.swift 6.29.x, SwiftUI + Swift Charts (macOS 14+), XCTest (host-run via `swift test`).

**Spec:** `docs/superpowers/specs/2026-06-16-lariat-native-p1a-manager-read-tier-design.md`

**Web fidelity sources (parity tests must cite these):**

| Surface | Primary web sources |
|---------|---------------------|
| Command | `lib/commandCenter.ts` (`summarize`, `alertsFor`) |
| Analytics | `app/analytics/page.jsx` (inline SQL + derived KPIs) |
| Costing | `app/costing/page.jsx`, `lib/menuEngineering.ts`, `lib/varianceTrend.ts`, `AbcTile` |
| Rollup ×3 | `app/management/page.jsx` (`readLastCostingIngest`, `readPriceShockSummary`, `readDepletionIssuesCount`) |

**Design notes:**

- **Polling only** for live updates (P0 proved ValueObservation cannot see Node writes).
- **Command** uses thin read-only projections — superseded by P2/P3 domain models later; not throwaway.
- **Per-tile degradation** — one failed read must not blank a screen (`ContentUnavailableView` per section).

---

## File structure (delta from P0)

```
LariatNative/
  Package.swift                          # macOS 14 / iOS 17 floor
  Sources/
    LariatModel/
      Compute/
        CommandCompute.swift             # commandSummary, alertsFor
        AnalyticsCompute.swift           # KPI derivations from row arrays
        CostingCompute.swift             # menuEngineering, varianceTrend, abc
      Records.swift                      # + new FetchableRecord types
      SchemaVersion.swift                # read migration marker, degrade gracefully
    LariatDB/
      CommandRepository.swift
      AnalyticsRepository.swift
      CostingRepository.swift
      ManagementRollupRepository.swift   # extend RollupSnapshot (3 new tiles)
    LariatApp/
      LariatApp.swift                    # sidebar selection for 4 surfaces
      ManagementRollupView.swift         # 6 tiles, @Observable, per-tile degrade
      CommandView.swift
      AnalyticsView.swift                # Swift Charts
      CostingView.swift
      TileDegrade.swift                  # shared ContentUnavailableView helper
  Tests/
    LariatModelTests/
      CommandComputeTests.swift
      AnalyticsComputeTests.swift
      CostingComputeTests.swift
      RecordsTests.swift                 # + P0 carryover decode tests
    LariatDBTests/
      CommandRepositoryTests.swift
      AnalyticsRepositoryTests.swift
      CostingRepositoryTests.swift
      ManagementRollupRepositoryTests.swift  # extend for 3 tiles
      Fixtures.swift                       # extended seed for P1a tables
```

---

## Task 1: macOS 14 floor bump

**Files:**
- Modify: `LariatNative/Package.swift`

- [ ] **Step 1: Raise platform floors**

```swift
platforms: [.macOS(.v14), .iOS(.v17)],
```

- [ ] **Step 2: Verify build**

Run: `cd LariatNative && swift build && swift test`
Expected: PASS (no behavior change yet).

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Package.swift
git commit -m "chore(native): raise deployment floor to macOS 14 for P1a"
```

---

## Task 2: @Observable migration + ContentUnavailableView on Management

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ManagementRollupView.swift`
- Create: `LariatNative/Sources/LariatApp/TileDegrade.swift`

- [ ] **Step 1: Migrate `ManagementRollupViewModel` from `ObservableObject` / `@Published` to `@Observable`**
- [ ] **Step 2: Replace hand-rolled empty/error `VStack` with `ContentUnavailableView`**
- [ ] **Step 3: Gate:** `swift build` compiles on macOS 14 deployment target.

Run: `cd LariatNative && swift build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/
git commit -m "refactor(native): @Observable management VM + ContentUnavailableView"
```

---

## Task 3: P0 carryovers — decode tests + remove smoke tests

**Files:**
- Modify: `LariatNative/Tests/LariatModelTests/RecordsTests.swift`
- Delete: `LariatNative/Tests/LariatModelTests/Smoke.swift`, `LariatNative/Tests/LariatDBTests/Smoke.swift`

- [ ] **Step 1: Add decode tests for `DishCoverageSnapshot` and `PackSizeChange` (P0 deferred)**
- [ ] **Step 2: Delete trivial `Smoke.swift` tests**
- [ ] **Step 3: Run tests**

Run: `cd LariatNative && swift test`
Expected: PASS, count unchanged or +2 vs P0 minus 2 smoke.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(native): P0 carryover record decode tests; drop smoke tests"
```

---

## Task 4: Schema version guard

**Files:**
- Create: `LariatNative/Sources/LariatModel/SchemaVersion.swift`
- Test: `LariatNative/Tests/LariatModelTests/SchemaVersionTests.swift`

- [ ] **Step 1: Write failing test** — missing `schema_migrations` table → `.unknown` (no crash)
- [ ] **Step 2: Implement read of web migration marker** (confirm table name from `lib/db.ts` migrations)
- [ ] **Step 3: Run test** — PASS
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): schema-version guard (graceful degrade)"
```

---

## Task 5: Extend fixtures for P1a tables

**Files:**
- Modify: `LariatNative/Tests/LariatDBTests/Fixtures.swift`

- [ ] **Step 1: Extend `seedFixtureDatabase()` with minimal rows for:**
  - `toast_sales_daily`, `toast_sales_dow`, `toast_sales_hour`, `spend_monthly`, `sales_lines`
  - Command-domain tables used by `commandCenter.summarize` (at least: `eighty_six`, `toast_sales_daily`, `staff_certifications`, `cleaning_schedule` — expand as Command tests require)
  - `vendor_prices_history` or equivalent for price shocks
  - `costing_ingest_log` or whatever `readLastCostingIngest` reads (confirm in `lib/costingBenchmarks.mjs`)
  - depletion exception source tables per `lib/depletionExceptions.ts`

- [ ] **Step 2: Document fixture row IDs / values in comments** — parity tests reference these known values.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(native): extend P1a fixture database seed"
```

---

## Task 6: Extend Management rollup — 3 remaining tiles

**Files:**
- Modify: `LariatNative/Sources/LariatDB/ManagementRollupRepository.swift`
- Modify: `LariatNative/Tests/LariatDBTests/ManagementRollupRepositoryTests.swift`

**Web fidelity:**

- Costing freshness: `readLastCostingIngest(db)` from `lib/costingBenchmarks.mjs`
- Price shocks: `listPriceShocks(db, { location_id, windowDays: 7, minPctMove: 5, limit: 100 })` → `{ total, up, down }` per `readPriceShockSummary` in `app/management/page.jsx`
- Depletion: `listDepletionExceptions(db, { location_id, limit: 100 }).length`

- [ ] **Step 1: Write failing test** asserting ingest age/status, shock counts, depletion count from fixture
- [ ] **Step 2: Extend `RollupSnapshot` + `load()` / async stream**
- [ ] **Step 3: Run test** — PASS
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): management rollup — ingest freshness, price shocks, depletion tiles"
```

---

## Task 7: CommandRepository (fetch only)

**Files:**
- Create: `LariatNative/Sources/LariatDB/CommandRepository.swift`
- Create: `LariatNative/Sources/LariatModel/Records.swift` additions (command projection records)
- Test: `LariatNative/Tests/LariatDBTests/CommandRepositoryTests.swift`

- [ ] **Step 1: TDD — repository returns raw row bundles** (no aggregation in repo)
- [ ] **Step 2: Mirror SELECTs from `commandCenter.ts` `summarize`** — location-scoped where web is
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(native): CommandRepository raw fetches"
```

---

## Task 8: CommandCompute parity

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/CommandCompute.swift`
- Test: `LariatNative/Tests/LariatModelTests/CommandComputeTests.swift`

- [ ] **Step 1: Port `summarize` aggregation logic** — input: fetched records + `locationId` + `today`; output: `CommandSummary` struct
- [ ] **Step 2: Port `alertsFor`** — red/amber severities match web thresholds (`RED_NO_SHOW_THRESHOLD`, `AMBER_SALES_DROP_PCT`)
- [ ] **Step 3: Assert parity** against fixture with known web-computed values (run Node once to capture golden outputs if needed)
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): CommandCompute parity (summarize + alertsFor)"
```

---

## Task 9: AnalyticsRepository + AnalyticsCompute

**Files:**
- Create: `LariatNative/Sources/LariatDB/AnalyticsRepository.swift`
- Create: `LariatNative/Sources/LariatModel/Compute/AnalyticsCompute.swift`
- Tests: `AnalyticsRepositoryTests.swift`, `AnalyticsComputeTests.swift`

- [ ] **Step 1: Repository fetches daily/dow/hour/spend/top-items per `app/analytics/page.jsx` SQL**
- [ ] **Step 2: Compute derives KPIs** (`dailyCurrentTotal`, DOW comparison, etc.) — parity-tested
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(native): analytics repository + compute parity"
```

---

## Task 10: CostingRepository + CostingCompute

**Files:**
- Create: `LariatNative/Sources/LariatDB/CostingRepository.swift`
- Create: `LariatNative/Sources/LariatModel/Compute/CostingCompute.swift`
- Tests: `CostingRepositoryTests.swift`, `CostingComputeTests.swift`

- [ ] **Step 1: Reuse P0 variance + dish-coverage reads** (no duplication)
- [ ] **Step 2: Port `computeMenuEngineering`, `getVarianceTrend`, ABC logic** from web libs
- [ ] **Step 3: Parity tests** against fixture
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): costing repository + compute parity"
```

---

## Task 11: Management UI — six tiles + per-tile degradation

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ManagementRollupView.swift`

- [ ] **Step 1: Render all 6 rollup tiles** with web-aligned labels (see `docs/UI_COPY_RULES.md`)
- [ ] **Step 2: Per-tile `ContentUnavailableView` on nil/failed subsection**
- [ ] **Step 3: Gate:** compiles + existing rollup tests green

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): management screen — six rollup tiles with per-tile degrade"
```

---

## Task 12: Command screen

**Files:**
- Create: `LariatNative/Sources/LariatApp/CommandView.swift`

- [ ] **Step 1: `@Observable` VM subscribing to `CommandRepository` + polling stream**
- [ ] **Step 2: Tile layout mirroring `/command` signal groups** (sales, labor, food safety, etc.)
- [ ] **Step 3: `swift build` gate**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): Command screen (read-only)"
```

---

## Task 13: Analytics screen (Swift Charts)

**Files:**
- Create: `LariatNative/Sources/LariatApp/AnalyticsView.swift`

- [ ] **Step 1: Charts for daily trend, DOW, hourly, monthly spend** (Swift Charts, macOS 14)
- [ ] **Step 2: KPI header row matching web derived KPIs**
- [ ] **Step 3: `swift build` gate** — no snapshot tests
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): Analytics screen with Swift Charts"
```

---

## Task 14: Costing screen

**Files:**
- Create: `LariatNative/Sources/LariatApp/CostingView.swift`

- [ ] **Step 1: Sections: variance, coverage (P0 reuse), menu engineering, variance trend, ABC**
- [ ] **Step 2: Per-section degradation**
- [ ] **Step 3: `swift build` gate**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): Costing screen (read-only)"
```

---

## Task 15: Navigation shell + DI wiring

**Files:**
- Modify: `LariatNative/Sources/LariatApp/LariatApp.swift`

- [ ] **Step 1: Wire sidebar selection** for Command / Analytics / Costing / Management (P0 selection pattern)
- [ ] **Step 2: Shared `LariatDatabase` + repository injection**
- [ ] **Step 3: Full test suite**

Run: `cd LariatNative && swift build && swift test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(native): activate all manager surfaces in navigation shell"
```

---

## Task 16: Full verification + README

**Files:**
- Modify: `LariatNative/README.md`

- [ ] **Step 1: `swift build && swift test` — document test count**
- [ ] **Step 2: Update README** — macOS 14, four surfaces, real-DB smoke command unchanged
- [ ] **Step 3: Commit**

```bash
git commit -m "docs(native): P1a README + verification notes"
```

---

## Self-review notes

- **Spec coverage:** four surfaces ✓; 6 rollup tiles ✓; macOS 14 ✓; Compute/ approach ✓; polling ✓; carryovers ✓; per-tile degrade ✓; schema guard ✓.
- **Deferred to P1b:** all writes, `AuditedWrite` / `PinGate` / `RuleGate` implementation.
- **Risks:** Command projection supersession (documented); chart fidelity (no snapshot tests); compute parity (host tests are the gate).
